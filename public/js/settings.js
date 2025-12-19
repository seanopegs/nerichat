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

  if (user.avatarOriginalName) {
      avatarInput.value = user.avatarOriginalName;
      // Also set data-real-url so save logic knows the underlying path
      avatarInput.setAttribute('data-real-url', user.avatar);
  } else if (user.avatar && user.avatar.includes('ui-avatars.com')) {
    avatarInput.value = '';
  } else {
    // Fallback if no original name stored yet
    avatarInput.value = user.avatar;
  }

  if (user.invisible) {
      invisibleToggle.checked = true;
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const displayName = displayNameInput.value;
    let avatar = avatarInput.value.trim();
    let avatarOriginalName = "";

    // Check for hidden upload URL
    const realUrl = avatarInput.getAttribute('data-real-url');

    // Logic:
    // 1. If user uploaded a file, data-real-url is set, and input value is filename.
    // 2. If user pasted a URL, input value is URL.
    // 3. If user has existing file, data-real-url is set (from init), input value is original name.

    if (avatar && realUrl && !avatar.startsWith('http') && !avatar.startsWith('/')) {
         // It's likely a filename referencing the realUrl
         avatarOriginalName = avatar; // Save the filename for display next time
         avatar = realUrl; // Send the path
    } else {
        // User typed a URL or cleared it
        // If it is a URL, we don't really have an "original filename" other than the URL itself
        // But maybe we don't save avatarOriginalName for external URLs to keep it simple
    }

    const password = passwordInput.value;
    const theme = themeToggle.checked ? 'dark' : 'light';
    const invisible = invisibleToggle.checked;

    const payload = {
      username: user.username,
      displayName,
      avatar,
      avatarOriginalName,
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
      avatarInput.removeAttribute('data-real-url');
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
