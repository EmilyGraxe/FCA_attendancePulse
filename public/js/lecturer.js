const sidebarToggle = document.getElementById('sidebarToggle');
const wrapper       = document.getElementById('wrapper');
if (sidebarToggle) sidebarToggle.addEventListener('click', () => wrapper.classList.toggle('toggled'));

let token = localStorage.getItem('token');
if (!token) window.location.href = '/';

const headers = { 'Authorization': 'Bearer ' + token };

fetch('/me', { headers })
  .then(r => r.json())
  .then(u => { document.getElementById('navbarUser').textContent = u.name; })
  .catch(console.error);

async function startSession() {
  const label = prompt('Session label (e.g. "Week 4 - Monday Morning"):');
  if (label === null) return; // cancelled

  const res  = await fetch('/api/session/start', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label.trim() })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message);
  alert('Attendance session started: ' + (label || 'Unnamed'));
}

async function closeSession() {
  if (!confirm('Close the current attendance session?')) return;
  const res  = await fetch('/api/session/close', { method: 'POST', headers });
  const data = await res.json();
  if (!res.ok) return alert(data.message);
  alert(data.message);
}

function goScanner() { window.location.href = '/scanner'; }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startSession').addEventListener('click', startSession);
  document.getElementById('closeSession').addEventListener('click', closeSession);
  document.getElementById('openScanner').addEventListener('click', goScanner);
});

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  });
}
