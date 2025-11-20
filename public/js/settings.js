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
  const removeAvatarBtn = document.getElementById('removeAvatarBtn');
  const themeToggle = document.getElementById('themeToggle');
  const logoutBtn = document.getElementById('logoutBtn');
  const backBtn = document.getElementById('backBtn');

  // Init Values
  avatarPreview.src = user.avatar;
  displayNameInput.value = user.displayName;
  // If avatar is the default ui-avatars one, show empty in input for cleaner UX?
  // Or show the URL. User request says: "buat jangan ada link ato apa".
  // So if it contains ui-avatars, maybe show empty?
  if (user.avatar && user.avatar.includes('ui-avatars.com')) {
    avatarInput.value = '';
  } else {
    avatarInput.value = user.avatar;
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const displayName = displayNameInput.value;
    let avatar = avatarInput.value.trim();
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

        // Clear input if it matches current avatar which might be default
        if (user.avatar.includes('ui-avatars.com')) {
            avatarInput.value = '';
        }

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

  // Remove Avatar
  removeAvatarBtn.addEventListener('click', () => {
      avatarInput.value = '';
      // Preview default immediately (guessed) or just wait for save
      // Let's just wait for save, but we can show a placeholder
      // Or we can construct the default URL client side for preview
      const defaultUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayNameInput.value || user.username)}`;
      avatarPreview.src = defaultUrl;
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
