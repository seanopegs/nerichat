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
    if (res.status === 404) {
        alert('Account deleted or session invalid.');
        localStorage.removeItem('chatUser');
        window.location.href = '/';
        return;
    }
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
          let file = profileAvatarUpload.files[0];
          if (file.size > 1024 * 1024) return alert('File too large (max 1MB)');

          try {
             file = await CropperUtils.cropImage(file, 1);
          } catch(e) { return; }

          const formData = new FormData();
          formData.append('file', file);

          try {
              const res = await fetch('/api/upload?type=avatar', {
                  method: 'POST',
                  body: formData
              });
              const data = await res.json();
              if (data.success) {
                  avatarInput.value = data.originalFilename; // Show filename to user
                  avatarInput.setAttribute('data-real-url', data.url); // Store real URL
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
    // Check if it looks like an uploaded file path to show friendly name (optional, but tricky without storing original name)
    // For now, just show value. If they re-upload, it will fix.
    avatarInput.value = user.avatar;
  }

  if (user.invisible) {
      invisibleToggle.checked = true;
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const displayName = displayNameInput.value;
    let avatar = avatarInput.value.trim();

    // Check for hidden upload URL
    const realUrl = avatarInput.getAttribute('data-real-url');
    // If the input value matches the original filename (roughly), use the real URL
    // Or simpler: if realUrl exists and input value is not empty (user didn't clear it), use realUrl.
    // But what if user changed text manually?
    // Let's say: if input value == originalFilename from upload (we didn't store it separately, just in value).
    // If user types a URL, it won't have data-real-url set (unless they uploaded then typed).
    // Safest: If data-real-url is set, and input value DOES NOT start with http/https, use data-real-url.
    // If input value starts with http, they probably pasted a link.
    // If input value is a path /uploads/, use it.

    if (realUrl && !avatar.startsWith('http') && !avatar.startsWith('/')) {
         avatar = realUrl;
    }

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
    window.location.href = '/app/';
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
