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
  const userStatus = {}; // username -> 'online' | 'offline'

  // UI Elements
  const userAvatar = document.getElementById('userAvatar');
  const userDisplayName = document.getElementById('userDisplayName');
  const userUsername = document.getElementById('userUsername');
  const userStatusIndicator = document.getElementById('userStatusIndicator');
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

  // Create Reply Banner
  const replyBanner = document.createElement('div');
  replyBanner.className = 'reply-banner';
  replyBanner.innerHTML = `
    <div style="display:flex; flex-direction:column; overflow:hidden; flex:1;">
       <span style="font-size:0.8rem; color:var(--primary); font-weight:bold;">Replying to <span id="replyToUser"></span></span>
       <span id="replyToText" style="font-size:0.8rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>
    </div>
    <button id="cancelReplyBtn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.5rem; padding:0 10px;">&times;</button>
  `;

  chatInputArea.parentNode.insertBefore(replyBanner, chatInputArea);

  document.getElementById('cancelReplyBtn').onclick = () => {
      replyToMessage = null;
      replyBanner.classList.remove('active');
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

  const sidebar = document.getElementById('sidebar');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const chatArea = document.getElementById('chatArea');
  const mobileBackBtn = document.getElementById('mobileBackBtn');

  // --- Initialization ---

  // Apply Theme
  if (user.theme === 'dark') {
    document.body.classList.add('dark-mode');
  }

  // Set User Info
  userAvatar.src = user.avatar;
  userDisplayName.textContent = user.displayName;
  userUsername.textContent = '@' + user.username;

  // Status Indicator for Self
  if(userStatusIndicator) updateSelfStatusIndicator();

  // Cache self
  userCache[user.username] = { avatar: user.avatar, displayName: user.displayName };

  // Connect WebSocket
  setupWebSocket();

  // Load Initial Data
  await loadGroups();
  await loadFriends();

  function updateSelfStatusIndicator() {
      userStatusIndicator.className = 'status-indicator';
      if (user.invisible) {
          userStatusIndicator.classList.add('status-invisible');
      } else {
          userStatusIndicator.classList.add('status-online');
      }
  }

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
           if (data.message.user !== user.username) {
               ws.send(JSON.stringify({
                   type: 'read_message',
                   groupId: currentGroup.id,
                   user: user.username
               }));
           }
           await appendMessage(data.message);
        } else {
            ws.send(JSON.stringify({
               type: 'received_message',
               groupId: data.groupId,
               user: user.username,
               messageId: data.message.id
           }));
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
              window.location.reload();
          } else {
              await loadGroups();
          }
      } else if (data.type === 'status_update') {
          userStatus[data.username] = data.status;
          updateUserStatusUI(data.username, data.status);
      } else if (data.type === 'friend_request') {
          // Add to requests list
          friendRequests.push({ from: data.from, timestamp: data.timestamp });
          renderFriends();
          // Maybe show a notification?
      } else if (data.type === 'friend_accepted') {
          // data.user is the user who accepted/was accepted
          friends.push({
              username: data.user.username,
              displayName: data.user.displayName,
              avatar: data.user.avatar
          });

          // Remove from requests if it was there (in case I accepted)
          // If I accepted, I already updated UI? No, let's rely on reload or manual update.
          // But wait, 'friend_accepted' is sent to both.

          // If I am the one who accepted, I might have handled it in the click handler?
          // But the event is sure way.
          // Check if already exists
          if (!friends.find(f => f.username === data.user.username)) {
             friends.push(data.user);
          }

          // Remove from pending requests
          friendRequests = friendRequests.filter(r => r.from !== data.user.username);

          renderFriends();
      } else if (data.type === 'friend_removed') {
          friends = friends.filter(f => f.username !== data.username);
          friendRequests = friendRequests.filter(f => f.from !== data.username);

          // If currently chatting with them in DM, maybe alert?
          if (currentGroup && currentGroup.type === 'dm' && currentGroup.name === data.username) {
              alert('You are no longer friends with this user.');
              // window.location.reload(); // Or just go back to empty state
              currentGroup = null;
              messagesContainer.innerHTML = '';
              chatHeaderName.textContent = '';
          }
          renderFriends();
      } else if (data.type === 'group_added') {
          // data.groupId
          // Fetch group info and add to list
          // We need to fetch the group details to render it
           try {
              const res = await fetch(`/api/groups/${data.groupId}`);
              if (res.ok) {
                  const groupData = await res.json();
                  // Adapt to simple group object for list
                  const simpleGroup = {
                      id: groupData.id,
                      name: groupData.name,
                      type: groupData.type,
                      avatar: groupData.avatar,
                      unreadCount: 0 // New group
                  };

                  if (simpleGroup.type === 'dm') {
                      // logic to set name/avatar correctly for DM
                      const other = groupData.members.find(m => m !== user.username) || "Unknown";
                      simpleGroup.name = other;
                      const u = await getUserInfo(other);
                      simpleGroup.avatar = u.avatar;
                  }

                  groups.push(simpleGroup);
                  renderGroups();
              }
           } catch(e) { console.error(e); }
      } else if (data.type === 'group_removed') {
          groups = groups.filter(g => g.id !== data.groupId);
          if (currentGroup && currentGroup.id === data.groupId) {
              alert('You were removed from this group.');
              currentGroup = null;
              messagesContainer.innerHTML = '';
              chatHeaderName.textContent = '';
          }
          renderGroups();
      } else if (data.type === 'profile_update') {
           // data.username, data.user (full user object)
           userCache[data.username] = data.user;

           // Update friend list if present
           const fIndex = friends.findIndex(f => f.username === data.username);
           if (fIndex !== -1) {
               friends[fIndex].displayName = data.user.displayName;
               friends[fIndex].avatar = data.user.avatar;
               renderFriends();
           }

           // Update groups list if DM
           const gIndex = groups.findIndex(g => g.type === 'dm' && g.name === data.username);
           if (gIndex !== -1) {
               groups[gIndex].avatar = data.user.avatar;
               // Name usually stays username for DMs in list logic above,
               // but if we used display name there, we'd update it.
               // My logic uses username for DM name in 'groups' array, but fetches display name on render?
               // No, renderGroups uses group.name.
               // My 'loadGroups' sets group.name = other (username).
               // renderGroups displays group.name.
               // So DM list shows username.
               // If we want to show Display Name in DM list, we should update 'loadGroups'.
               renderGroups();
           }

           // Update current chat header if applicable
           if (currentGroup) {
               if (currentGroup.type === 'dm' && currentGroup.name === data.username) {
                   // Update header?
                   // Header usually shows currentGroup.name (username).
                   // If we want display name in header:
                   // My switchGroup logic sets chatHeaderName to group.name.
                   // Ideally DMs should show display name.
               }

               // Update messages avatars/names
               const msgs = messagesContainer.querySelectorAll('.message');
               // Rerender all messages? Or just find and update.
               // Simpler to just let next render handle it or reload messages if specific user.
               // Let's just update avatar images with matching src?
               // Complex. Let's leave it for now, next open will fix.
           }
      }
    });

    ws.addEventListener('close', () => {
      setTimeout(setupWebSocket, 3000);
    });
  }

  function updateUserStatusUI(username, status) {
      const friendItem = document.querySelector(`.friend-item[data-username="${username}"]`);
      if (friendItem) {
          const ind = friendItem.querySelector('.status-indicator');
          if (ind) {
              ind.className = 'status-indicator ' + (status === 'online' ? 'status-online' : 'status-offline');
          }
      }
  }

  function updateReadReceipts(readByUser) {
      const msgs = document.querySelectorAll('.message.me');
      msgs.forEach(div => {
          const tick = div.querySelector('.read-receipt');
          if (tick && !tick.classList.contains('read')) {
              let readBy = div.getAttribute('data-read-by') ? JSON.parse(div.getAttribute('data-read-by')) : [];
              if (!readBy.includes(readByUser)) readBy.push(readByUser);
              div.setAttribute('data-read-by', JSON.stringify(readBy));

              let isRead = false;
              if (currentGroup.type === 'dm') {
                   isRead = readBy.length > 1;
              } else {
                  const members = currentGroup.members;
                  isRead = members.every(m => readBy.includes(m));
              }

              if (isRead) {
                   tick.classList.add('read');
                   tick.innerHTML = '<i class="fas fa-check-double"></i>';
              }
          }
      });
  }

  function updateDeliveryReceipts(receivedByUser) {
      const msgs = document.querySelectorAll('.message.me');
      msgs.forEach(div => {
          const tick = div.querySelector('.read-receipt');
          if (tick && !tick.classList.contains('read')) {
               let receivedBy = div.getAttribute('data-received-by') ? JSON.parse(div.getAttribute('data-received-by')) : [];
               if (!receivedByUser) return;
               if (!receivedBy.includes(receivedByUser)) receivedBy.push(receivedByUser);
               div.setAttribute('data-received-by', JSON.stringify(receivedBy));

               let isReceived = false;
               if (currentGroup.type === 'dm') {
                   isReceived = receivedBy.length > 1;
               } else {
                   const members = currentGroup.members;
                   isReceived = members.every(m => receivedBy.includes(m));
               }

               if (isReceived) {
                   const icon = tick.querySelector('i');
                   if (icon && !icon.classList.contains('fa-check-double')) {
                       tick.innerHTML = '<i class="fas fa-check-double"></i>';
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
      } catch (e) { console.error(e); }
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
      const userRes = await fetch(`/api/user/${user.username}`);
      if (userRes.ok) {
          const userData = await userRes.json();
          user.pinned_chats = userData.pinned_chats || [];
          user.invisible = userData.invisible || false;
          if(userStatusIndicator) updateSelfStatusIndicator();
      }

      const res = await fetch(`/api/my-groups?username=${user.username}`);
      const data = await res.json();
      groups = data.groups;

      groups.sort((a, b) => {
          const aPinned = user.pinned_chats && user.pinned_chats.includes(a.id);
          const bPinned = user.pinned_chats && user.pinned_chats.includes(b.id);
          if (aPinned && !bPinned) return -1;
          if (!aPinned && bPinned) return 1;
          return a.name.localeCompare(b.name);
      });

      renderGroups();
    } catch (err) { console.error(err); }
  }

  function renderGroups() {
    groupsList.innerHTML = '';
    groups.forEach(group => {
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

      let iconHtml = '<i class="fas fa-hashtag" style="padding: 0 10px;"></i>';
      if (group.avatar) {
          iconHtml = `<img src="${group.avatar}" style="width:36px;height:36px;border-radius:50%; margin-right: 5px;">`;
      }

      div.innerHTML = `${pinIcon}${iconHtml} ${group.name} ${badge}`;
      div.onclick = () => switchGroup(group);

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

  let contextMenu = null;

  function showContextMenu(e, target) {
      if (contextMenu) document.body.removeChild(contextMenu);

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      contextMenu.style.position = 'absolute';
      contextMenu.style.left = e.pageX + 'px';
      contextMenu.style.top = e.pageY + 'px';
      contextMenu.style.background = 'var(--card-bg)';
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';

      const createOption = (text, iconClass, onClick, isDanger = false) => {
          const div = document.createElement('div');
          div.style.padding = '12px 15px';
          div.style.cursor = 'pointer';
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.gap = '10px';
          if (isDanger) div.style.color = 'var(--danger)';
          div.innerHTML = `<i class="${iconClass}"></i> ${text}`;
          div.onmouseover = () => div.style.background = 'var(--bg-color)';
          div.onmouseout = () => div.style.background = 'transparent';
          div.onclick = (ev) => {
              ev.stopPropagation();
              document.body.removeChild(contextMenu);
              contextMenu = null;
              onClick();
          };
          return div;
      };

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
                  user.pinned_chats = data.pinned_chats;
                  await loadGroups();
              }
          }
      }));

      if (target.type === 'group') {
          contextMenu.appendChild(createOption("Group Info", "fas fa-info-circle", () => openGroupInfo(target)));
      }

      document.body.appendChild(contextMenu);

      setTimeout(() => {
          const close = () => {
              if (contextMenu && document.body.contains(contextMenu)) {
                  document.body.removeChild(contextMenu);
                  contextMenu = null;
              }
              document.removeEventListener('click', close);
          };
          document.addEventListener('click', close);
      }, 50);
  }

  async function switchGroup(group) {
    currentGroup = group;

    // Mobile: Slide in Chat Area
    if (window.innerWidth <= 768) {
        chatArea.classList.add('active');
    }

    chatHeaderName.textContent = group.type === 'dm' ? group.name : `# ${group.name}`;

    if (group.type === 'group') {
        groupIdText.textContent = group.id;
        groupIdDisplay.style.display = 'inline-block';
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

    const gIndex = groups.findIndex(g => g.id === group.id);
    if (gIndex !== -1) groups[gIndex].unreadCount = 0;
    renderGroups();
    renderFriends();

    messagesContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted)">Loading...</div>';
    try {
      const res = await fetch(`/api/groups/${group.id}`);
      const data = await res.json();
      currentGroup = data;

      messagesContainer.innerHTML = '';
      if (data.messages) {
        for (const msg of data.messages) {
            await appendMessage(msg);
        }
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

    div.setAttribute('data-read-by', JSON.stringify(msg.readBy || []));
    div.setAttribute('data-received-by', JSON.stringify(msg.receivedBy || []));

    const userInfo = await getUserInfo(msg.user);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let tickHtml = '';
    let tickClass = '';

    if (isMe) {
        const readBy = msg.readBy || [];
        const receivedBy = msg.receivedBy || [];

        let isRead = false;
        let isReceived = false;

        if (currentGroup.type === 'dm') {
             isRead = readBy.length > 1;
             isReceived = receivedBy.length > 1;
        } else {
             const members = currentGroup.members;
             isRead = members.every(m => readBy.includes(m));
             isReceived = members.every(m => receivedBy.includes(m));
        }

        if (isRead) {
            tickHtml = '<i class="fas fa-check-double"></i>';
            tickClass = 'read';
        } else if (isReceived) {
            tickHtml = '<i class="fas fa-check-double"></i>';
        } else {
            tickHtml = '<i class="fas fa-check"></i>';
        }
    }

    div.innerHTML = `
      <img src="${userInfo.avatar}" class="message-avatar" alt="Avatar">
      <div class="message-content" title="Long press or Right click for options">
        ${msg.replyTo ? `<div class="reply-quote">
             <div style="font-weight:bold; color:var(--primary);">${msg.replyTo.userDisplayName || 'User'}</div>
             <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${msg.replyTo.text}</div>
        </div>` : ''}
        <div class="message-header">
          <span style="font-weight:600">${userInfo.displayName}</span>
          <span>${time}</span>
        </div>
        <div class="message-text"></div>
      </div>
    `;
    // Set text content safely
    const textDiv = div.querySelector('.message-text');
    textDiv.textContent = msg.text;

    // Append checkmarks inline/floated
    if (isMe) {
        const floatSpan = document.createElement('span');
        floatSpan.className = 'message-float-right';
        floatSpan.innerHTML = `<span class="read-receipt ${tickClass}">${tickHtml}</span>`;
        textDiv.appendChild(floatSpan);
    }

    const contentDiv = div.querySelector('.message-content');
    contentDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, msg, userInfo);
    });

    let pressTimer;
    let isLongPress = false;

    contentDiv.addEventListener('mousedown', (e) => {
        if(e.button !== 0) return;
        isLongPress = false;
        const pageX = e.pageX;
        const pageY = e.pageY;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            showMessageContextMenu({ pageX, pageY }, msg, userInfo);
        }, 600);
    });

    const cancelPress = (e) => {
        clearTimeout(pressTimer);
    };

    contentDiv.addEventListener('mouseup', cancelPress);
    contentDiv.addEventListener('mouseleave', cancelPress);
    contentDiv.addEventListener('click', (e) => {
        if(isLongPress) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    });

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showMessageContextMenu(e, msg, userInfo) {
      if (contextMenu) document.body.removeChild(contextMenu);

      contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      const x = e ? e.pageX : (window.innerWidth / 2) - 75;
      const y = e ? e.pageY : (window.innerHeight / 2) - 50;

      contextMenu.style.position = 'absolute';
      contextMenu.style.left = x + 'px';
      contextMenu.style.top = y + 'px';
      contextMenu.style.background = 'var(--card-bg)';
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';

      const createOption = (text, iconClass, onClick) => {
          const div = document.createElement('div');
          div.style.padding = '12px 15px';
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

      contextMenu.appendChild(createOption("Reply", "fas fa-reply", () => {
          replyToMessage = { id: msg.id, text: msg.text, userDisplayName: userInfo.displayName };
          document.getElementById('replyToUser').textContent = userInfo.displayName;
          document.getElementById('replyToText').textContent = msg.text;
          replyBanner.classList.add('active');
          messageInput.focus();
      }));

      if (currentGroup.type !== 'dm') {
          contextMenu.appendChild(createOption("Seen by", "fas fa-eye", async () => {
              const readByList = msg.readBy || [];
              let content = '';
              if (readByList.length === 0) content = '<p style="text-align:center; color:var(--text-muted)">No one yet.</p>';
              else {
                  content = '<ul style="list-style:none; padding:0;">';
                  for(const u of readByList) {
                      const info = await getUserInfo(u);
                      content += `<li style="padding:10px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:10px;">
                        <img src="${info.avatar}" style="width:32px;height:32px;border-radius:50%">
                        <span>${info.displayName}</span>
                      </li>`;
                  }
                  content += '</ul>';
              }

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
              overlay.classList.remove('hidden');
              overlay.querySelector('.close-modal').onclick = () => document.body.removeChild(overlay);
          }));
      }

      document.body.appendChild(contextMenu);

      setTimeout(() => {
          const close = () => {
              if (contextMenu && document.body.contains(contextMenu)) {
                  document.body.removeChild(contextMenu);
                  contextMenu = null;
              }
              document.removeEventListener('click', close);
          };
          document.addEventListener('click', close);
      }, 50);
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
      replyTo: replyToMessage
    };

    ws.send(JSON.stringify(payload));
    messageInput.value = '';
    messageInput.style.height = 'auto';

    replyToMessage = null;
    replyBanner.classList.remove('active');
  }

  // --- Logic: Group Info Modal ---

  async function openGroupInfo(group) {
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
          row.style.padding = '12px 0';
          row.style.borderBottom = '1px solid var(--border-color)';

          let roleTag = '';
          if (fullGroup.owner === memberUsername) roleTag = '<span style="background:#ffd700; color:#000; padding:2px 6px; font-size:0.7rem; border-radius:4px; margin-left:5px; font-weight:bold;">Owner</span>';
          else if (fullGroup.admins && fullGroup.admins.includes(memberUsername)) roleTag = '<span style="background:#e0e0e0; color:#333; padding:2px 6px; font-size:0.7rem; border-radius:4px; margin-left:5px; font-weight:bold;">Admin</span>';

          row.innerHTML = `
            <img src="${u.avatar}" style="width:42px;height:42px;border-radius:50%;margin-right:12px;">
            <div style="flex:1">
                <div><strong>${u.displayName}</strong> ${roleTag}</div>
                <div style="font-size:0.8rem;color:var(--text-muted)">@${u.username}</div>
            </div>
          `;

          if (memberUsername !== user.username && fullGroup.type !== 'dm') {
              const actionsDiv = document.createElement('div');
              const canKick = isOwner || (fullGroup.admins && fullGroup.admins.includes(user.username) && memberUsername !== fullGroup.owner && (!fullGroup.admins.includes(memberUsername) || isOwner));

              if (canKick) {
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-danger';
                  btn.innerHTML = '<i class="fas fa-ban"></i>';
                  btn.title = "Kick";
                  btn.style.marginLeft = '5px';
                  btn.onclick = () => kickMember(fullGroup.id, memberUsername);
                  actionsDiv.appendChild(btn);
              }

              if (isOwner) {
                  const isAdmin = fullGroup.admins && fullGroup.admins.includes(memberUsername);
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-secondary';
                  btn.innerHTML = isAdmin ? '<i class="fas fa-arrow-down"></i>' : '<i class="fas fa-arrow-up"></i>';
                  btn.title = isAdmin ? "Demote" : "Promote";
                  btn.style.marginLeft = '5px';
                  btn.onclick = () => toggleAdmin(fullGroup.id, memberUsername, !isAdmin);
                  actionsDiv.appendChild(btn);
              }

              const canMute = isOwner || (fullGroup.admins && fullGroup.admins.includes(user.username) && memberUsername !== fullGroup.owner && (!fullGroup.admins.includes(memberUsername) || isOwner));

              if (canMute) {
                  const btn = document.createElement('button');
                  btn.className = 'btn btn-sm btn-secondary';
                  const isMuted = fullGroup.muted && fullGroup.muted[memberUsername] && (fullGroup.muted[memberUsername] === -1 || fullGroup.muted[memberUsername] > Date.now());

                  btn.innerHTML = isMuted ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
                  btn.title = isMuted ? "Unmute" : "Mute";
                  btn.style.marginLeft = '5px';
                  btn.style.color = isMuted ? 'var(--success)' : 'var(--danger)';
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

      const isMember = fullGroup.members.includes(user.username);
      const isAdmin = fullGroup.admins && fullGroup.admins.includes(user.username);
      const invitePerm = fullGroup.invite_permission || 'admin';

      let canInvite = false;
      if (invitePerm === 'all' && isMember) canInvite = true;
      if (invitePerm === 'admin' && (isAdmin || isOwner)) canInvite = true;

      let inviteSection = document.getElementById('inviteSection');
      if (!inviteSection) {
          inviteSection = document.createElement('div');
          inviteSection.id = 'inviteSection';
          inviteSection.style.marginTop = '15px';
          const parent = document.getElementById('ownerControls').parentNode;
          parent.insertBefore(inviteSection, document.getElementById('ownerControls'));
      }
      inviteSection.innerHTML = '';

      if (canInvite && fullGroup.type !== 'dm') {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.textContent = 'Add Member';
          btn.onclick = () => openInviteModal(fullGroup);
          inviteSection.appendChild(btn);
      }

      if (isOwner && fullGroup.type !== 'dm') {
          const toggleDiv = document.createElement('div');
          toggleDiv.style.marginTop = '15px';
          toggleDiv.innerHTML = `
            <label class="switch-container">
                <span style="font-size:0.9rem; font-weight:600;">Allow all members to invite</span>
                <input type="checkbox" id="invitePermToggle" ${invitePerm === 'all' ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
          `;
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
      if(!confirm('Delete this group?')) return;
      await fetch('/api/groups/delete', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username })
      });
      groupInfoModal.classList.add('hidden');
      window.location.reload();
  }

  async function resetGroupId(groupId) {
      if(!confirm('Reset Group ID?')) return;
      const res = await fetch('/api/groups/reset-id', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username })
      });
      if (res.ok) {
          alert('ID Reset');
          groupInfoModal.classList.add('hidden');
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
          openGroupInfo({id: groupId});
      }
  }

  closeInfoModal.addEventListener('click', () => {
      groupInfoModal.classList.add('hidden');
  });

  // --- Logic: Invite & Mute Modals ---

  function openInviteModal(group) {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
         <div class="modal-content">
            <div class="modal-header">
                <span>Invite Friend</span>
                <span class="close-modal" style="cursor:pointer">&times;</span>
            </div>
            <div id="inviteFriendList" style="max-height:300px; overflow-y:auto;"></div>
         </div>
      `;

      const list = overlay.querySelector('#inviteFriendList');

      friends.forEach(f => {
          if (group.members.includes(f.username)) return;

          const div = document.createElement('div');
          div.className = 'friend-item';
          div.innerHTML = `
            <img src="${f.avatar}" style="width:30px;height:30px;border-radius:50%">
            <span>${f.displayName}</span>
            <button class="btn btn-sm btn-primary" style="margin-left:auto; width:auto;">Add</button>
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
                  openGroupInfo(group);
              } else {
                  const d = await res.json();
                  alert(d.error);
              }
          };
          list.appendChild(div);
      });

      document.body.appendChild(overlay);
      overlay.classList.remove('hidden');
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
                <button class="btn btn-secondary" data-dur="604800">1 Week</button>
                <button class="btn btn-danger" data-dur="-1">Permanent</button>

                <div style="border-top:1px solid var(--border-color); margin-top:10px; padding-top:10px;">
                    <label>Custom Duration</label>
                    <div style="display:flex; gap:10px; margin-top:5px;">
                        <input type="number" id="customMuteVal" class="input-field" style="width:60%" min="1" value="1">
                        <select id="customMuteUnit" class="input-field" style="width:40%">
                            <option value="60">Mins</option>
                            <option value="3600">Hours</option>
                            <option value="86400">Days</option>
                        </select>
                    </div>
                    <button id="applyCustomMute" class="btn btn-primary" style="margin-top:10px;">Apply Custom</button>
                </div>
            </div>
         </div>
      `;

      overlay.querySelectorAll('button[data-dur]').forEach(btn => {
          btn.onclick = async () => {
              const duration = parseInt(btn.getAttribute('data-dur'));
              await applyMute(groupId, target, duration);
              document.body.removeChild(overlay);
          };
      });

      overlay.querySelector('#applyCustomMute').onclick = async () => {
          const val = parseInt(overlay.querySelector('#customMuteVal').value);
          const unit = parseInt(overlay.querySelector('#customMuteUnit').value);
          if(val > 0) {
              await applyMute(groupId, target, val * unit);
              document.body.removeChild(overlay);
          }
      };

      document.body.appendChild(overlay);
      overlay.classList.remove('hidden');
      overlay.querySelector('.close-modal').onclick = () => document.body.removeChild(overlay);
  }

  async function applyMute(groupId, target, duration) {
      await fetch('/api/groups/mute', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ groupId, requester: user.username, target, duration })
      });
      openGroupInfo({id: groupId});
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

      const friendsHeader = document.createElement('div');
      friendsHeader.innerHTML = '<small style="padding:5px; color:var(--text-muted)">Friends</small>';
      friendsContainer.appendChild(friendsHeader);

      friends.forEach(friend => {
          const div = document.createElement('div');
          const dmGroup = groups.find(g => g.type === 'dm' && g.name === friend.username);
          let badge = '';
          if (dmGroup && dmGroup.unreadCount > 0) {
              badge = `<span style="background:red; color:white; border-radius:50%; padding:2px 6px; font-size:0.7rem; margin-left:auto;">${dmGroup.unreadCount}</span>`;
          }

          div.className = `friend-item`;
          div.setAttribute('data-username', friend.username); // For status updates

          let pinIcon = '';
          if (dmGroup && user.pinned_chats && user.pinned_chats.includes(dmGroup.id)) {
              pinIcon = '<i class="fas fa-thumbtack" style="color:var(--primary); margin-right:5px; font-size:0.8rem;"></i>';
          }

          let statusClass = 'status-offline';
          if (userStatus[friend.username] === 'online') statusClass = 'status-online';

          div.innerHTML = `
            ${pinIcon}
            <div style="position:relative;">
                <img src="${friend.avatar}" style="width:36px;height:36px;border-radius:50%">
                <span class="status-indicator ${statusClass}"></span>
            </div>
            <span>${friend.displayName}</span>
            ${badge}
          `;
          div.onclick = () => startDM(friend);

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
      contextMenu.style.zIndex = '2000';
      contextMenu.style.minWidth = '150px';

      const createOption = (text, iconClass, onClick, isDanger = false) => {
          const div = document.createElement('div');
          div.style.padding = '12px 15px';
          div.style.cursor = 'pointer';
          if (isDanger) div.style.color = 'var(--danger)';
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
                      loadFriends();
                  }
              }
          }));
      }

      contextMenu.appendChild(createOption("View Profile", "fas fa-user", () => {
          const modal = document.getElementById('userProfileModal');
          document.getElementById('profileModalAvatar').src = friend.avatar;
          document.getElementById('profileModalName').textContent = friend.displayName;
          document.getElementById('profileModalUsername').textContent = '@' + friend.username;

          const statusEl = document.getElementById('profileModalStatus');
          const isOnline = userStatus[friend.username] === 'online';
          statusEl.textContent = isOnline ? 'Online' : 'Offline';
          statusEl.style.color = isOnline ? 'var(--success)' : 'var(--text-muted)';
          statusEl.style.border = `1px solid ${isOnline ? 'var(--success)' : 'var(--border-color)'}`;
          statusEl.style.background = isOnline ? 'rgba(16, 185, 129, 0.1)' : 'transparent';

          document.getElementById('profileModalMessageBtn').onclick = () => {
              modal.classList.add('hidden');
              startDM(friend);
          };

          modal.classList.remove('hidden');
          modal.querySelector('.close-modal-profile').onclick = () => modal.classList.add('hidden');
      }));

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

      setTimeout(() => {
          const close = () => {
              if (contextMenu && document.body.contains(contextMenu)) {
                  document.body.removeChild(contextMenu);
                  contextMenu = null;
              }
              document.removeEventListener('click', close);
          };
          document.addEventListener('click', close);
      }, 50);
  }

  window.respondFriend = async (from, action) => {
      await fetch('/api/friends/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: user.username, from, action })
      });
      await loadFriends();
  };

  async function startDM(friend) {
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
              data.group.name = friend.displayName;
              await loadGroups();
              switchGroup(data.group);
          }
      } catch (e) { console.error(e); }
  }

  // --- Event Listeners ---

  if (mobileBackBtn) {
      mobileBackBtn.addEventListener('click', () => {
          chatArea.classList.remove('active');
          currentGroup = null; // Optional: deselect group
          // Need to clear active state in list
          document.querySelectorAll('.group-item, .friend-item').forEach(el => el.classList.remove('active'));
      });
  }

  if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', () => {
          sidebar.classList.toggle('collapsed');
      });
  }

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
              if (u.username === user.username) return;

              const div = document.createElement('div');
              div.className = 'search-result-item';
              div.innerHTML = `
                <img src="${u.avatar}">
                <div style="flex:1">
                    <div style="font-weight:bold">${u.displayName}</div>
                    <div style="font-size:0.8rem">@${u.username}</div>
                </div>
                <button class="btn btn-sm btn-primary" style="width:auto;">Add</button>
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

  groupIdDisplay.addEventListener('click', () => {
      navigator.clipboard.writeText(currentGroup.id).then(() => alert('ID Copied!'));
  });

  document.querySelector('.user-profile').addEventListener('click', () => {
    window.location.href = '/settings.html';
  });

});
