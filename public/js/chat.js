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
  let friends = [];
  let friendRequests = [];
  const userCache = {}; // username -> { avatar, displayName }

  // UI Elements
  const userAvatar = document.getElementById('userAvatar');
  const userDisplayName = document.getElementById('userDisplayName');
  const userUsername = document.getElementById('userUsername');
  const groupsList = document.getElementById('groupsList');
  const friendsList = document.getElementById('friendsList');
  const tabGroups = document.getElementById('tabGroups');
  const tabFriends = document.getElementById('tabFriends');
  const chatHeaderName = document.getElementById('chatHeaderName');
  const groupIdDisplay = document.getElementById('groupIdDisplay');
  const groupIdText = document.getElementById('groupIdText');
  const messagesContainer = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  // Modals
  const createGroupBtn = document.getElementById('createGroupBtn');
  const createGroupModal = document.getElementById('createGroupModal');
  const closeModal = document.querySelector('.close-modal');
  const submitCreateGroup = document.getElementById('submitCreateGroup');

  const joinGroupBtn = document.getElementById('joinGroupBtn');

  const addFriendBtn = document.getElementById('addFriendBtn');
  const addFriendModal = document.getElementById('addFriendModal');
  const closeFriendModal = document.querySelector('.close-modal-friend');
  const friendSearchInput = document.getElementById('friendSearchInput');
  const searchUserBtn = document.getElementById('searchUserBtn');
  const searchResults = document.getElementById('searchResults');
  const friendRequestsContainer = document.getElementById('friendRequestsContainer');
  const friendsContainer = document.getElementById('friendsContainer');

  // --- Initialization ---

  // Apply Theme
  if (user.theme === 'dark') {
    document.body.classList.add('dark-mode');
  }

  // Set User Info
  userAvatar.src = user.avatar;
  userDisplayName.textContent = user.displayName;
  userUsername.textContent = '@' + user.username;

  // Cache self
  userCache[user.username] = { avatar: user.avatar, displayName: user.displayName };

  // Connect WebSocket
  setupWebSocket();

  // Load Initial Data
  await loadGroups();
  await loadFriends();

  // --- WebSocket ---

  function setupWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(protocol + location.host);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'auth', username: user.username }));
    });

    ws.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'new_message') {
        if (currentGroup && data.groupId === currentGroup.id) {
           // Send Read Receipt immediately if we are viewing this group
           ws.send(JSON.stringify({
               type: 'read_message',
               groupId: currentGroup.id,
               user: user.username
           }));
           await appendMessage(data.message);
        }
      } else if (data.type === 'read_update') {
          // Update ticks if we are viewing
          if (currentGroup && data.groupId === currentGroup.id) {
              // In a real optimized app, we update specific message.
              // Here we just re-render or update DOM elements that match.
              // For simplicity, let's just find messages not marked read and mark them.
              const ticks = document.querySelectorAll(`.message.me .read-receipt:not(.read)`);
              ticks.forEach(tick => {
                  // Check if this user is the one who read it (data.user)
                  // If data.readBy is the user, we can show blue tick.
                  tick.classList.add('read');
                  tick.innerHTML = '<i class="fas fa-check-double"></i>';
              });
          }
      }
    });

    ws.addEventListener('close', () => {
      setTimeout(setupWebSocket, 3000);
    });
  }

  // --- Logic: Users ---

  async function getUserInfo(username) {
      if (userCache[username]) return userCache[username];

      try {
          const res = await fetch(`/api/user/${username}`);
          if (res.ok) {
              const data = await res.json();
              userCache[username] = data;
              return data;
          }
      } catch (e) {
          console.error(e);
      }
      // Fallback
      const fallback = {
          displayName: username,
          avatar: `https://ui-avatars.com/api/?name=${username}`
      };
      userCache[username] = fallback;
      return fallback;
  }

  // --- Logic: Groups ---

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
      // Filter based on tab? No, "Groups" tab shows groups.
      if (group.type === 'dm') return; // DMs go to Friends/DM list?
      // Actually user asked for "add friend... then chat".
      // Usually DMs are listed separate or mixed.
      // Let's put normal groups in Groups tab.

      const div = document.createElement('div');
      div.className = `group-item ${currentGroup && currentGroup.id === group.id ? 'active' : ''}`;
      div.innerHTML = `<i class="fas fa-hashtag"></i> ${group.name}`;
      div.onclick = () => switchGroup(group);
      groupsList.appendChild(div);
    });
  }

  async function switchGroup(group) {
    currentGroup = group;
    chatHeaderName.textContent = group.type === 'dm' ? group.name : `# ${group.name}`; // For DM, name is friend's name

    // Show Group ID only if normal group
    if (group.type === 'group') {
        groupIdText.textContent = group.id;
        groupIdDisplay.style.display = 'inline-block';
    } else {
        groupIdDisplay.style.display = 'none';
    }

    // Update active class in lists
    document.querySelectorAll('.group-item, .friend-item').forEach(el => el.classList.remove('active'));
    // This is tricky without ID references in DOM, but re-render handles it mostly.
    renderGroups();
    renderFriends(); // To highlight if it's a DM

    // Load messages
    messagesContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    try {
      const res = await fetch(`/api/groups/${group.id}`);
      const data = await res.json();
      messagesContainer.innerHTML = '';
      if (data.messages) {
        for (const msg of data.messages) {
            await appendMessage(msg);
        }
        // Send read receipt
        ws.send(JSON.stringify({
            type: 'read_message',
            groupId: group.id,
            user: user.username
        }));
      }
    } catch (err) {
      messagesContainer.innerHTML = 'Error loading messages';
    }
  }

  async function appendMessage(msg) {
    const isMe = msg.user === user.username;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'me' : ''}`;

    const userInfo = await getUserInfo(msg.user);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Check read status
    // If I am viewing, I just read it (handled by ws send).
    // If looking at past messages:
    // A message is read if readBy contains someone ELSE than the sender?
    // User wants: 1 tick = delivered (server saved), 1 blue tick = read.
    // If msg.readBy has > 1 person (sender is always in it), it's read.
    const isRead = msg.readBy && msg.readBy.length > 1;
    const tickIcon = isRead ? '<i class="fas fa-check-double"></i>' : '<i class="fas fa-check"></i>';
    const tickClass = isRead ? 'read' : '';

    div.innerHTML = `
      <img src="${userInfo.avatar}" class="message-avatar" alt="Avatar">
      <div class="message-content">
        <div class="message-header">
          <span style="font-weight:600">${userInfo.displayName}</span>
          <span>${time}</span>
        </div>
        <div class="message-text"></div>
        <div class="message-footer">
           <span class="read-receipt ${tickClass}">${tickIcon}</span>
        </div>
      </div>
    `;
    div.querySelector('.message-text').textContent = msg.text;

    // Right click context menu for read info (Simplified: just title for now)
    if (msg.readBy && msg.readBy.length > 0) {
         div.querySelector('.message-content').title = "Read by: " + msg.readBy.join(', ');
    }

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function sendMessage() {
    if (!currentGroup) return alert('Select a group or friend first');
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
    // Resize textarea reset
    messageInput.style.height = 'auto';
  }

  // --- Logic: Friends ---

  async function loadFriends() {
      try {
          const res = await fetch(`/api/friends?username=${user.username}`);
          const data = await res.json();
          friends = data.friends;
          friendRequests = data.friendRequests;
          renderFriends();
      } catch (e) { console.error(e); }
  }

  function renderFriends() {
      friendRequestsContainer.innerHTML = '';
      friendsContainer.innerHTML = '';

      // Requests
      if (friendRequests.length > 0) {
          const reqHeader = document.createElement('div');
          reqHeader.innerHTML = '<small style="padding:5px; color:var(--text-muted)">Requests</small>';
          friendRequestsContainer.appendChild(reqHeader);

          friendRequests.forEach(req => {
              const div = document.createElement('div');
              div.className = 'friend-request-item';
              div.innerHTML = `
                <div><strong>${req.from}</strong> wants to be friends</div>
                <div class="friend-request-actions">
                    <button class="btn btn-sm btn-primary" onclick="respondFriend('${req.from}', 'accept')">Accept</button>
                    <button class="btn btn-sm btn-danger" onclick="respondFriend('${req.from}', 'deny')">Deny</button>
                </div>
              `;
              friendRequestsContainer.appendChild(div);
          });
      }

      // Friends List
      const friendsHeader = document.createElement('div');
      friendsHeader.innerHTML = '<small style="padding:5px; color:var(--text-muted)">Friends</small>';
      friendsContainer.appendChild(friendsHeader);

      friends.forEach(friend => {
          const div = document.createElement('div');
          // Check if this friend DM is active
          const isDmActive = currentGroup && currentGroup.type === 'dm' && currentGroup.name === friend.displayName; // name logic is slightly loose
          // Better: Check ID if we mapped it. For now, just list.

          div.className = `friend-item`;
          div.innerHTML = `
            <img src="${friend.avatar}" style="width:30px;height:30px;border-radius:50%">
            <span>${friend.displayName}</span>
          `;
          div.onclick = () => startDM(friend);
          friendsContainer.appendChild(div);
      });
  }

  // Expose for inline onclick
  window.respondFriend = async (from, action) => {
      await fetch('/api/friends/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: user.username, from, action })
      });
      await loadFriends();
  };

  async function startDM(friend) {
      // Create or Get DM Group
      try {
          const res = await fetch('/api/groups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  creator: user.username,
                  members: [friend.username],
                  type: 'dm',
                  name: "DM" // Name ignored by server logic for DMs usually, or used as placeholder
              })
          });
          const data = await res.json();
          if (data.success) {
              // We manually set the name for display purpose
              data.group.name = friend.displayName;
              await loadGroups(); // Refresh groups to ensure it exists in list (though we filter it out of groups tab)
              switchGroup(data.group);
          }
      } catch (e) { console.error(e); }
  }

  // --- Event Listeners ---

  sendBtn.addEventListener('click', sendMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if (!e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        // Shift+Enter allows default behavior (new line)
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
  });

  // Tabs
  tabGroups.addEventListener('click', () => {
      tabGroups.classList.add('active');
      tabFriends.classList.remove('active');
      groupsList.classList.remove('hidden');
      friendsList.classList.add('hidden');
  });

  tabFriends.addEventListener('click', () => {
      tabFriends.classList.add('active');
      tabGroups.classList.remove('active');
      friendsList.classList.remove('hidden');
      groupsList.classList.add('hidden');
  });

  // Modals
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

  // Add Friend
  addFriendBtn.addEventListener('click', () => {
      addFriendModal.classList.remove('hidden');
      searchResults.innerHTML = '';
      friendSearchInput.value = '';
  });
  closeFriendModal.addEventListener('click', () => {
      addFriendModal.classList.add('hidden');
  });

  searchUserBtn.addEventListener('click', async () => {
      const query = friendSearchInput.value;
      if (!query) return;

      const res = await fetch(`/api/users/search?query=${query}`);
      const data = await res.json();

      searchResults.innerHTML = '';
      if (data.users.length === 0) {
          searchResults.innerHTML = '<div style="padding:10px">No user found</div>';
      } else {
          data.users.forEach(u => {
              if (u.username === user.username) return; // Don't show self

              const div = document.createElement('div');
              div.className = 'search-result-item';
              div.innerHTML = `
                <img src="${u.avatar}">
                <div style="flex:1">
                    <div style="font-weight:bold">${u.displayName}</div>
                    <div style="font-size:0.8rem">@${u.username}</div>
                </div>
                <button class="btn btn-sm btn-primary">Add</button>
              `;
              div.querySelector('button').onclick = async () => {
                  const r = await fetch('/api/friends/request', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ from: user.username, to: u.username })
                  });
                  const rd = await r.json();
                  if (rd.success) {
                      alert('Request sent!');
                      addFriendModal.classList.add('hidden');
                  } else {
                      alert(rd.error);
                  }
              };
              searchResults.appendChild(div);
          });
      }
  });

  // Join Group
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
      // Fallback for non-secure contexts
      if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(currentGroup.id).then(() => alert('ID Copied!'));
      } else {
          const textArea = document.createElement("textarea");
          textArea.value = currentGroup.id;
          textArea.style.position = "fixed";
          textArea.style.left = "-9999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
              document.execCommand('copy');
              alert('ID Copied!');
          } catch (err) {
              console.error('Unable to copy', err);
              prompt("Copy this ID:", currentGroup.id);
          }
          document.body.removeChild(textArea);
      }
  });

  // Go to Settings
  document.querySelector('.user-profile').addEventListener('click', () => {
    window.location.href = '/settings.html';
  });

});
