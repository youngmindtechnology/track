const rowsEl   = document.getElementById("rows");
const countEl  = document.getElementById("count");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function load() {
  setStatus("Loading…");
  refreshBtn.disabled = true;

  try {
    const res = await fetch("/api/locations");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const entries = await res.json();

    countEl.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;

    if (entries.length === 0) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="empty">No locations captured yet.</td></tr>`;
      setStatus("");
      return;
    }

    rowsEl.innerHTML = entries.map((e, i) => {
      const when = new Date(e.time).toLocaleString();
      const mapUrl = `https://www.google.com/maps?q=${e.latitude},${e.longitude}`;
      return `
        <tr>
          <td>${entries.length - i}</td>
          <td>${escapeHtml(when)}</td>
          <td class="num">${e.latitude.toFixed(6)}</td>
          <td class="num">${e.longitude.toFixed(6)}</td>
          <td>${escapeHtml(e.ip || "—")}</td>
          <td><a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">Open ↗</a></td>
        </tr>
      `;
    }).join("");

    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load. Check the server logs.", true);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", load);
load(); // auto-load on page open