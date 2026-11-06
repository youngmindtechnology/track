const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT     = process.env.PORT || 3000;
const PUBLIC   = path.join(__dirname, "public");
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, "locations.log");

// 👇 Set this as an env var in production. Leave empty to disable auth (local dev).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".ico":  "image/x-icon",
};

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

// ─── Auth check ──────────────────────────────────────────
// Simple HTTP Basic Auth. Browser will show a native login popup.
function isAuthorized(req) {
  if (!ADMIN_PASSWORD) return true; // no password set → open
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const [, pass] = decoded.split(":");
  return pass === ADMIN_PASSWORD;
}

// ─── API: POST /api/location (unchanged) ─────────────────
function handleLocation(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10_000) {
      req.destroy();
      sendJSON(res, 413, { error: "Payload too large" });
    }
  });
  req.on("end", () => {
    let data;
    try { data = JSON.parse(body); }
    catch { return sendJSON(res, 400, { error: "Invalid JSON" }); }

    const { latitude, longitude } = data;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return sendJSON(res, 400, { error: "latitude and longitude must be numbers" });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return sendJSON(res, 400, { error: "Coordinates out of range" });
    }

    const line = JSON.stringify({
      latitude,
      longitude,
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      time: new Date().toISOString(),
    });

    fs.appendFile(LOG_FILE, line + "\n", (err) => {
      if (err) {
        console.error("write failed:", err);
        return sendJSON(res, 500, { error: "Could not save" });
      }
      console.log("📍 saved:", line);
      sendJSON(res, 200, { ok: true });
    });
  });
}

// ─── API: GET /api/locations (NEW) ───────────────────────
function handleListLocations(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Admin"' });
    return res.end("Unauthorized");
  }

  fs.readFile(LOG_FILE, "utf8", (err, text) => {
    if (err) {
      if (err.code === "ENOENT") return sendJSON(res, 200, []); // no log yet
      console.error(err);
      return sendJSON(res, 500, { error: "Read failed" });
    }

    const entries = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // newest first

    sendJSON(res, 200, entries);
  });
}

// ─── Router ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // protect /admin page too
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

  if (req.method === "GET") return serveStatic(res, url.pathname);

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin`);
});