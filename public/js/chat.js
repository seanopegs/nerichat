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
  const fileInput = document.getElementById('fileInput');
  const attachBtn = document.getElementById('attachBtn');
  const groupAvatarUpload = document.getElementById('groupAvatarUpload');
  const editGroupAvatarInput = document.getElementById('editGroupAvatarInput');

  // Attachment Preview Elements
  const attachmentPreviewModal = document.getElementById('attachmentPreviewModal');
  const closePreviewModal = document.querySelector('.close-modal-preview');
  const previewImage = document.getElementById('previewImage');
  const previewFile = document.getElementById('previewFile');
  const previewFileName = document.getElementById('previewFileName');
  const attachmentCaption = document.getElementById('attachmentCaption');
  const sendAttachmentBtn = document.getElementById('sendAttachmentBtn');
  const cancelAttachmentBtn = document.getElementById('cancelAttachmentBtn');
  let pendingFile = null;

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

  // Lightbox elements
  const imageLightboxModal = document.getElementById('imageLightboxModal');
  const lightboxImage = document.getElementById('lightboxImage');
  const closeLightbox = document.querySelector('.close-modal-lightbox');

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
  userCache[user.username] = { username: user.username, avatar: user.avatar, displayName: user.displayName };

  // Verify User Exists (Session Check)
  try {
      const res = await fetch(`/api/user/${user.username}`);
      if (res.status === 404) {
          alert('User session invalid or account deleted.');
          localStorage.removeItem('chatUser');
          window.location.href = '/';
          return;
      }
      if (res.ok) {
          const remoteUser = await res.json();
          // Update local data with fresh data from server
          user = { ...user, ...remoteUser };
          localStorage.setItem('chatUser', JSON.stringify(user));
      }
  } catch (e) {
      console.error("Session check failed", e);
  }

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
      } else if (data.type === 'message_updated') {
          if (currentGroup && data.groupId === currentGroup.id) {
              const msgEl = document.querySelector(`.message-content[data-id="${data.messageId}"]`);
              if (msgEl) {
                  let textContainer = msgEl.querySelector('.message-text');
                  let textEl = msgEl.querySelector('.message-text-content');

                  if (!textEl) {
                      // Create it if it doesn't exist (e.g. added text to file message)
                      textEl = document.createElement('span');
                      textEl.className = 'message-text-content';
                      textContainer.appendChild(textEl);
                  }

                  textEl.textContent = data.text;
                  textEl.style.display = ''; // Ensure visible if it was hidden by edit mode

                  const editedSpan = msgEl.querySelector('.edited-indicator');
                  if (!editedSpan) {
                       const span = document.createElement('span');
                       span.className = 'edited-indicator';
                       span.textContent = ' (edited)';
                       span.style.fontSize = '0.7rem';
                       span.style.color = 'var(--text-muted)';
                       span.style.fontStyle = 'italic';
                       textContainer.appendChild(span);
                  }
              }
          }
      } else if (data.type === 'message_deleted') {
          if (currentGroup && data.groupId === currentGroup.id) {
              const msgEl = document.querySelector(`.message-content[data-id="${data.messageId}"]`);
              if (msgEl) {
                   const textContainer = msgEl.querySelector('.message-text');
                   if (textContainer) {
                       // Remove any attachment preview
                       const imgs = textContainer.querySelectorAll('img, a');
                       imgs.forEach(el => el.parentNode.remove());

                       textContainer.innerHTML = '<span class="message-text deleted">This message was deleted</span>';
                   }
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
               renderGroups();
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

  function updateTabBadges() {
      // Groups Tab
      // Count groups with unread messages (excluding DMs)
      const groupsUnread = groups.filter(g => g.type !== 'dm' && g.unreadCount > 0).length;

      let gBadge = tabGroups.querySelector('.tab-badge');
      if (groupsUnread > 0) {
          if (!gBadge) {
              gBadge = document.createElement('span');
              gBadge.className = 'tab-badge';
              tabGroups.appendChild(gBadge);
          }
          gBadge.textContent = groupsUnread;
      } else if (gBadge) {
          gBadge.remove();
      }

      // Friends Tab
      // Count DMs with unread messages
      const friendsUnread = groups.filter(g => g.type === 'dm' && g.unreadCount > 0).length;

      let fBadge = tabFriends.querySelector('.tab-badge');
      if (friendsUnread > 0) {
          if (!fBadge) {
              fBadge = document.createElement('span');
              fBadge.className = 'tab-badge';
              tabFriends.appendChild(fBadge);
          }
          fBadge.textContent = friendsUnread;
      } else if (fBadge) {
          fBadge.remove();
      }
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
          username: username,
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
    updateTabBadges();
    groupsList.innerHTML = '';
    groups.forEach(group => {
      if (group.type === 'dm') return;

      const div = document.createElement('div');
      div.className = `group-item ${currentGroup && currentGroup.id === group.id ? 'active' : ''}`;

      let badge = '';
      if (group.unreadCount > 0) {
          badge = `<span class="unread-badge">${group.unreadCount}</span>`;
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
      // Removed inline background to use CSS class
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

    let contentHtml = '';
    if (msg.is_deleted) {
        contentHtml = `<span class="message-text deleted">This message was deleted</span>`;
    } else {
        if (msg.attachmentUrl) {
            if (msg.attachmentType === 'image') {
                // Use a unique ID or data attribute to handle click in JS, or just global function
                // However, sticking to event listeners or global function is fine.
                // Let's use a global function for simplicity since we are in module scope here mostly
                // But 'openLightbox' needs to be defined.
                contentHtml += `<div style="margin-bottom:5px;"><img src="${msg.attachmentUrl}" style="max-width:200px; max-height:200px; border-radius:8px; cursor:pointer;" class="chat-image" data-src="${msg.attachmentUrl}"></div>`;
            } else {
                const fname = msg.originalFilename || msg.attachmentUrl.split('/').pop();
                contentHtml += `<div style="margin-bottom:5px;"><a href="${msg.attachmentUrl}" download="${fname}" target="_blank" class="file-attachment-link"><i class="fas fa-file"></i> ${fname}</a></div>`;
            }
        }
        if (msg.text) {
            contentHtml += `<span class="message-text-content"></span>`;
        }
        if (msg.is_edited) {
             contentHtml += `<span class="edited-indicator" style="font-size:0.7rem; color:var(--text-muted); font-style:italic;"> (edited)</span>`;
        }
    }

    let replyHtml = '';
    if (msg.replyTo) {
        // Determine if we should show a thumbnail
        // We show it if there is an URL and the text is either empty, '[Photo]', or the same as the URL (legacy)
        const isPhoto = msg.replyTo.text === '[Photo]' || !msg.replyTo.text;
        const hasThumb = msg.replyTo.attachmentUrl && isPhoto;

        replyHtml = `<div class="reply-quote" data-reply-id="${msg.replyTo.id}">
             ${hasThumb ? `<img src="${msg.replyTo.attachmentUrl}" class="reply-thumbnail">` : ''}
             <div style="overflow:hidden; flex:1;">
                 <div style="font-weight:bold; color:var(--primary); font-size:0.8rem;">${msg.replyTo.userDisplayName || 'User'}</div>
                 <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.8;">${msg.replyTo.text || (msg.replyTo.attachmentUrl ? 'Attachment' : 'Message')}</div>
             </div>
        </div>`;
    }

    div.innerHTML = `
      <img src="${userInfo.avatar}" class="message-avatar" alt="Avatar">
      <div class="message-content" data-id="${msg.id}" title="Long press or Right click for options">
        ${replyHtml}
        <div class="message-header">
          <span style="font-weight:600">${userInfo.displayName}</span>
          <span>${time}</span>
        </div>
        <div class="message-text">${contentHtml}</div>
      </div>
    `;

    // Set text content safely if exists and not deleted
    if (!msg.is_deleted && msg.text) {
        const textDiv = div.querySelector('.message-text-content');
        if(textDiv) textDiv.textContent = msg.text;
    }

    // Scroll to reply on click
    if (msg.replyTo) {
        const replyQuote = div.querySelector('.reply-quote');
        if (replyQuote) {
            replyQuote.onclick = (e) => {
                e.stopPropagation();
                const targetMsg = document.querySelector(`.message-content[data-id="${msg.replyTo.id}"]`);
                if (targetMsg) {
                    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight effect
                    targetMsg.style.transition = 'background 0.5s';
                    const origBg = targetMsg.style.background;
                    targetMsg.style.background = 'rgba(99, 102, 241, 0.2)';
                    setTimeout(() => {
                        targetMsg.style.background = origBg;
                    }, 1000);
                }
            };
        }
    }

    // Append checkmarks inline/floated
    if (isMe) {
        const floatSpan = document.createElement('span');
        floatSpan.className = 'message-float-right';
        // Add timestamp for self messages too, next to checkmarks
        const timeHtml = `<span class="message-time" style="margin-right:4px;">${time}</span>`;
        floatSpan.innerHTML = `${timeHtml}<span class="read-receipt ${tickClass}">${tickHtml}</span>`;

        // Append to the text container so it works for files too
        const textContainer = div.querySelector('.message-text');
        if (textContainer) {
             textContainer.appendChild(floatSpan);
        }
    }

    const contentDiv = div.querySelector('.message-content');

    // Image click handler
    const imgEl = contentDiv.querySelector('.chat-image');
    if (imgEl) {
        imgEl.onclick = (e) => {
            e.stopPropagation(); // Prevent message click/menu
            openLightbox(imgEl.dataset.src);
        };
    }

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
      // Removed inline background
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

      if (!msg.is_deleted) {
          contextMenu.appendChild(createOption("Reply", "fas fa-reply", () => {
              const isImage = msg.attachmentType === 'image';
              replyToMessage = {
                  id: msg.id,
                  text: msg.text || (msg.attachmentUrl ? (isImage ? '[Photo]' : '[File]') : ''),
                  userDisplayName: userInfo.displayName,
                  attachmentUrl: isImage ? msg.attachmentUrl : null
              };

              document.getElementById('replyToUser').textContent = userInfo.displayName;

              const replyTextContainer = document.getElementById('replyToText');
              replyTextContainer.innerHTML = ''; // Clear previous

              if (isImage && msg.attachmentUrl) {
                  const img = document.createElement('img');
                  img.src = msg.attachmentUrl;
                  img.className = 'reply-thumbnail'; // Defined in chat.css
                  replyTextContainer.appendChild(img);

                  const span = document.createElement('span');
                  span.textContent = msg.text || '[Photo]';
                  replyTextContainer.appendChild(span);

                  // Adjust banner layout to row for image
                  replyTextContainer.style.display = 'flex';
                  replyTextContainer.style.alignItems = 'center';
              } else {
                  replyTextContainer.textContent = msg.text || (msg.attachmentUrl ? '[File]' : '');
                  replyTextContainer.style.display = 'block';
              }

              replyBanner.classList.add('active');
              messageInput.focus();
          }));
      }

      // Edit & Delete (My message & < 5 mins)
      const isMe = msg.user === user.username;
      const isRecent = (Date.now() - msg.timestamp) < 5 * 60 * 1000;

      if (isMe && !msg.is_deleted && isRecent) {
          if (msg.text || msg.type === 'text') {
              contextMenu.appendChild(createOption("Edit", "fas fa-edit", () => {
                  const msgEl = document.querySelector(`.message-content[data-id="${msg.id}"]`);
                  if(msgEl) {
                       const textContainer = msgEl.querySelector('.message-text');
                       const originalText = msg.text;

                       const textSpan = textContainer.querySelector('.message-text-content');
                       if (!textSpan) return;

                       const originalDisplay = textSpan.style.display;
                       textSpan.style.display = 'none';

                       if(textContainer.querySelector('.edit-wrapper')) return;

                       const editDiv = document.createElement('div');
                       editDiv.className = 'edit-wrapper';
                       editDiv.style.display = 'flex';
                       editDiv.style.gap = '5px';
                       editDiv.style.marginTop = '5px';
                       editDiv.innerHTML = `
                             <input type="text" class="edit-input input-field" value="${originalText}" style="padding:5px; height:30px;">
                             <button class="btn btn-sm btn-primary save-edit"><i class="fas fa-check"></i></button>
                             <button class="btn btn-sm btn-danger cancel-edit"><i class="fas fa-times"></i></button>
                       `;
                       textContainer.appendChild(editDiv);

                       editDiv.querySelector('.save-edit').onclick = (ev) => {
                           ev.stopPropagation();
                           const newText = editDiv.querySelector('.edit-input').value;
                           if (newText !== originalText) {
                               ws.send(JSON.stringify({
                                   type: 'edit_message',
                                   groupId: currentGroup.id,
                                   messageId: msg.id,
                                   text: newText,
                                   user: user.username
                               }));
                           }
                           editDiv.remove();
                           textSpan.style.display = originalDisplay;
                       };

                       editDiv.querySelector('.cancel-edit').onclick = (ev) => {
                           ev.stopPropagation();
                           editDiv.remove();
                           textSpan.style.display = originalDisplay;
                       };
                  }
              }));
          }

          contextMenu.appendChild(createOption("Delete", "fas fa-trash", () => {
              if(confirm("Delete this message?")) {
                   ws.send(JSON.stringify({
                       type: 'delete_message',
                       groupId: currentGroup.id,
                       messageId: msg.id,
                       user: user.username
                   }));
              }
          }, true));
      }

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
    if (!text) return; // Just text

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

  function sendFile(file) {
      if (!currentGroup) return alert('Select a group first');
      if (file.size > 1024 * 1024) return alert('File too large (max 1MB)');

      pendingFile = file;

      // Show Preview Modal
      attachmentPreviewModal.classList.remove('hidden');
      attachmentCaption.value = messageInput.value.trim(); // Pre-fill caption if any

      if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
              previewImage.src = e.target.result;
              previewImage.style.display = 'block';
              previewFile.style.display = 'none';
          };
          reader.readAsDataURL(file);
      } else {
          previewImage.style.display = 'none';
          previewFile.style.display = 'block';
          previewFileName.textContent = file.name;
      }

      attachmentCaption.focus();
  }

  // Send from Modal
  sendAttachmentBtn.addEventListener('click', async () => {
      if (!pendingFile) return;

      const formData = new FormData();
      formData.append('file', pendingFile);

      sendAttachmentBtn.disabled = true;
      sendAttachmentBtn.textContent = 'Sending...';

      try {
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();

          if (data.success) {
              const payload = {
                  type: 'message',
                  groupId: currentGroup.id,
                  text: attachmentCaption.value.trim(),
                  user: user.username,
                  replyTo: replyToMessage,
                  attachmentUrl: data.url,
                  attachmentType: data.type,
                  originalFilename: data.originalFilename
              };
              ws.send(JSON.stringify(payload));

              // Cleanup
              attachmentPreviewModal.classList.add('hidden');
              pendingFile = null;
              messageInput.value = '';
              messageInput.style.height = 'auto';
              replyToMessage = null;
              replyBanner.classList.remove('active');
          } else {
              alert(data.error);
          }
      } catch(e) { console.error(e); alert('Upload failed'); }

      sendAttachmentBtn.disabled = false;
      sendAttachmentBtn.textContent = 'Send';
  });

  cancelAttachmentBtn.addEventListener('click', () => {
      attachmentPreviewModal.classList.add('hidden');
      pendingFile = null;
  });

  closePreviewModal.addEventListener('click', () => {
      attachmentPreviewModal.classList.add('hidden');
      pendingFile = null;
  });

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

      // Clean up previous dynamic sections
      const oldInviteSection = document.getElementById('inviteSection');
      if (oldInviteSection) oldInviteSection.remove();

      // Setup dynamic UI
      const infoContainer = document.querySelector('.group-info-header');

      // Update ID Display with truncation and Copy button
      const idDisplay = document.getElementById('infoGroupId');
      // Truncate ID: first 8 ... last 4
      const shortId = fullGroup.id.length > 12 ? `${fullGroup.id.substring(0,8)}...${fullGroup.id.substring(fullGroup.id.length-4)}` : fullGroup.id;

      idDisplay.innerHTML = `
        <span class="id-text" title="${fullGroup.id}">${shortId}</span>
        <button class="btn-icon-tiny copy-id-btn" title="Copy ID"><i class="fas fa-copy"></i></button>
      `;
      idDisplay.querySelector('.copy-id-btn').onclick = () => {
          navigator.clipboard.writeText(fullGroup.id);
          const icon = idDisplay.querySelector('i');
          icon.className = 'fas fa-check';
          setTimeout(() => icon.className = 'fas fa-copy', 1500);
      };

      const isMember = fullGroup.members.includes(user.username);
      const isAdmin = fullGroup.admins && fullGroup.admins.includes(user.username);
      const invitePerm = fullGroup.invite_permission || 'admin';

      let canInvite = false;
      if (invitePerm === 'all' && isMember) canInvite = true;
      if (invitePerm === 'admin' && (isAdmin || isOwner)) canInvite = true;

      // Container for actions (Invite + Owner Toggles)
      let actionsContainer = document.getElementById('groupActionsContainer');
      if (!actionsContainer) {
          actionsContainer = document.createElement('div');
          actionsContainer.id = 'groupActionsContainer';
          actionsContainer.className = 'group-actions-container';
          // Insert after the header info but before members list
          infoContainer.appendChild(actionsContainer);
      }
      actionsContainer.innerHTML = '';

      if (canInvite && fullGroup.type !== 'dm') {
          const btn = document.createElement('button');
          btn.className = 'btn btn-primary btn-block';
          btn.innerHTML = '<i class="fas fa-user-plus"></i> Add Member';
          btn.style.marginBottom = '15px';
          btn.onclick = () => openInviteModal(fullGroup);
          actionsContainer.appendChild(btn);
      }

      if (isOwner && fullGroup.type !== 'dm') {
          const toggleDiv = document.createElement('div');
          toggleDiv.className = 'setting-toggle-row';
          toggleDiv.innerHTML = `
            <span class="setting-label">Allow all members to invite</span>
            <label class="switch">
                <input type="checkbox" id="invitePermToggle" ${invitePerm === 'all' ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
          `;
          actionsContainer.appendChild(toggleDiv);

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
          const res = await fetch('/api/groups/settings', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ groupId, requester: user.username, avatar })
          });
          if (res.ok) {
              openGroupInfo({id: groupId});
          } else {
              alert('Failed to update group settings');
          }
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
      updateTabBadges();
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
              badge = `<span class="unread-badge">${dmGroup.unreadCount}</span>`;
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
      // Removed inline background
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

  // Drag & Drop & Paste
  chatArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      chatArea.style.background = 'var(--bg-hover)';
  });

  chatArea.addEventListener('drop', async (e) => {
      e.preventDefault();
      chatArea.style.background = '';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          let file = e.dataTransfer.files[0];
          try {
             if (file.type.startsWith('image/')) {
                 file = await CropperUtils.cropImage(file);
             }
             sendFile(file);
          } catch(e) {}
      }
  });

  // Paste Support
  document.addEventListener('paste', async (e) => {
      if (!currentGroup) return;
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let index in items) {
          const item = items[index];
          if (item.kind === 'file') {
              let blob = item.getAsFile();
              try {
                  if (blob.type.startsWith('image/')) {
                     blob = await CropperUtils.cropImage(blob);
                  }
                  sendFile(blob);
              } catch(e) {}
              e.preventDefault();
              return;
          }
      }
  });

  attachBtn.addEventListener('click', () => {
      fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
      if(fileInput.files && fileInput.files[0]) {
          let file = fileInput.files[0];
          try {
             // Crop if image
             if (file.type.startsWith('image/')) {
                 file = await CropperUtils.cropImage(file); // Free aspect ratio
             }
             sendFile(file);
          } catch(e) {
              console.log("Cancelled");
          }
          fileInput.value = '';
      }
  });

  groupAvatarUpload.addEventListener('change', async () => {
      if (groupAvatarUpload.files && groupAvatarUpload.files[0]) {
          let file = groupAvatarUpload.files[0];
           if (file.size > 1024 * 1024) return alert('File too large (max 1MB)');

           try {
               file = await CropperUtils.cropImage(file, 1); // 1:1 Aspect Ratio
           } catch(e) { return; }

           const formData = new FormData();
           formData.append('file', file);
           try {
               const res = await fetch('/api/upload', { method: 'POST', body: formData });
               const data = await res.json();
               if(data.success) {
                   editGroupAvatarInput.value = data.url;
                   // Update preview if possible, but we don't have a direct preview element easily accessible here except by reloading?
                   // The user has to click Save. Let's just alert for now or update the image src if we can find it.
                   // Actually openGroupInfo creates the modal, so 'infoGroupAvatar' is the element.
                   const img = document.getElementById('infoGroupAvatar');
                   if(img) img.src = data.url;
               } else {
                   alert(data.error);
               }
           } catch(e) { console.error(e); }
      }
  });

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

  // Lightbox Logic
  let zoomLevel = 1;

  function openLightbox(src) {
      lightboxImage.src = src;
      imageLightboxModal.classList.remove('hidden');
      zoomLevel = 1;
      lightboxImage.style.transform = `scale(${zoomLevel})`;
  }

  // Zoom Logic
  lightboxImage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      zoomLevel = Math.max(0.5, Math.min(zoomLevel + delta, 5));
      lightboxImage.style.transform = `scale(${zoomLevel})`;
  });

  if (closeLightbox) {
      closeLightbox.addEventListener('click', () => {
          imageLightboxModal.classList.add('hidden');
          lightboxImage.src = '';
          zoomLevel = 1;
      });
  }

  // Global Modal Outside Click Handler
  window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal') || e.target.classList.contains('lightbox-modal')) {
          e.target.classList.add('hidden');
          // Clean up lightbox if closed this way
          if(e.target.id === 'imageLightboxModal') {
              lightboxImage.src = '';
          }
      }
  });

});
