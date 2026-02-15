const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (!res.ok) {
    msg.innerText = data.message;
    msg.style.color = "red";
    return;
  }

  // ✅ store JWT
  localStorage.setItem("token", data.token);

  // ✅ redirect manually
  window.location.href = "/dashboard";
});
