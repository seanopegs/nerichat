document.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('chatUser');
  if (!userStr) {
    window.location.href = '/';
    return;
  }

  let user = JSON.parse(userStr);

  // Apply Theme
  if (user.theme === 'dark') {
    document.body.classList.add('dark-mode');
    document.getElementById('themeToggle').checked = true;
  }

  // Elements
  const avatarPreview = document.getElementById('avatarPreview');
  const displayNameInput = document.getElementById('displayNameInput');
  const avatarInput = document.getElementById('avatarInput');
  const passwordInput = document.getElementById('passwordInput');
  const saveBtn = document.getElementById('saveBtn');
  const themeToggle = document.getElementById('themeToggle');
  const logoutBtn = document.getElementById('logoutBtn');
  const backBtn = document.getElementById('backBtn');

  // Init Values
  avatarPreview.src = user.avatar;
  displayNameInput.value = user.displayName;
  avatarInput.value = user.avatar;

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const displayName = displayNameInput.value;
    const avatar = avatarInput.value;
    const password = passwordInput.value;
    const theme = themeToggle.checked ? 'dark' : 'light';

    const payload = {
      username: user.username,
      displayName,
      avatar,
      theme
    };
    if (password) payload.password = password;

    try {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        // Update local storage
        localStorage.setItem('chatUser', JSON.stringify(data.user));
        user = data.user;

        // Update UI immediate feedback
        avatarPreview.src = user.avatar;
        if (user.theme === 'dark') document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');

        alert('Settings saved!');
      } else {
        alert('Error saving settings: ' + data.error);
      }
    } catch (err) {
      alert('Error connecting to server');
    }
  });

  // Logout
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('chatUser');
    window.location.href = '/';
  });

  // Back
  backBtn.addEventListener('click', () => {
    window.location.href = '/app.html';
  });

  // Theme Toggle Live Preview
  themeToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  });
});
