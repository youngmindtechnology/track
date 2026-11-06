const rowsEl     = document.getElementById("rows");
const countEl    = document.getElementById("count");
const statusEl   = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const exportBtn  = document.getElementById("export");
const clearBtn   = document.getElementById("clear");

let lastEntries = [];

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function ipCity(e) {
  return e.ipGeo && e.ipGeo.city
    ? `${e.ipGeo.city}${e.ipGeo.country ? ", " + e.ipGeo.country : ""}`
    : "—";
}

function renderRow(e, index, total) {
  const when = new Date(e.time).toLocaleString();
  const city = escapeHtml(ipCity(e));
  const ip   = escapeHtml(e.ip || "—");
  const n    = total - index;

  if (e.kind === "denied") {
    return `
      <tr>
        <td>${n}</td>
        <td>${escapeHtml(when)}</td>
        <td class="kind-denied">✕ GPS denied</td>
        <td class="num" colspan="2" style="color:#64748b">—</td>
        <td>${ip}</td>
        <td>${city}</td>
        <td>—</td>
      </tr>`;
  }

  if (e.kind === "page-load") {
    const mapUrl = e.ipGeo?.lat != null
      ? `https://www.google.com/maps?q=${e.ipGeo.lat},${e.ipGeo.lon}`
      : null;
    return `
      <tr>
        <td>${n}</td>
        <td>${escapeHtml(when)}</td>
        <td class="kind-load">IP only</td>
        <td class="num" colspan="2" style="color:#64748b">—</td>
        <td>${ip}</td>
        <td>${city}</td>
        <td>${mapUrl ? `<a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">City ↗</a>` : "—"}</td>
      </tr>`;
  }

  // kind === "gps"
  const mapUrl = `https://www.google.com/maps?q=${e.latitude},${e.longitude}`;
  const acc = e.accuracy != null ? ` <span style="color:#64748b">±${Math.round(e.accuracy)}m</span>` : "";
  return `
    <tr>
      <td>${n}</td>
      <td>${escapeHtml(when)}</td>
      <td class="kind-gps">✓ GPS</td>
      <td class="num">${e.latitude.toFixed(6)}${acc}</td>
      <td class="num">${e.longitude.toFixed(6)}</td>
      <td>${ip}</td>
      <td>${city}</td>
      <td><a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">Open ↗</a></td>
    </tr>`;
}

async function load() {
  setStatus("Loading…");
  refreshBtn.disabled = true;

  try {
    const res = await fetch("/api/locations");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = await res.json();

    lastEntries = entries;
    const total = entries.length;
    countEl.textContent = `${total} entr${total === 1 ? "y" : "ies"}`;

    if (total === 0) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="empty">No captures yet.</td></tr>`;
      setStatus("");
      return;
    }

    rowsEl.innerHTML = entries.map((e, i) => renderRow(e, i, total)).join("");
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load. Check server logs.", true);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", load);

exportBtn.addEventListener("click", () => {
  if (lastEntries.length === 0) {
    setStatus("Nothing to export.", true);
    return;
  }
  const headers = ["time", "kind", "latitude", "longitude", "accuracy", "ip", "ipCity", "ipRegion", "ipCountry", "userAgent"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = lastEntries.map((e) => [
    e.time,
    e.kind,
    e.latitude ?? "",
    e.longitude ?? "",
    e.accuracy ?? "",
    e.ip ?? "",
    e.ipGeo?.city ?? "",
    e.ipGeo?.region ?? "",
    e.ipGeo?.country ?? "",
    e.userAgent ?? "",
  ].map(esc).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `locations-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Exported CSV.");
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Delete all captured locations? This cannot be undone.")) return;
  clearBtn.disabled = true;
  try {
    const res = await fetch("/api/locations", { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
    setStatus("Log cleared.");
  } catch (err) {
    console.error(err);
    setStatus("Clear failed.", true);
  } finally {
    clearBtn.disabled = false;
  }
});

load();