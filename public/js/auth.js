document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  if (localStorage.getItem('chatUser')) {
      window.location.href = '/app.html';
      return;
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showRegister = document.getElementById('showRegister');
  const showLogin = document.getElementById('showLogin');

  // Toggle forms
  showRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  });

  showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  // Handle Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('chatUser', JSON.stringify(data.user));
        window.location.href = '/app.html';
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Login failed');
    }
  });

  // Handle Register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.regUsername.value;
    const password = e.target.regPassword.value;
    const displayName = e.target.regDisplayName.value;

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName })
      });
      const data = await res.json();

      if (data.success) {
        alert('Registrasi berhasil! Silakan login.');
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Registration failed');
    }
  });
});
