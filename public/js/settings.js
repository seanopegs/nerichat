document.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('chatUser');
  if (!userStr) {
    window.location.href = '/';
    return;
  }

  let user = JSON.parse(userStr);

  // Fetch latest user data to ensure settings are up to date
  try {
    const res = await fetch(`/api/user/${user.username}`);
    if (res.ok) {
       const updatedUser = await res.json();
       // Merge safely
       user = { ...user, ...updatedUser };
       localStorage.setItem('chatUser', JSON.stringify(user));
    }
  } catch(e) {}


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
  const profileAvatarUpload = document.getElementById('profileAvatarUpload');
  const themeToggle = document.getElementById('themeToggle');
  const invisibleToggle = document.getElementById('invisibleToggle');
  const logoutBtn = document.getElementById('logoutBtn');
  const backBtn = document.getElementById('backBtn');

  // Handle File Upload
  profileAvatarUpload.addEventListener('change', async () => {
      if (profileAvatarUpload.files && profileAvatarUpload.files[0]) {
          const file = profileAvatarUpload.files[0];
          if (file.size > 1024 * 1024) return alert('File too large (max 1MB)');

          const formData = new FormData();
          formData.append('file', file);

          try {
              const res = await fetch('/api/upload', {
                  method: 'POST',
                  body: formData
              });
              const data = await res.json();
              if (data.success) {
                  avatarInput.value = data.url; // Save relative URL
                  avatarPreview.src = data.url;
              } else {
                  alert(data.error);
              }
          } catch (e) { console.error(e); }
      }
  });

  // Init Values
  avatarPreview.src = user.avatar;
  displayNameInput.value = user.displayName;
  if (user.avatar && user.avatar.includes('ui-avatars.com')) {
    avatarInput.value = '';
  } else {
    avatarInput.value = user.avatar;
  }

  if (user.invisible) {
      invisibleToggle.checked = true;
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const displayName = displayNameInput.value;
    let avatar = avatarInput.value.trim();
    const password = passwordInput.value;
    const theme = themeToggle.checked ? 'dark' : 'light';
    const invisible = invisibleToggle.checked;

    const payload = {
      username: user.username,
      displayName,
      avatar,
      theme,
      invisible
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
