const sidebarToggle = document.getElementById('sidebarToggle');
const wrapper = document.getElementById('wrapper');

// Sidebar toggle
sidebarToggle.addEventListener('click', () => {
  wrapper.classList.toggle('toggled');
});

// ===== AUTH CHECK =====
let token = localStorage.getItem("token");

if (!token) {
  window.location.href = "/";
}
const headers = { 'Authorization': 'Bearer ' + token };

// Get user info
fetch('/me', { headers })
  .then(res => res.json())
  .then(user => {
    document.getElementById('navbarUser').textContent = user.name;
  })
  .catch(console.error);

async function startSession() {
  const res = await fetch("/api/session/start", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token }
  });

  const data = await res.json();

  if (!res.ok) return alert(data.message);
  alert("Session started");
}




async function closeSession() {
  const res = await fetch("/api/session/close", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token }
  });

  const data = await res.json();

  if (!res.ok) return alert(data.message);
  alert(data.message);
}

function goScanner() {
  window.location.href = "/scanner";
}

/* ===== Attach events AFTER page loads ===== */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("startSession").addEventListener("click", startSession);
  document.getElementById("closeSession").addEventListener("click", closeSession);
  document.getElementById("openScanner").addEventListener("click", goScanner);
});


// Logout button click
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token'); // remove JWT token
        window.location.href = '/';        // redirect to login page
    });
}