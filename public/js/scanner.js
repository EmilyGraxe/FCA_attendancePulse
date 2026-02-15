// get token from localStorage
const token = localStorage.getItem("token");
if (!token) window.location.href = "/"; // redirect if not logged in

const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const backBtn = document.getElementById("backBtn");

let scannedTokens = new Set();
let presentCount = 0;
const beep = new Audio("/sounds/beep_short.ogg");
// ===== SEND SCAN TO SERVER =====
async function markAttendance(qr_token) {
  try {
    const res = await fetch("/api/attendance/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ qr_token })
    });

    const data = await res.json();

    if (!res.ok) {
      statusEl.className = "error";
      statusEl.textContent = data.message;
      return;
    }

    if (!scannedTokens.has(qr_token)) {
      scannedTokens.add(qr_token);
      presentCount++;
      countEl.textContent = presentCount;
    }

    statusEl.className = "success";
    statusEl.textContent = data.message;
    beep.play();

  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = "Network error";
  }
}

// ===== QR SCAN SUCCESS =====
function onScanSuccess(decodedText) {
  markAttendance(decodedText);
}

// ===== START CAMERA =====
function startScanner() {
  const html5QrCode = new Html5Qrcode("reader");

  Html5Qrcode.getCameras()
  .then(devices => {
    console.log("Cameras found:", devices);
    if (!devices.length) {
      statusEl.textContent = "No camera found";
      statusEl.className = "error";
      return;
    }
    const cameraId = devices[0].id || devices[0].deviceId;
    console.log("Using camera:", cameraId);

    html5QrCode.start(cameraId, { fps: 10, qrbox: 250 }, onScanSuccess)
      .catch(err => {
        console.error("Failed to start camera:", err);
        statusEl.textContent = "Failed to start camera: " + err;
        statusEl.className = "error";
      });
  })
  .catch(err => {
    console.error("Camera access error:", err);
    statusEl.textContent = "Camera access denied or not found";
    statusEl.className = "error";
  });
}

// ===== BACK BUTTON =====
backBtn.addEventListener("click", () => {
  window.location.href = "/lecturer";
});

// ===== INIT =====
document.addEventListener("DOMContentLoaded", startScanner);