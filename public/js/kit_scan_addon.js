// public/js/kit_scan_addon.js
// Drop-in helpers for the /kit-scan page:
//  1. Gate the "PC Return" toggle behind a one-time admin/lecturer password.
//  2. Live-search the PC Share laptop number field against /pc-share/search.
//  3. Mark attendance automatically on every scan in Kit Out, PC Share and PC Return.
//
// Assumes kit_scan.ejs has:
//   - radio/toggle inputs name="mode" with values: kitout | pcshare | pcreturn
//   - <input id="pcNumber"> in PC Share mode + <ul id="pcSuggestions">
//   - the scan handler dispatches a `kit:scan` CustomEvent with {detail:{studentId, mode}}
//     after each successful card scan.

(function () {
  const authFetch = window.authFetch || ((u, o) => fetch(u, {
    ...o, headers: { ...(o?.headers || {}), Authorization: 'Bearer ' + localStorage.getItem('token') }
  }));

  /* ---------- 1. PC Return authorisation (once per view) ---------- */
  let returnAuthorised = false;

  async function authoriseReturnMode() {
    if (returnAuthorised) return true;
    const pw = prompt('Enter your password to authorise PC Return:');
    if (!pw) return false;
    const res = await authFetch('/kit-scan/authorise-return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      alert(data.message || 'Incorrect password');
      return false;
    }
    returnAuthorised = true;
    return true;
  }

  document.querySelectorAll('input[name="mode"]').forEach(el => {
    el.addEventListener('change', async (e) => {
      if (e.target.value !== 'pcreturn') return;
      const ok = await authoriseReturnMode();
      if (!ok) {
        // revert toggle
        const kitOut = document.querySelector('input[name="mode"][value="kitout"]');
        if (kitOut) kitOut.checked = true;
      }
    });
  });

  /* ---------- 2. PC Share laptop-number search ---------- */
  const pcInput = document.getElementById('pcNumber');
  const pcList  = document.getElementById('pcSuggestions');
  let pcDebounce;
  if (pcInput && pcList) {
    pcInput.addEventListener('input', () => {
      clearTimeout(pcDebounce);
      const q = pcInput.value.trim();
      if (!q) { pcList.innerHTML = ''; return; }
      pcDebounce = setTimeout(async () => {
        try {
          const res = await authFetch('/pc-share/search?q=' + encodeURIComponent(q));
          if (!res.ok) return;
          const rows = await res.json();
          pcList.innerHTML = rows.map(r =>
            `<li data-pc="${r.pc_number}">${r.pc_number}${r.borrower_name ? ` — currently with ${r.borrower_name}` : ''}</li>`
          ).join('');
          pcList.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
              pcInput.value = li.dataset.pc;
              pcList.innerHTML = '';
            });
          });
        } catch (err) { console.error(err); }
      }, 200);
    });
    document.addEventListener('click', (e) => {
      if (e.target !== pcInput) pcList.innerHTML = '';
    });
  }

  /* ---------- 3. Mark attendance on every scan ---------- */
  document.addEventListener('kit:scan', async (e) => {
    const { studentId, mode } = e.detail || {};
    if (!studentId) return;
    try {
      await authFetch('/attendance/auto-mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, source: mode || 'kitscan' })
      });
    } catch (err) { console.error('attendance auto-mark failed', err); }
  });
})();
