const sidebarToggle = document.getElementById('sidebarToggle');
const wrapper = document.getElementById('wrapper');
if (sidebarToggle && wrapper) {
  sidebarToggle.addEventListener('click', () => wrapper.classList.toggle('toggled'));
}

const token = localStorage.getItem('token');
if (!token) window.location.href = '/';
const headers = { 'Authorization': 'Bearer ' + token };

// User pill
const userEl = document.getElementById('navbarUser');
if (userEl) {
  fetch('/me', { headers })
    .then(r => r.json())
    .then(u => { userEl.textContent = u.name || '—'; })
    .catch(() => { userEl.textContent = '—'; });
}

// Chart (only if canvas present)
const chartCanvas = document.getElementById('attendanceChart');
if (chartCanvas) {
  fetch('/chart-data', { headers })
    .then(r => r.json())
    .then(chart => {
      const ctx = chartCanvas.getContext('2d');
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chart.labels,
          datasets: [{
            label: 'Attendance (%)',
            data: chart.data,
            backgroundColor: 'rgba(15,81,50,0.75)',
            borderColor: '#0f5132',
            borderWidth: 1,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: true, text: 'Monthly Attendance (%)' },
          },
          scales: { y: { beginAtZero: true, max: 100 } },
        },
      });
      const ts = document.getElementById('totalSessions');
      if (ts) ts.textContent = chart.labels.length;
    })
    .catch(console.error);
}

// Total students
const totalStudentsEl = document.getElementById('totalStudents');
if (totalStudentsEl) {
  fetch('/total-students', { headers })
    .then(r => r.json())
    .then(data => { totalStudentsEl.textContent = data.length; })
    .catch(console.error);
}

// Logout
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  });
}
