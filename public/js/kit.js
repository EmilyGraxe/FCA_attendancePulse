// public/js/kit.js
// FCAPULSE v4 — fixes:
//  * No more spurious "Unauthorised" badge when JWT is valid (handle 401 by
//    redirecting to login instead of rendering the row as unauthorised).
//  * loadSessions() now reads s.status from API and only shows Active/Closed.
//  * Helper authFetch() centralises auth + auto-logout on 401/403.

const sidebarToggle = document.getElementById('sidebarToggle');
const wrapper       = document.getElementById('wrapper');
if (sidebarToggle) sidebarToggle.addEventListener('click', () => wrapper.classList.toggle('toggled'));

let token = localStorage.getItem('token');
if (!token) window.location.href = '/';

const headers = { 'Authorization': 'Bearer ' + token };

/* ---------- auth-aware fetch ---------- */
async function authFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'Authorization': 'Bearer ' + token }
  });
  if (res.status === 401 || res.status === 403) {
    // token bad / expired -> back to login (don't paint "unauthorised" everywhere)
    localStorage.removeItem('token');
    window.location.href = '/';
    throw new Error('unauthorised');
  }
  return res;
}

/* ---------- current user ---------- */
authFetch('/me')
  .then(r => r.json())
  .then(u => { document.getElementById('navbarUser').textContent = u.name; })
  .catch(console.error);

/* ---------- start / close session ---------- */
async function startKitSession() {
  const label = prompt('Kit session label (e.g. "Date - MorningSession"):');
  if (label === null) return;
  if (!label.trim()) return alert('Please enter a label');

  const res  = await authFetch('/kit-sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label.trim() })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message);
  alert('Asset session started: ' + label.trim());
  window.location.reload();
}

async function closeKitSession(id) {
  if (!confirm('Close this kit session?')) return;
  const res  = await authFetch(`/kit-sessions/${id}/close`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert(data.message);
  window.location.reload();
}

function goKitScanner() { window.location.href = '/kit-scan'; }

/* ---------- sessions table ---------- */
async function loadSessions() {
  try {
    const res = await authFetch('/kit-sessions/api/list');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return alert(data.message || 'Failed to load sessions');
    }
    const sessions = await res.json();

    const tbody = document.getElementById('sessionsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    sessions.forEach((s, index) => {
      const isActive = !s.closed_at;
      const statusBadge = isActive
        ? '<span class="badge-active">Active</span>'
        : '<span class="badge-closed">Closed</span>';

      tbody.innerHTML += `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${s.label}</strong></td>
          <td>${new Date(s.started_at).toLocaleString('en-GB')}</td>
          <td>${s.closed_at ? new Date(s.closed_at).toLocaleString('en-GB') : '—'}</td>
          <td>${s.scanned ?? 0}</td>
          <td>${s.returned ?? 0}</td>
          <td>${statusBadge}</td>
          <td>
            ${isActive
              ? `<button class="close-btn closeKitSession" data-id="${s.id}">Close</button>`
              : ''}
          </td>
        </tr>`;
    });

    document.querySelectorAll('.closeKitSession').forEach(btn => {
      btn.addEventListener('click', () => closeKitSession(btn.dataset.id));
    });
  } catch (err) {
    if (err.message !== 'unauthorised') console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startKitSession');
  const scanBtn  = document.getElementById('openKitScanner');
  if (startBtn) startBtn.addEventListener('click', startKitSession);
  if (scanBtn)  scanBtn.addEventListener('click', goKitScanner);
  loadSessions();
});

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  });
}

/* expose helpers for other scripts (kit_scan.ejs, attendance.js) */
window.authFetch = authFetch;
