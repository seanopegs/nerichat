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

  // Reply State
  let replyToMessage = null;
  const chatInputArea = document.querySelector('.chat-input-area');

  // Create Reply Banner (Hidden by default)
  const replyBanner = document.createElement('div');
  replyBanner.className = 'reply-banner hidden';
  replyBanner.style.padding = '10px';
  replyBanner.style.background = 'var(--bg-color)';
  replyBanner.style.borderTop = '1px solid var(--border-color)';
  replyBanner.style.display = 'none'; // Hidden initially
  replyBanner.style.alignItems = 'center';
  replyBanner.style.justifyContent = 'space-between';

  replyBanner.innerHTML = `
    <div style="display:flex; flex-direction:column; overflow:hidden;">
       <span style="font-size:0.8rem; color:var(--primary); font-weight:bold;">Replying to <span id="replyToUser"></span></span>
       <span id="replyToText" style="font-size:0.8rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>
    </div>
    <button id="cancelReplyBtn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.2rem;">&times;</button>
  `;

  // Insert before chat input
  chatInputArea.parentNode.insertBefore(replyBanner, chatInputArea);

  document.getElementById('cancelReplyBtn').onclick = () => {
      replyToMessage = null;
      replyBanner.style.display = 'none';
  };

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

  const groupInfoModal = document.getElementById('groupInfoModal');
  const closeInfoModal = document.querySelector('.close-modal-info');

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

      if (data.type === 'error') {
          alert(data.message);
      }
      else if (data.type === 'new_message') {
        if (currentGroup && data.groupId === currentGroup.id) {
           // Send Read Receipt immediately if we are viewing this group
           ws.send(JSON.stringify({
               type: 'read_message',
               groupId: currentGroup.id,
               user: user.username
           }));
           await appendMessage(data.message);
        } else {
            // Just mark as received if we are online but not viewing group
            ws.send(JSON.stringify({
               type: 'received_message',
               groupId: data.groupId,
               user: user.username,
               messageId: data.message.id
           }));
            // Increment unread count locally
            const gIndex = groups.findIndex(g => g.id === data.groupId);
            if (gIndex !== -1) {
                if (!groups[gIndex].unreadCount) groups[gIndex].unreadCount = 0;
                groups[gIndex].unreadCount++;
                renderGroups();
                renderFriends();
            }
        }
      } else if (data.type === 'read_update') {
          if (currentGroup && data.groupId === currentGroup.id) {
             updateReadReceipts(data.user);
          }
      } else if (data.type === 'delivery_update') {
          if (currentGroup && data.groupId === currentGroup.id) {
             updateDeliveryReceipts(data.user);
          }
      } else if (data.type === 'group_deleted') {
          if (currentGroup && currentGroup.id === data.groupId) {
              alert('This group has been deleted by the owner.');
              window.location.reload();
          } else {
              await loadGroups();
          }
      } else if (data.type === 'group_id_changed') {
          if (currentGroup && currentGroup.id === data.oldId) {
              alert('Group ID has been reset. Reloading...');
              // Just switch to new group logic effectively
              window.location.reload();
          } else {
              await loadGroups();
          }
      }
    });

    ws.addEventListener('close', () => {
      setTimeout(setupWebSocket, 3000);
    });
  }

  function updateReadReceipts(readByUser) {
      // Simplistic update: find all double ticks and turn blue if criteria met
      // Actually we need to re-check logic for each message.
      // But since we don't have full message state in DOM, we might need to just turn all "delivered" into "read" if we assume sequentially?
      // Better: Just re-render visible messages or specific update.
      // Let's do a quick DOM update for own messages.

      const msgs = document.querySelectorAll('.message.me');
      msgs.forEach(div => {
          const tick = div.querySelector('.read-receipt');
          if (tick && !tick.classList.contains('read')) {
              // If we don't have the msg object, we can't check list.
              // But `read_update` event usually means *someone* read it.
              // If it's a DM, that's enough.
              // If Group, we need to know if *everyone* read it.
              // This is hard without local state of messages.
              // Let's fetch messages again to be accurate or just assume "Blue" if *someone* read in DM.
              if (currentGroup.type === 'dm') {
                   tick.classList.add('read');
                   tick.innerHTML = '<i class="fas fa-check-double"></i>'; // Blue
              } else {
                  // In group, re-fetch might be heavy.
                  // Let's just keep it gray until reload unless we track state.
                  // User said "like whatsapp" -> Needs to be accurate.
                  // Let's re-fetch the specific message? No API for that.
                  // Let's fetch group messages again silently?
                  // Or simpler: Add data-read-by attribute to DOM
                  let readBy = div.getAttribute('data-read-by') ? JSON.parse(div.getAttribute('data-read-by')) : [];
                  if (!readBy.includes(readByUser)) readBy.push(readByUser);
                  div.setAttribute('data-read-by', JSON.stringify(readBy));

                  // Check count
                  // We need total members count.
                  // currentGroup.members count.
                  // If readBy.length >= currentGroup.members.length (minus 1 for sender? actually list includes sender)
                  // Let's rely on re-rendering for accuracy or simple reload.
                  // Let's Try to update visual based on local calc.

                  // NOTE: currentGroup.members might be just IDs. We need count.
                  if (readBy.length >= currentGroup.members.length) {
                       tick.classList.add('read'); // Blue
                       tick.innerHTML = '<i class="fas fa-check-double"></i>';
                  }
              }
          }
      });
  }

  function updateDeliveryReceipts(receivedByUser) {
      const msgs = document.querySelectorAll('.message.me');
      msgs.forEach(div => {
          const tick = div.querySelector('.read-receipt');
          if (tick && !tick.classList.contains('read')) { // Only if not already blue
               // Check if single tick, make double gray
               const icon = tick.querySelector('i');
               if (icon && icon.classList.contains('fa-check') && !icon.classList.contains('fa-check-double')) {
                   // It was single check
                   // Now update received list
                   let receivedBy = div.getAttribute('data-received-by') ? JSON.parse(div.getAttribute('data-received-by')) : [];
                   if (!receivedByUser) return;
                   if (!receivedBy.includes(receivedByUser)) receivedBy.push(receivedByUser);
                   div.setAttribute('data-received-by', JSON.stringify(receivedBy));

                   // Logic: If DM, 1 other person received -> Double tick
                   // If Group, if *everyone* received? Or *anyone*?
                   // User said "2 centang = orgnya udh nerima".
                   // Usually in groups, 2 ticks = Delivered to all.
                   if (currentGroup.type === 'dm') {
                       tick.innerHTML = '<i class="fas fa-check-double"></i>';
                   } else {
                       if (receivedBy.length >= currentGroup.members.length) {
                           tick.innerHTML = '<i class="fas fa-check-double"></i>';
                       }
                   }
               }
          }
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
      // Re-fetch user to get pinned chats
      const userRes = await fetch(`/api/user/${user.username}`);
      if (userRes.ok) {
          const userData = await userRes.json();
          user.pinned_chats = userData.pinned_chats || [];
      }

      const res = await fetch(`/api/my-groups?username=${user.username}`);
      const data = await res.json();
      groups = data.groups;

      // Sort groups: Pinned first, then alphabetical (or last msg if we had it)
      groups.sort((a, b) => {
          const aPinned = user.pinned_chats && user.pinned_chats.includes(a.id);
          const bPinned = user.pinned_chats && user.pinned_chats.includes(b.id);
          if (aPinned && !bPinned) return -1;
          if (!aPinned && bPinned) return 1;
          return a.name.localeCompare(b.name);
      });

      renderGroups();
    } catch (err) {
      console.error(err);
    }
  }

  function renderGroups() {
    groupsList.innerHTML = '';
    groups.forEach(group => {
      // Filter based on tab? No, "Groups" tab shows groups.
      if (group.type === 'dm') return;

      const div = document.createElement('div');
      div.className = `group-item ${currentGroup && currentGroup.id === group.id ? 'active' : ''}`;

      let badge = '';
      if (group.unreadCount > 0) {
          badge = `<span style="background:red; color:white; border-radius:50%; padding:2px 6px; font-size:0.7rem; margin-left:auto;">${group.unreadCount}</span>`;
      }

      let pinIcon = '';
      if (user.pinned_chats && user.pinned_chats.includes(group.id)) {
          pinIcon = '<i class="fas fa-thumbtack" style="color:var(--primary); margin-right:5px; font-size:0.8rem;"></i>';
      }

      div.innerHTML = `${pinIcon}<i class="fas fa-hashtag"></i> ${group.name} ${badge}`;
      div.onclick = () => switchGroup(group);

      // Context Menu
      div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e, group);
      });
      div.addEventListener('dblclick', (e) => {
          e.preventDefault();
          openGroupInfo(group);
      });

      groupsList.appendChild(div);
    });
  }

  // Generic Context Menu
  let contextMenu = null;

  function showContextMenu(e, target) {
      if (contextMenu) document.body.removeChild(contextMenu);

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      contextMenu.style.position = 'absolute';
      contextMenu.style.left = e.pageX + 'px';
      contextMenu.style.top = e.pageY + 'px';
      contextMenu.style.background = 'var(--card-bg)';
      contextMenu.style.border = '1px solid var(--border-color)';
      contextMenu.style.borderRadius = '8px';
      contextMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';
      contextMenu.style.overflow = 'hidden';

      const createOption = (text, iconClass, onClick) => {
          const div = document.createElement('div');
          div.style.padding = '10px 15px';
          div.style.cursor = 'pointer';
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.gap = '10px';
          div.innerHTML = `<i class="${iconClass}"></i> ${text}`;
          div.onmouseover = () => div.style.background = 'var(--bg-color)';
          div.onmouseout = () => div.style.background = 'transparent';
          div.onclick = () => {
              document.body.removeChild(contextMenu);
              contextMenu = null;
              onClick();
          };
          return div;
      };

      // Pin Option
      const isPinned = user.pinned_chats && user.pinned_chats.includes(target.id);
      contextMenu.appendChild(createOption(isPinned ? "Unpin" : "Pin", "fas fa-thumbtack", async () => {
          const res = await fetch('/api/user/pin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: user.username, groupId: target.id, action: isPinned ? 'unpin' : 'pin' })
          });
          if (res.ok) {
              const data = await res.json();
              if (data.error) alert(data.error);
              else {
                  user.pinned_chats = data.pinned_chats; // Update local
                  await loadGroups(); // Re-sort and render
              }
          }
      }));

      // Info Option (if group)
      if (target.type === 'group') {
          contextMenu.appendChild(createOption("Group Info", "fas fa-info-circle", () => openGroupInfo(target)));
      }

      document.body.appendChild(contextMenu);

      // Close on click elsewhere
      const close = () => {
          if (contextMenu && document.body.contains(contextMenu)) {
              document.body.removeChild(contextMenu);
              contextMenu = null;
          }
          document.removeEventListener('click', close);
      };
      setTimeout(() => document.addEventListener('click', close), 0);
  }

  async function switchGroup(group) {
    currentGroup = group;
    chatHeaderName.textContent = group.type === 'dm' ? group.name : `# ${group.name}`;

    if (group.type === 'group') {
        groupIdText.textContent = group.id;
        groupIdDisplay.style.display = 'inline-block';

        // Settings Click on Header
        chatHeaderName.style.cursor = 'pointer';
        chatHeaderName.onclick = () => openGroupInfo(group);
    } else {
        groupIdDisplay.style.display = 'none';
        chatHeaderName.style.cursor = 'default';
        chatHeaderName.onclick = null;
    }

    document.querySelectorAll('.group-item, .friend-item').forEach(el => el.classList.remove('active'));
    renderGroups();
    renderFriends();

    // Update local unread count for the switched group to 0
    const gIndex = groups.findIndex(g => g.id === group.id);
    if (gIndex !== -1) {
        groups[gIndex].unreadCount = 0;
    }

    document.querySelectorAll('.group-item, .friend-item').forEach(el => el.classList.remove('active'));
    renderGroups();
    renderFriends();

    // Load messages
    messagesContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    try {
      const res = await fetch(`/api/groups/${group.id}`);
      const data = await res.json();

      // Update full group object with details (members, owner, etc)
      currentGroup = data;

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
    if (msg.type === 'system') {
        const div = document.createElement('div');
        div.className = 'message system-message';
        div.innerHTML = `<small style="color:var(--text-muted); display:block; text-align:center; margin: 10px 0;">${msg.text}</small>`;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
    }

    const isMe = msg.user === user.username;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'me' : ''}`;

    // Store read/received state for live updates
    div.setAttribute('data-read-by', JSON.stringify(msg.readBy || []));
    div.setAttribute('data-received-by', JSON.stringify(msg.receivedBy || []));

    const userInfo = await getUserInfo(msg.user);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Ticks Logic
    // Only for me
    let tickHtml = '';
    let tickClass = '';

    if (isMe) {
        const readCount = (msg.readBy || []).length;
        const receivedCount = (msg.receivedBy || []).length;
        const memberCount = currentGroup.members.length; // Total members in group

        // Logic for ticks
        // 1 Tick: Delivered to server (Always true if we are here)
        // 2 Gray Ticks: Delivered to all (receivedCount >= memberCount)
        // 2 Blue Ticks: Read by all (readCount >= memberCount)

        // Note: msg.readBy includes sender usually.

        let isRead = readCount >= memberCount;
        let isReceived = receivedCount >= memberCount;

        if (currentGroup.type === 'dm') {
            // For DM, memberCount is 2.
            // If other person is in readBy, it's read.
            // If other person is in receivedBy, it's received.
            // We can check if length > 1
             isRead = readCount > 1;
             isReceived = receivedCount > 1;
        }

        if (isRead) {
            tickHtml = '<i class="fas fa-check-double"></i>';
            tickClass = 'read'; // Blue
        } else if (isReceived) {
            tickHtml = '<i class="fas fa-check-double"></i>'; // Gray
        } else {
            tickHtml = '<i class="fas fa-check"></i>'; // Gray single
        }
    }

    div.innerHTML = `
      <img src="${userInfo.avatar}" class="message-avatar" alt="Avatar">
      <div class="message-content">
        ${msg.replyTo ? `<div class="reply-quote" style="border-left:3px solid var(--primary); padding-left:5px; margin-bottom:5px; opacity:0.8; font-size:0.85rem;">
             <div style="font-weight:bold">${msg.replyTo.userDisplayName || 'User'}</div>
             <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${msg.replyTo.text}</div>
        </div>` : ''}
        <div class="message-header">
          <span style="font-weight:600">${userInfo.displayName}</span>
          <span>${time}</span>
        </div>
        <div class="message-text"></div>
        <div class="message-footer">
           ${isMe ? `<span class="read-receipt ${tickClass}">${tickHtml}</span>` : ''}
        </div>
      </div>
    `;
    div.querySelector('.message-text').textContent = msg.text;

    // Tooltip
    if (isMe && msg.readBy && msg.readBy.length > 0) {
         div.querySelector('.message-content').title = "Read by: " + msg.readBy.join(', ');
    }

    // Message Context Menu
    div.querySelector('.message-content').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, msg, userInfo);
    });

    // Long press (Alternative for mobile/tablet)
    let pressTimer;
    div.querySelector('.message-content').addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => showMessageContextMenu(null, msg, userInfo), 800);
    });
    div.querySelector('.message-content').addEventListener('mouseup', () => clearTimeout(pressTimer));

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showMessageContextMenu(e, msg, userInfo) {
      if (contextMenu) document.body.removeChild(contextMenu);

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      // Use event position or center if triggered by long press without event
      const x = e ? e.pageX : (window.innerWidth / 2) - 75;
      const y = e ? e.pageY : (window.innerHeight / 2) - 50;

      contextMenu.style.position = 'absolute';
      contextMenu.style.left = x + 'px';
      contextMenu.style.top = y + 'px';
      contextMenu.style.background = 'var(--card-bg)';
      contextMenu.style.border = '1px solid var(--border-color)';
      contextMenu.style.borderRadius = '8px';
      contextMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';

      const createOption = (text, iconClass, onClick) => {
          const div = document.createElement('div');
          div.style.padding = '10px 15px';
          div.style.cursor = 'pointer';
          div.innerHTML = `<i class="${iconClass}"></i> ${text}`;
          div.onmouseover = () => div.style.background = 'var(--bg-color)';
          div.onmouseout = () => div.style.background = 'transparent';
          div.onclick = () => {
              document.body.removeChild(contextMenu);
              contextMenu = null;
              onClick();
          };
          return div;
      };

      // Reply
      contextMenu.appendChild(createOption("Reply", "fas fa-reply", () => {
          replyToMessage = { id: msg.id, text: msg.text, userDisplayName: userInfo.displayName };
          document.getElementById('replyToUser').textContent = userInfo.displayName;
          document.getElementById('replyToText').textContent = msg.text;
          replyBanner.style.display = 'flex';
          messageInput.focus();
      }));

      // Seen By (Only in groups)
      if (currentGroup.type !== 'dm') {
          contextMenu.appendChild(createOption("Seen by", "fas fa-eye", async () => {
              // Show modal with readBy list
              const readByList = msg.readBy || [];
              let content = '';
              if (readByList.length === 0) content = '<p>No one yet.</p>';
              else {
                  content = '<ul style="list-style:none; padding:0;">';
                  for(const u of readByList) {
                      const info = await getUserInfo(u);
                      content += `<li style="padding:5px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:10px;">
                        <img src="${info.avatar}" style="width:30px;height:30px;border-radius:50%">
                        <span>${info.displayName}</span>
                      </li>`;
                  }
                  content += '</ul>';
              }

              // Quick Alert for now or use a modal. Let's reuse info modal structure but dynamic?
              // Let's create a simple overlay.
              const overlay = document.createElement('div');
              overlay.className = 'modal';
              overlay.innerHTML = `
                 <div class="modal-content">
                    <div class="modal-header">
                        <span>Seen By</span>
                        <span class="close-modal" style="cursor:pointer">&times;</span>
                    </div>
                    <div style="max-height:300px; overflow-y:auto;">${content}</div>
                 </div>
              `;
              document.body.appendChild(overlay);
              overlay.querySelector('.close-modal').onclick = () => document.body.removeChild(overlay);
          }));
      }

      document.body.appendChild(contextMenu);

      const close = () => {
          if (contextMenu && document.body.contains(contextMenu)) {
              document.body.removeChild(contextMenu);
              contextMenu = null;
          }
          document.removeEventListener('click', close);
      };
      setTimeout(() => document.addEventListener('click', close), 0);
  }

  function sendMessage() {
    if (!currentGroup) return alert('Select a group or friend first');
    const text = messageInput.value.trim();
    if (!text) return;

    const payload = {
      type: 'message',
      groupId: currentGroup.id,
      text: text,
      user: user.username,
      replyTo: replyToMessage // Attach reply data
    };

    ws.send(JSON.stringify(payload));
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Clear Reply
    replyToMessage = null;
    replyBanner.style.display = 'none';
  }

  // --- Logic: Group Info Modal ---

  async function openGroupInfo(group) {
      // Fetch latest group data to ensure members list is up to date
      const res = await fetch(`/api/groups/${group.id}`);
      if (!res.ok) return;
      const fullGroup = await res.json();

      document.getElementById('infoGroupName').textContent = fullGroup.name;
      document.getElementById('infoGroupId').textContent = fullGroup.id;
      document.getElementById('infoGroupAvatar').src = fullGroup.avatar || `https://ui-avatars.com/api/?name=${fullGroup.name}`;

      const isOwner = fullGroup.owner === user.username;
      const ownerControls = document.getElementById('ownerControls');

      if (isOwner && fullGroup.type !== 'dm') {
          ownerControls.classList.remove('hidden');
      } else {
          ownerControls.classList.add('hidden');
      }

      const list = document.getElementById('groupMembersList');
      list.innerHTML = '';

      for (const memberUsername of fullGroup.members) {
          const u = await getUserInfo(memberUsername);
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.padding = '10px 0';
          row.style.borderBottom = '1px solid #eee';

          let roleTag = '';
          if (fullGroup.owner === memberUsername) roleTag = '<span style="background:#ffd700; padding:2px 5px; font-size:0.7rem; border-radius:4px; margin-left:5px;">Owner</span>';
          else if (fullGroup.admins && fullGroup.admins.includes(memberUsername)) roleTag = '<span style="background:#ccc; padding:2px 5px; font-size:0.7rem; border-radius:4px; margin-left:5px;">Admin</span>';

          row.innerHTML = `
            <img src="${u.avatar}" style="width:40px;height:40px;border-radius:50%;margin-right:10px;">
            <div style="flex:1">
                <div><strong>${u.displayName}</strong> ${roleTag}</div>
                <div style="font-size:0.8rem;color:gray">@${u.username}</div>
            </div>
          `;

          // Context Menu for actions
          if (memberUsername !== user.username && fullGroup.type !== 'dm') {
              // Actions: Kick, Promote/Demote
              const actionsDiv = document.createElement('div');

              // Kick logic
              const canKick = isOwner || (fullGroup.admins && fullGroup.admins.includes(user.username) && memberUsername !== fullGroup.owner && (!fullGroup.admins.includes(memberUsername) || isOwner));

              if (canKick) {
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-danger';
                  btn.textContent = 'Kick';
                  btn.style.marginLeft = '5px';
                  btn.onclick = () => kickMember(fullGroup.id, memberUsername);
                  actionsDiv.appendChild(btn);
              }

              // Promote/Demote
              if (isOwner) {
                  const isAdmin = fullGroup.admins && fullGroup.admins.includes(memberUsername);
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-secondary';
                  btn.textContent = isAdmin ? 'Demote' : 'Promote';
                  btn.style.marginLeft = '5px';
                  btn.onclick = () => toggleAdmin(fullGroup.id, memberUsername, !isAdmin);
                  actionsDiv.appendChild(btn);
              }

              // Mute (Admin/Owner)
              // Logic: Owner can mute anyone (except self). Admin can mute members (not other admins/owner).
              const canMute = isOwner || (fullGroup.admins && fullGroup.admins.includes(user.username) && memberUsername !== fullGroup.owner && (!fullGroup.admins.includes(memberUsername) || isOwner));

              if (canMute) {
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-warning';
                  // Check if already muted
                  const isMuted = fullGroup.muted && fullGroup.muted[memberUsername] && (fullGroup.muted[memberUsername] === -1 || fullGroup.muted[memberUsername] > Date.now());

                  btn.textContent = isMuted ? 'Unmute' : 'Mute';
                  btn.style.marginLeft = '5px';
                  btn.onclick = () => {
                      if (isMuted) unmuteMember(fullGroup.id, memberUsername);
                      else openMuteModal(fullGroup.id, memberUsername);
                  };
                  actionsDiv.appendChild(btn);
              }

              row.appendChild(actionsDiv);
          }

          list.appendChild(row);
      }

      // Add Member (If permission allows)
      const isMember = fullGroup.members.includes(user.username);
      const isAdmin = fullGroup.admins && fullGroup.admins.includes(user.username);
      const invitePerm = fullGroup.invite_permission || 'admin';

      let canInvite = false;
      if (invitePerm === 'all' && isMember) canInvite = true;
      if (invitePerm === 'admin' && (isAdmin || isOwner)) canInvite = true;

      const addMemberBtn = document.getElementById('addMemberBtn'); // Needs to be added to HTML or created dynamically

      // Since the HTML structure for addMemberBtn might not exist in modal footer, let's inject it into footer if owner/admin controls are there.
      // Or just append to ownerControls if visible, or create a new section.
      // Let's look for a place. There's 'ownerControls' div.

      // Let's check if we have an add member button already in HTML or need to create.
      // The provided HTML in memory/context doesn't show the modal HTML structure fully.
      // Assuming we can add it to ownerControls or near it.

      let inviteSection = document.getElementById('inviteSection');
      if (!inviteSection) {
          inviteSection = document.createElement('div');
          inviteSection.id = 'inviteSection';
          inviteSection.style.marginTop = '10px';
          document.getElementById('ownerControls').parentNode.insertBefore(inviteSection, document.getElementById('ownerControls'));
      }
      inviteSection.innerHTML = '';

      if (canInvite && fullGroup.type !== 'dm') {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.textContent = 'Add Member';
          btn.onclick = () => openInviteModal(fullGroup);
          inviteSection.appendChild(btn);
      }

      // Settings Toggle for Invite Permission (Owner Only)
      if (isOwner && fullGroup.type !== 'dm') {
          const toggleDiv = document.createElement('div');
          toggleDiv.style.marginTop = '10px';
          toggleDiv.innerHTML = `
            <label class="switch-container">
                <span>Allow all members to invite</span>
                <input type="checkbox" id="invitePermToggle" ${invitePerm === 'all' ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
          `;
          // We need CSS for toggle switch to look "premium" as requested.
          // Assuming CSS exists or we use standard checkbox for logic first.
          // User asked for toggle switches.

          inviteSection.appendChild(toggleDiv);

          toggleDiv.querySelector('input').onchange = async (e) => {
              const newPerm = e.target.checked ? 'all' : 'admin';
              await fetch('/api/groups/settings', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ groupId: fullGroup.id, requester: user.username, invite_permission: newPerm })
              });
          };
      }

      // Bind Footer Actions
      document.getElementById('leaveGroupBtn').onclick = () => leaveGroup(fullGroup.id);

      if (isOwner) {
        document.getElementById('deleteGroupBtn').onclick = () => deleteGroup(fullGroup.id);
        document.getElementById('resetGroupIdBtn').onclick = () => resetGroupId(fullGroup.id);
        document.getElementById('saveGroupSettingsBtn').onclick = () => updateGroupSettings(fullGroup.id);
      }

      groupInfoModal.classList.remove('hidden');
  }

  async function kickMember(groupId, target) {
      if(!confirm(`Kick ${target}?`)) return;
      await fetch('/api/groups/kick', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username, target })
      });
      // Refresh info
      openGroupInfo({id: groupId});
  }

  async function toggleAdmin(groupId, target, makeAdmin) {
      const endpoint = makeAdmin ? '/api/groups/promote' : '/api/groups/demote';
      await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username, target })
      });
      openGroupInfo({id: groupId});
  }

  async function leaveGroup(groupId) {
      if(!confirm('Leave this group?')) return;
      await fetch('/api/groups/leave', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, username: user.username })
      });
      groupInfoModal.classList.add('hidden');
      window.location.reload();
  }

  async function deleteGroup(groupId) {
      if(!confirm('Delete this group entirely? This cannot be undone.')) return;
      await fetch('/api/groups/delete', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username })
      });
      groupInfoModal.classList.add('hidden');
      window.location.reload();
  }

  async function resetGroupId(groupId) {
      if(!confirm('Reset Group ID? The old ID will become invalid.')) return;
      const res = await fetch('/api/groups/reset-id', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username })
      });
      const data = await res.json();
      if (data.success) {
          alert('Group ID Reset. New ID: ' + data.newId);
          groupInfoModal.classList.add('hidden');
          // Reload to reflect? The socket will handle it too.
      }
  }

  async function updateGroupSettings(groupId) {
      const avatar = document.getElementById('editGroupAvatarInput').value;
      if (avatar) {
          await fetch('/api/groups/settings', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ groupId, requester: user.username, avatar })
          });
          // Refresh
           openGroupInfo({id: groupId});
      }
  }

  closeInfoModal.addEventListener('click', () => {
      groupInfoModal.classList.add('hidden');
  });

  // --- Logic: Invite & Mute Modals ---

  function openInviteModal(group) {
      // Create a simple modal dynamically
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
         <div class="modal-content">
            <div class="modal-header">
                <span>Invite Friend to ${group.name}</span>
                <span class="close-modal" style="cursor:pointer">&times;</span>
            </div>
            <div id="inviteFriendList" style="max-height:300px; overflow-y:auto;"></div>
         </div>
      `;

      const list = overlay.querySelector('#inviteFriendList');

      friends.forEach(f => {
          // Filter already in group
          if (group.members.includes(f.username)) return;

          const div = document.createElement('div');
          div.className = 'friend-item';
          div.innerHTML = `
            <img src="${f.avatar}" style="width:30px;height:30px;border-radius:50%">
            <span>${f.displayName}</span>
            <button class="btn btn-sm btn-primary" style="margin-left:auto">Add</button>
          `;
          div.querySelector('button').onclick = async () => {
              const res = await fetch('/api/groups/invite', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ groupId: group.id, requester: user.username, target: f.username })
              });
              if (res.ok) {
                  div.remove();
                  alert('Invited!');
                  // Update group info if open?
                  openGroupInfo(group); // Refresh
              } else {
                  const d = await res.json();
                  alert(d.error);
              }
          };
          list.appendChild(div);
      });

      document.body.appendChild(overlay);
      overlay.querySelector('.close-modal').onclick = () => document.body.removeChild(overlay);
  }

  function openMuteModal(groupId, target) {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
         <div class="modal-content">
            <div class="modal-header">
                <span>Mute ${target}</span>
                <span class="close-modal" style="cursor:pointer">&times;</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button class="btn btn-secondary" data-dur="60">1 Minute</button>
                <button class="btn btn-secondary" data-dur="3600">1 Hour</button>
                <button class="btn btn-secondary" data-dur="86400">1 Day</button>
                <button class="btn btn-secondary" data-dur="315360000">10 Years (Permanent-ish)</button>
                <button class="btn btn-danger" data-dur="-1">Permanent</button>
            </div>
         </div>
      `;

      overlay.querySelectorAll('button').forEach(btn => {
          btn.onclick = async () => {
              const duration = parseInt(btn.getAttribute('data-dur'));
              await fetch('/api/groups/mute', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ groupId, requester: user.username, target, duration })
              });
              document.body.removeChild(overlay);
              openGroupInfo({id: groupId});
          };
      });

      document.body.appendChild(overlay);
      overlay.querySelector('.close-modal').onclick = () => document.body.removeChild(overlay);
  }

  async function unmuteMember(groupId, target) {
      await fetch('/api/groups/unmute', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username, target })
      });
      openGroupInfo({id: groupId});
  }


  // --- Logic: Friends ---

  async function loadFriends() {
      try {
          const res = await fetch(`/api/friends?username=${user.username}`);
          const data = await res.json();
          friends = data.friends;
          friendRequests = data.friendRequests;

          // Sort friends: Pinned DM groups first
          friends.sort((a, b) => {
              const dmA = groups.find(g => g.type === 'dm' && g.name === a.username);
              const dmB = groups.find(g => g.type === 'dm' && g.name === b.username);
              const aPinned = dmA && user.pinned_chats && user.pinned_chats.includes(dmA.id);
              const bPinned = dmB && user.pinned_chats && user.pinned_chats.includes(dmB.id);

              if (aPinned && !bPinned) return -1;
              if (!aPinned && bPinned) return 1;
              return a.displayName.localeCompare(b.displayName);
          });

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

          // Check for unread count in matching DM group
          const dmGroup = groups.find(g => g.type === 'dm' && g.name === friend.username);
          let badge = '';
          if (dmGroup && dmGroup.unreadCount > 0) {
              badge = `<span style="background:red; color:white; border-radius:50%; padding:2px 6px; font-size:0.7rem; margin-left:auto;">${dmGroup.unreadCount}</span>`;
          }

          div.className = `friend-item`;

          let pinIcon = '';
          if (dmGroup && user.pinned_chats && user.pinned_chats.includes(dmGroup.id)) {
              pinIcon = '<i class="fas fa-thumbtack" style="color:var(--primary); margin-right:5px; font-size:0.8rem;"></i>';
          }

          div.innerHTML = `
            ${pinIcon}
            <img src="${friend.avatar}" style="width:30px;height:30px;border-radius:50%">
            <span>${friend.displayName}</span>
            ${badge}
          `;
          div.onclick = () => startDM(friend);

          // Context Menu for Friend
          div.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              showFriendContextMenu(e, friend);
          });

          friendsContainer.appendChild(div);
      });
  }

  function showFriendContextMenu(e, friend) {
      if (contextMenu) document.body.removeChild(contextMenu);

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      contextMenu.style.position = 'absolute';
      contextMenu.style.left = e.pageX + 'px';
      contextMenu.style.top = e.pageY + 'px';
      contextMenu.style.background = 'var(--card-bg)';
      contextMenu.style.border = '1px solid var(--border-color)';
      contextMenu.style.borderRadius = '8px';
      contextMenu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';
      contextMenu.style.overflow = 'hidden';

      const createOption = (text, iconClass, onClick, isDanger = false) => {
          const div = document.createElement('div');
          div.style.padding = '10px 15px';
          div.style.cursor = 'pointer';
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.gap = '10px';
          if (isDanger) div.style.color = '#ff4444';
          div.innerHTML = `<i class="${iconClass}"></i> ${text}`;
          div.onmouseover = () => div.style.background = 'var(--bg-color)';
          div.onmouseout = () => div.style.background = 'transparent';
          div.onclick = () => {
              document.body.removeChild(contextMenu);
              contextMenu = null;
              onClick();
          };
          return div;
      };

      // Pin Option (Pins the DM Group)
      // Find DM Group first
      const dmGroup = groups.find(g => g.type === 'dm' && g.name === friend.username);
      if (dmGroup) {
          const isPinned = user.pinned_chats && user.pinned_chats.includes(dmGroup.id);
          contextMenu.appendChild(createOption(isPinned ? "Unpin" : "Pin", "fas fa-thumbtack", async () => {
              const res = await fetch('/api/user/pin', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: user.username, groupId: dmGroup.id, action: isPinned ? 'unpin' : 'pin' })
              });
              if (res.ok) {
                  const data = await res.json();
                  if (data.error) alert(data.error);
                  else {
                      user.pinned_chats = data.pinned_chats;
                      await loadGroups();
                      // renderFriends(); // Re-render friends? Pins usually affect order?
                      // User said "pin friends.. appear at top".
                      // If we pin a friend, should they move to top of friend list?
                      // Probably.
                      // Let's sort friends too?
                      // But friends list is usually alphabetical.
                      // Let's assume standard behavior: Pinned items go to top.
                      // We need to update loadFriends/renderFriends to sort by pin.
                      loadFriends();
                  }
              }
          }));
      }

      // View Info
      contextMenu.appendChild(createOption("View Profile", "fas fa-user", () => {
          alert(`Username: ${friend.username}\nDisplay Name: ${friend.displayName}`);
      }));

      // Unfriend
      contextMenu.appendChild(createOption("Unfriend", "fas fa-user-minus", async () => {
          if(confirm(`Unfriend ${friend.displayName}?`)) {
              await fetch('/api/friends/remove', {
                  method: 'POST',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({ user: user.username, target: friend.username })
              });
              await loadFriends();
          }
      }, true));

      document.body.appendChild(contextMenu);

      const close = () => {
          if (contextMenu && document.body.contains(contextMenu)) {
              document.body.removeChild(contextMenu);
              contextMenu = null;
          }
          document.removeEventListener('click', close);
      };
      setTimeout(() => document.addEventListener('click', close), 0);
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
                  name: "DM"
              })
          });
          const data = await res.json();
          if (data.success) {
              // We manually set the name for display purpose
              data.group.name = friend.displayName;
              await loadGroups();
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
    }
  });

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
