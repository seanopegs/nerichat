document.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('chatUser');
  if (!userStr) {
    window.location.href = '/';
    return;
  }

  const user = JSON.parse(userStr);
  let currentGroup = null;
  let ws;
  let groups = [];

  // UI Elements
  const userAvatar = document.getElementById('userAvatar');
  const userDisplayName = document.getElementById('userDisplayName');
  const userUsername = document.getElementById('userUsername');
  const groupsList = document.getElementById('groupsList');
  const chatHeaderName = document.getElementById('chatHeaderName');
  const groupIdDisplay = document.getElementById('groupIdDisplay');
  const groupIdText = document.getElementById('groupIdText');
  const messagesContainer = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const createGroupBtn = document.getElementById('createGroupBtn');
  const createGroupModal = document.getElementById('createGroupModal');
  const closeModal = document.querySelector('.close-modal');
  const submitCreateGroup = document.getElementById('submitCreateGroup');
  const joinGroupBtn = document.getElementById('joinGroupBtn');

  // --- Initialization ---

  // Apply Theme
  if (user.theme === 'dark') {
    document.body.classList.add('dark-mode');
  }

  // Set User Info
  userAvatar.src = user.avatar;
  userDisplayName.textContent = user.displayName;
  userUsername.textContent = '@' + user.username;

  // Connect WebSocket
  setupWebSocket();

  // Load Groups
  await loadGroups();

  // --- WebSocket ---

  function setupWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(protocol + location.host);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', username: user.username }));
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_message') {
        if (currentGroup && data.groupId === currentGroup.id) {
          appendMessage(data.message);
        }
      }
    });

    ws.addEventListener('close', () => {
      console.log('Disconnected. Reconnecting...');
      setTimeout(setupWebSocket, 3000);
    });
  }

  // --- Logic ---

  async function loadGroups() {
    try {
      const res = await fetch(`/api/my-groups?username=${user.username}`);
      const data = await res.json();
      groups = data.groups;
      renderGroups();
    } catch (err) {
      console.error(err);
    }
  }

  function renderGroups() {
    groupsList.innerHTML = '';
    groups.forEach(group => {
      const div = document.createElement('div');
      div.className = `group-item ${currentGroup && currentGroup.id === group.id ? 'active' : ''}`;
      div.innerHTML = `<span>#</span> ${group.name}`;
      div.onclick = () => switchGroup(group);
      groupsList.appendChild(div);
    });
  }

  async function switchGroup(group) {
    currentGroup = group;
    chatHeaderName.textContent = `# ${group.name}`;

    // Show Group ID
    groupIdText.textContent = group.id;
    groupIdDisplay.style.display = 'inline-block';

    renderGroups(); // update active state

    // Load messages
    messagesContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    try {
      const res = await fetch(`/api/groups/${group.id}`);
      const data = await res.json();
      messagesContainer.innerHTML = '';
      if (data.messages) {
        data.messages.forEach(appendMessage);
      }
    } catch (err) {
      messagesContainer.innerHTML = 'Error loading messages';
    }
  }

  function appendMessage(msg) {
    const isMe = msg.user === user.username;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'me' : ''}`;

    // We need avatar for other users. For simplicity, we construct it or fetch user details.
    // Since we don't have all users in memory, let's just use a default UI-Avatar or no avatar for others for now,
    // OR we can make an API call. Better: use ui-avatars with their username.
    const avatarUrl = isMe ? user.avatar : `https://ui-avatars.com/api/?name=${msg.user}`;

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <img src="${avatarUrl}" class="message-avatar" alt="Avatar">
      <div class="message-content">
        <div class="message-header">
          <span style="font-weight:600">${msg.user}</span>
          <span>${time}</span>
        </div>
        <div class="message-text"></div>
      </div>
    `;
    // Safe text insertion
    div.querySelector('.message-text').textContent = msg.text;

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    if (!currentGroup) return alert('Select a group first');
    const text = messageInput.value.trim();
    if (!text) return;

    const payload = {
      type: 'message',
      groupId: currentGroup.id,
      text: text,
      user: user.username
    };

    ws.send(JSON.stringify(payload));
    messageInput.value = '';
  }

  // --- Event Listeners ---

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Create Group
  createGroupBtn.addEventListener('click', () => {
    createGroupModal.classList.remove('hidden');
  });
  closeModal.addEventListener('click', () => {
    createGroupModal.classList.add('hidden');
  });

  submitCreateGroup.addEventListener('click', async () => {
    const name = document.getElementById('groupNameInput').value;
    if (!name) return;

    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, creator: user.username })
    });
    const data = await res.json();
    if (data.success) {
      createGroupModal.classList.add('hidden');
      document.getElementById('groupNameInput').value = '';
      await loadGroups();
      switchGroup(data.group);
    }
  });

  // Join Group (via ID)
  joinGroupBtn.addEventListener('click', async () => {
    const groupId = prompt("Enter Group ID to join:");
    if (!groupId) return;

    const res = await fetch('/api/groups/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, username: user.username })
    });

    if (res.ok) {
      await loadGroups();
      alert("Joined group!");
    } else {
      alert("Group not found");
    }
  });

  // Copy Group ID
  groupIdDisplay.addEventListener('click', () => {
    navigator.clipboard.writeText(currentGroup.id).then(() => {
      alert('Group ID copied to clipboard');
    });
  });

  // Go to Settings
  document.querySelector('.user-profile').addEventListener('click', () => {
    window.location.href = '/settings.html';
  });

});
