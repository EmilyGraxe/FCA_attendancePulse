const sidebarToggle = document.getElementById('sidebarToggle');
const wrapper = document.getElementById('wrapper');

// Sidebar toggle
sidebarToggle.addEventListener('click', () => {
  wrapper.classList.toggle('toggled');
});

// JWT token
const token = localStorage.getItem('token');
if (!token) window.location.href = '/';

const headers = { 'Authorization': 'Bearer ' + token };

// Get user info
fetch('/me', { headers })
  .then(res => res.json())
  .then(user => {
    document.getElementById('navbarUser').textContent = user.name;
  })
  .catch(console.error);

// Get monthly chart data
fetch('/chart-data', { headers })
  .then(res => res.json())
  .then(chart => {
    const ctx = document.getElementById('attendanceChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chart.labels,
        datasets: [{
          label: 'Attendance (%)',
          data: chart.data,
          backgroundColor: 'rgba(30,127,79,0.7)',
          borderColor: '#1e7f4f',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Monthly Attendance (%)' }
        },
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });

    document.getElementById('totalSessions').textContent = chart.labels.length;
  })
  .catch(console.error);

// Get total students
fetch('/total-students', { headers })
  .then(res => res.json())
  .then(data => {
    document.getElementById('totalStudents').textContent = data.length;
  })
  .catch(console.error);


  // Logout button click
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token'); // remove JWT token
        window.location.href = '/';        // redirect to login page
    });
}