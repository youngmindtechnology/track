const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT     = process.env.PORT || 3000;
const PUBLIC   = path.join(__dirname, "public");
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, "locations.log");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".ico":  "image/x-icon",
};

// ─── Helpers ─────────────────────────────────────────────
function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function serveStatic(res, urlPath) {
  const rel  = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function isAuthorized(req) {
  if (!ADMIN_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const [, pass] = decoded.split(":");
  return pass === ADMIN_PASSWORD;
}

// ─── IP geolocation ──────────────────────────────────────
// Uses ip-api.com free tier (45 req/min). Cached 10 min per IP.
const ipCache = new Map();
const IP_CACHE_TTL = 10 * 60 * 1000;

async function lookupIp(ip) {
  if (!ip) return null;

  // Normalize: strip IPv6-mapped IPv4 and take first in x-forwarded-for
  ip = ip.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") {
    return { country: "local", region: "local", city: "local", lat: null, lon: null };
  }

  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.at < IP_CACHE_TTL) return cached.data;

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon`
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success") return null;

    const data = {
      country: json.country,
      region:  json.regionName,
      city:    json.city,
      lat:     json.lat,
      lon:     json.lon,
    };
    ipCache.set(ip, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.error("ip lookup failed:", err);
    return null;
  }
}

// ─── Save + respond ──────────────────────────────────────
function saveAndRespond(res, entry) {
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", (err) => {
    if (err) {
      console.error("write failed:", err);
      return sendJSON(res, 500, { error: "Could not save" });
    }
    console.log("📍", entry.kind, entry.ip);
    sendJSON(res, 200, { ok: true });
  });
}

// ─── POST /api/location ──────────────────────────────────
function handleLocation(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10_000) {
      req.destroy();
      sendJSON(res, 413, { error: "Payload too large" });
    }
  });

  req.on("end", async () => {
    let data;
    try { data = JSON.parse(body); }
    catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }

    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const userAgent = req.headers["user-agent"];
    const time = new Date().toISOString();

    // Case A: user denied GPS
    if (data.status === "denied") {
      const ipGeo = await lookupIp(ip);
      return saveAndRespond(res, { kind: "denied", ip, userAgent, time, ipGeo });
    }

    // Case B: page-load beacon (IP only)
    if (data.event === "page-load") {
      const ipGeo = await lookupIp(ip);
      return saveAndRespond(res, { kind: "page-load", ip, userAgent, time, ipGeo });
    }

    // Case C: GPS coords
    const { latitude, longitude, accuracy } = data;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return sendJSON(res, 400, { error: "latitude and longitude must be numbers" });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return sendJSON(res, 400, { error: "Coordinates out of range" });
    }

    const ipGeo = await lookupIp(ip);
    saveAndRespond(res, {
      kind: "gps", ip, userAgent, time, ipGeo,
      latitude, longitude,
      accuracy: typeof accuracy === "number" ? accuracy : null,
    });
  });
}

// ─── GET /api/locations ──────────────────────────────────
function handleListLocations(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Admin"' });
    return res.end("Unauthorized");
  }

  fs.readFile(LOG_FILE, "utf8", (err, text) => {
    if (err) {
      if (err.code === "ENOENT") return sendJSON(res, 200, []);
      console.error(err);
      return sendJSON(res, 500, { error: "Read failed" });
    }
    const entries = text
      .split("\n").filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .reverse();
    sendJSON(res, 200, entries);
  });
}

// ─── DELETE /api/locations (wipe log) ────────────────────
function handleClearLocations(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Admin"' });
    return res.end("Unauthorized");
  }
  fs.writeFile(LOG_FILE, "", (err) => {
    if (err) return sendJSON(res, 500, { error: "Clear failed" });
    sendJSON(res, 200, { ok: true });
  });
}

// ─── Router ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // Admin page — auth-protected
  if (url.pathname === "/admin") {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Admin"' });
      return res.end("Unauthorized");
    }
    return serveStatic(res, "/admin.html");
  }

  if (req.method === "POST" && url.pathname === "/api/location") {
    return handleLocation(req, res);
  }
  if (req.method === "GET" && url.pathname === "/api/locations") {
    return handleListLocations(req, res);
  }
  if (req.method === "DELETE" && url.pathname === "/api/locations") {
    return handleClearLocations(req, res);
  }

  if (req.method === "GET") return serveStatic(res, url.pathname);

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin`);
});