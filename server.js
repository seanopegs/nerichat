const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Data Paths
const DATA_DIR = path.join(__dirname, "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const GROUPS_DIR = path.join(DATA_DIR, "groups");

// Ensure directories exist
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });
if (!fs.existsSync(GROUPS_DIR)) fs.mkdirSync(GROUPS_DIR, { recursive: true });

// --- Helper Functions ---

function getUserFilePath(username) {
  return path.join(USERS_DIR, `${username}.json`);
}

function getGroupFilePath(groupId) {
  return path.join(GROUPS_DIR, `${groupId}.json`);
}

function readJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  try {
    const data = fs.readFileSync(filepath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filepath}:`, err);
    return null;
  }
}

function writeJSON(filepath, data) {
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`Error writing ${filepath}:`, err);
    return false;
  }
}

function broadcastToGroup(group, data) {
  const msgString = JSON.stringify(data);
  group.members.forEach(member => {
    const memberWs = clients.get(member);
    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
      memberWs.send(msgString);
    }
  });
}

function broadcastStatusUpdate(username, status) {
    const msgString = JSON.stringify({
        type: 'status_update',
        username: username,
        status: status
    });

    // We need to broadcast to all friends of this user and all group members of common groups.
    // A simpler approach for this scope is to broadcast to all connected clients,
    // or iterate all users and check relationship.
    // Given "broadcast to all" is simplest for small scale, but let's try to be slightly targeted or just broadcast all.
    // Broadcasting to all is fine for now.
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msgString);
        }
    });
}

function createSystemMessage(group, text) {
    const msgObj = {
        id: crypto.randomUUID(),
        type: "system",
        text: text,
        timestamp: Date.now(),
        readBy: [],
        receivedBy: []
    };
    group.messages.push(msgObj);

    writeJSON(getGroupFilePath(group.id), group);

    broadcastToGroup(group, {
        type: "new_message",
        groupId: group.id,
        message: msgObj
    });
}

// --- API Routes ---

// Register
app.post("/api/register", (req, res) => {
  const { username, password, displayName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be alphanumeric" });
  }

  const filepath = getUserFilePath(username);
  if (fs.existsSync(filepath)) {
    return res.status(409).json({ error: "Username already exists" });
  }

  const newUser = {
    username,
    password,
    displayName: displayName || username,
    avatar: "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName || username),
    theme: "light",
    invisible: false,
    groups: [],
    friends: [],
    friendRequests: []
  };

  if (writeJSON(filepath, newUser)) {
    res.json({ success: true, user: { username, displayName: newUser.displayName } });
  } else {
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const filepath = getUserFilePath(username);
  const user = readJSON(filepath);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.json({
    success: true,
    user: {
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      theme: user.theme,
      invisible: user.invisible || false
    }
  });
});

// Get User Data
app.get("/api/user/:username", (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: "Invalid username" });

  const user = readJSON(getUserFilePath(username));
  if (!user) return res.status(404).json({ error: "User not found" });

  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// Search Users
app.get("/api/users/search", (req, res) => {
  const { query } = req.query;
  if (!query) return res.json({ users: [] });

  const user = readJSON(getUserFilePath(query));
  if (user) {
      return res.json({ users: [{ username: user.username, displayName: user.displayName, avatar: user.avatar }] });
  }
  res.json({ users: [] });
});


// Update Settings
app.post("/api/user/settings", (req, res) => {
  const { username, displayName, avatar, theme, password, invisible } = req.body;
  const filepath = getUserFilePath(username);
  const user = readJSON(filepath);

  if (!user) return res.status(404).json({ error: "User not found" });

  if (displayName) user.displayName = displayName;

  if (avatar !== undefined) {
     if (avatar === "") {
        user.avatar = "https://ui-avatars.com/api/?name=" + encodeURIComponent(user.displayName);
     } else {
        user.avatar = avatar;
     }
  }

  if (theme) user.theme = theme;
  if (password) user.password = password;

  let statusChanged = false;
  if (invisible !== undefined) {
      if (user.invisible !== invisible) {
          user.invisible = invisible;
          statusChanged = true;
      }
  }

  writeJSON(filepath, user);

  if (statusChanged) {
      // If invisible is true, broadcast offline. If false, broadcast online (assuming connected).
      const ws = clients.get(username);
      const isOnline = ws && ws.readyState === WebSocket.OPEN;

      let statusToBroadcast = 'offline';
      if (!user.invisible && isOnline) {
          statusToBroadcast = 'online';
      }
      broadcastStatusUpdate(username, statusToBroadcast);
  }

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// Pin Chat
app.post("/api/user/pin", (req, res) => {
    const { username, groupId, action } = req.body;
    const filepath = getUserFilePath(username);
    const user = readJSON(filepath);

    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.pinned_chats) user.pinned_chats = [];

    if (action === 'pin') {
        if (user.pinned_chats.length >= 3) {
            return res.status(400).json({ error: "Max 3 pinned chats allowed" });
        }
        if (!user.pinned_chats.includes(groupId)) {
            user.pinned_chats.push(groupId);
        }
    } else if (action === 'unpin') {
        user.pinned_chats = user.pinned_chats.filter(id => id !== groupId);
    }

    writeJSON(filepath, user);
    res.json({ success: true, pinned_chats: user.pinned_chats });
});

// --- Friend Routes ---

app.get("/api/friends", (req, res) => {
    const { username } = req.query;
    const user = readJSON(getUserFilePath(username));
    if (!user) return res.status(404).json({ error: "User not found" });

    const friendsData = (user.friends || []).map(fUsername => {
        const fUser = readJSON(getUserFilePath(fUsername));
        if (!fUser) return { username: fUsername, displayName: fUsername };
        return { username: fUser.username, displayName: fUser.displayName, avatar: fUser.avatar };
    });

    res.json({
        friends: friendsData,
        friendRequests: user.friendRequests || []
    });
});

app.post("/api/friends/request", (req, res) => {
    const { from, to } = req.body;
    if (from === to) return res.status(400).json({ error: "Cannot add yourself" });

    const fromUser = readJSON(getUserFilePath(from));
    const toUser = readJSON(getUserFilePath(to));

    if (!fromUser || !toUser) return res.status(404).json({ error: "User not found" });

    if (!toUser.friendRequests) toUser.friendRequests = [];
    if (!toUser.friends) toUser.friends = [];
    if (!fromUser.friends) fromUser.friends = [];

    if (toUser.friends.includes(from)) return res.status(400).json({ error: "Already friends" });
    if (toUser.friendRequests.find(r => r.from === from)) return res.status(400).json({ error: "Request already sent" });

    toUser.friendRequests.push({ from, timestamp: Date.now() });
    writeJSON(getUserFilePath(to), toUser);

    res.json({ success: true });
});

app.post("/api/friends/respond", (req, res) => {
    const { user, from, action } = req.body;
    const myUserPath = getUserFilePath(user);
    const myUser = readJSON(myUserPath);
    const otherUserPath = getUserFilePath(from);
    const otherUser = readJSON(otherUserPath);

    if (!myUser || !otherUser) return res.status(404).json({ error: "User not found" });

    if (!myUser.friendRequests) myUser.friendRequests = [];
    myUser.friendRequests = myUser.friendRequests.filter(r => r.from !== from);

    if (action === 'accept') {
        if (!myUser.friends) myUser.friends = [];
        if (!otherUser.friends) otherUser.friends = [];

        if (!myUser.friends.includes(from)) myUser.friends.push(from);
        if (!otherUser.friends.includes(user)) otherUser.friends.push(user);

        writeJSON(otherUserPath, otherUser);
    }

    writeJSON(myUserPath, myUser);
    res.json({ success: true });
});

app.post("/api/friends/remove", (req, res) => {
    const { user, target } = req.body;
    const myUserPath = getUserFilePath(user);
    const myUser = readJSON(myUserPath);
    const targetPath = getUserFilePath(target);
    const targetUser = readJSON(targetPath);

    if (myUser && myUser.friends) {
        myUser.friends = myUser.friends.filter(f => f !== target);
        writeJSON(myUserPath, myUser);
    }
    if (targetUser && targetUser.friends) {
        targetUser.friends = targetUser.friends.filter(f => f !== user);
        writeJSON(targetPath, targetUser);
    }
    res.json({ success: true });
});

// --- Group Routes ---

// Create Group
app.post("/api/groups", (req, res) => {
  const { name, creator, members, type } = req.body;
  if (!creator) return res.status(400).json({ error: "Creator required" });

  if (type === 'dm' && members && members.length === 1) {
      const other = members[0];
      const user = readJSON(getUserFilePath(creator));
      if (user && user.groups) {
          for (const gid of user.groups) {
              const g = readJSON(getGroupFilePath(gid));
              if (g && g.type === 'dm' && g.members.includes(other) && g.members.includes(creator)) {
                  return res.json({ success: true, group: g });
              }
          }
      }
  }

  const groupId = crypto.randomUUID();
  const initialMembers = [creator];
  if (members) initialMembers.push(...members);

  const newGroup = {
    id: groupId,
    name: name || "Group",
    type: type || "group",
    members: [...new Set(initialMembers)],
    messages: [],
    owner: creator,
    admins: [],
        muted: {}, // { username: timestamp }
        invite_permission: 'admin', // 'admin' or 'all'
    avatar: "https://ui-avatars.com/api/?name=" + encodeURIComponent(name || "Group")
  };

  writeJSON(getGroupFilePath(groupId), newGroup);

  newGroup.members.forEach(m => {
      const uPath = getUserFilePath(m);
      const u = readJSON(uPath);
      if (u) {
          if (!u.groups) u.groups = [];
          if (!u.groups.includes(groupId)) {
            u.groups.push(groupId);
            writeJSON(uPath, u);
          }
      }
  });

  res.json({ success: true, group: newGroup });
});

// Join Group (Manual via ID - usually for public, but let's keep it open or restrict?)
// User didn't specify restricting 'join', only 'invite'.
app.post("/api/groups/join", (req, res) => {
  const { groupId, username } = req.body;
  const groupPath = getGroupFilePath(groupId);
  const group = readJSON(groupPath);
  const userPath = getUserFilePath(username);
  const user = readJSON(userPath);

  if (!group || !user) return res.status(404).json({ error: "Group or user not found" });

  if (!group.members.includes(username)) {
    group.members.push(username);
    createSystemMessage(group, `${username} joined the group`);
    writeJSON(groupPath, group);
  }

  if (!user.groups.includes(groupId)) {
    user.groups.push(groupId);
    writeJSON(userPath, user);
  }

  res.json({ success: true, group });
});

// Invite Friend to Group
app.post("/api/groups/invite", (req, res) => {
    const { groupId, requester, target } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);
    const reqUserPath = getUserFilePath(requester);
    const reqUser = readJSON(reqUserPath);
    const targetUserPath = getUserFilePath(target);
    const targetUser = readJSON(targetUserPath);

    if (!group || !reqUser || !targetUser) return res.status(404).json({ error: "Not found" });

    // Check if target is friend of requester
    if (!reqUser.friends || !reqUser.friends.includes(target)) {
        return res.status(403).json({ error: "Can only invite friends" });
    }

    // Check Permission
    const isOwner = group.owner === requester;
    const isAdmin = group.admins && group.admins.includes(requester);
    const perm = group.invite_permission || 'admin';

    let allowed = false;
    if (perm === 'all') allowed = group.members.includes(requester);
    else if (perm === 'admin') allowed = isOwner || isAdmin;

    if (!allowed) return res.status(403).json({ error: "You do not have permission to invite" });

    if (group.members.includes(target)) return res.status(400).json({ error: "User already in group" });

    group.members.push(target);
    writeJSON(groupPath, group);

    if (!targetUser.groups.includes(groupId)) {
        targetUser.groups.push(groupId);
        writeJSON(targetUserPath, targetUser);
    }

    createSystemMessage(group, `${requester} added ${target} to the group`);

    res.json({ success: true });
});

// Mute Member
app.post("/api/groups/mute", (req, res) => {
    const { groupId, requester, target, duration } = req.body; // duration in seconds, -1 for permanent
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });

    const isOwner = group.owner === requester;
    const isAdmin = group.admins && group.admins.includes(requester);

    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Permission denied" });

    // Hierarchy Check
    if (target === group.owner) return res.status(403).json({ error: "Cannot mute owner" });
    if (isAdmin && !isOwner && group.admins && group.admins.includes(target)) return res.status(403).json({ error: "Admin cannot mute admin" });

    if (!group.muted) group.muted = {};

    // Duration logic
    let mutedUntil = -1;
    if (duration > 0) {
        mutedUntil = Date.now() + (duration * 1000);
    }

    group.muted[target] = mutedUntil;
    writeJSON(groupPath, group);

    createSystemMessage(group, `${target} was muted by ${requester}`);
    res.json({ success: true });
});

// Unmute Member
app.post("/api/groups/unmute", (req, res) => {
    const { groupId, requester, target } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });

    const isOwner = group.owner === requester;
    const isAdmin = group.admins && group.admins.includes(requester);

    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Permission denied" });

    // Hierarchy Check: Admin cannot unmute if muted by Owner?
    // User said "Admin gbs toggle off diri sendiri klo di mute owner".
    // Simplification: If admin tries to unmute someone, check if they have higher rank?
    // For now, let's just allow unmuting anyone except Admin/Owner hierarchy rules applies usually.
    // If target is Admin, only Owner can mute them, so only Owner can unmute them ideally?
    // Or if Admin muted Member, Admin can unmute.
    // But we don't store *who* muted them.
    // Let's just apply standard hierarchy: Admin can unmute Member. Owner can unmute anyone.

    if (isAdmin && !isOwner) {
        if (group.admins && group.admins.includes(target)) return res.status(403).json({ error: "Admin cannot unmute admin" });
    }

    if (group.muted && group.muted[target] !== undefined) {
        delete group.muted[target];
        writeJSON(groupPath, group);
        createSystemMessage(group, `${target} was unmuted by ${requester}`);
    }

    res.json({ success: true });
});

// Leave Group
app.post("/api/groups/leave", (req, res) => {
    const { groupId, username } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);
    const userPath = getUserFilePath(username);
    const user = readJSON(userPath);

    if (!group || !user) return res.status(404).json({ error: "Group or user not found" });

    if (group.members.includes(username)) {
        group.members = group.members.filter(m => m !== username);
        if (group.admins) {
            group.admins = group.admins.filter(a => a !== username);
        }

        createSystemMessage(group, `${username} left the group`);
    }

    if (user.groups.includes(groupId)) {
        user.groups = user.groups.filter(g => g !== groupId);
        writeJSON(userPath, user);
    }

    res.json({ success: true });
});

// Kick Member
app.post("/api/groups/kick", (req, res) => {
    const { groupId, requester, target } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });

    const isOwner = group.owner === requester;
    const isAdmin = group.admins && group.admins.includes(requester);

    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Permission denied" });

    if (target === group.owner) return res.status(403).json({ error: "Cannot kick owner" });

    if (isAdmin && !isOwner && group.admins.includes(target)) {
        return res.status(403).json({ error: "Admins cannot kick other admins" });
    }

    group.members = group.members.filter(m => m !== target);
    if (group.admins) group.admins = group.admins.filter(a => a !== target);

    createSystemMessage(group, `${target} was kicked by ${requester}`);

    const targetPath = getUserFilePath(target);
    const targetUser = readJSON(targetPath);
    if (targetUser && targetUser.groups) {
        targetUser.groups = targetUser.groups.filter(g => g !== groupId);
        writeJSON(targetPath, targetUser);
    }

    res.json({ success: true });
});

// Promote to Admin
app.post("/api/groups/promote", (req, res) => {
    const { groupId, requester, target } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner !== requester) return res.status(403).json({ error: "Only owner can promote" });

    if (!group.admins) group.admins = [];
    if (!group.admins.includes(target) && group.members.includes(target)) {
        group.admins.push(target);
        writeJSON(groupPath, group);
        createSystemMessage(group, `${target} is now an Admin`);
    }

    res.json({ success: true });
});

// Demote from Admin
app.post("/api/groups/demote", (req, res) => {
    const { groupId, requester, target } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner !== requester) return res.status(403).json({ error: "Only owner can demote" });

    if (group.admins && group.admins.includes(target)) {
        group.admins = group.admins.filter(a => a !== target);
        writeJSON(groupPath, group);
        createSystemMessage(group, `${target} is no longer an Admin`);
    }

    res.json({ success: true });
});

// Delete Group
app.post("/api/groups/delete", (req, res) => {
    const { groupId, requester } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner !== requester) return res.status(403).json({ error: "Only owner can delete group" });

    group.members.forEach(m => {
        const uPath = getUserFilePath(m);
        const u = readJSON(uPath);
        if (u && u.groups) {
            u.groups = u.groups.filter(g => g !== groupId);
            writeJSON(uPath, u);
        }
    });

    fs.unlinkSync(groupPath);

    const broadcastData = JSON.stringify({
        type: "group_deleted",
        groupId
    });

    group.members.forEach(member => {
        const memberWs = clients.get(member);
        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
            memberWs.send(broadcastData);
        }
    });

    res.json({ success: true });
});

// Reset Group ID
app.post("/api/groups/reset-id", (req, res) => {
    const { groupId, requester } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner !== requester) return res.status(403).json({ error: "Only owner can reset ID" });

    const newId = crypto.randomUUID();
    const newGroupPath = getGroupFilePath(newId);

    group.id = newId;

    if (writeJSON(newGroupPath, group)) {
        fs.unlinkSync(groupPath);

        group.members.forEach(m => {
            const uPath = getUserFilePath(m);
            const u = readJSON(uPath);
            if (u && u.groups) {
                const idx = u.groups.indexOf(groupId);
                if (idx !== -1) {
                    u.groups[idx] = newId;
                    writeJSON(uPath, u);
                }
            }
        });

        const broadcastData = JSON.stringify({
            type: "group_id_changed",
            oldId: groupId,
            newId: newId,
            group: group
        });

        group.members.forEach(member => {
            const memberWs = clients.get(member);
            if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                memberWs.send(broadcastData);
            }
        });

        createSystemMessage(group, "Group ID has been reset by the owner.");

        res.json({ success: true, newId });
    } else {
        res.status(500).json({ error: "Failed to reset ID" });
    }
});

// Update Group Settings (Name/Avatar/Permissions)
app.post("/api/groups/settings", (req, res) => {
    const { groupId, requester, name, avatar, invite_permission } = req.body;
    const groupPath = getGroupFilePath(groupId);
    const group = readJSON(groupPath);

    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner !== requester) return res.status(403).json({ error: "Only owner can change settings" });

    if (name) group.name = name;
    if (avatar !== undefined) group.avatar = avatar;
    if (invite_permission) group.invite_permission = invite_permission;

    writeJSON(groupPath, group);

    createSystemMessage(group, "Group settings updated");

    res.json({ success: true, group });
});


// Get My Groups
app.get("/api/my-groups", (req, res) => {
  const { username } = req.query;
  const user = readJSON(getUserFilePath(username));
  if (!user) return res.status(404).json({ error: "User not found" });

  const groups = [];
  if (user.groups) {
    for (const groupId of user.groups) {
      const g = readJSON(getGroupFilePath(groupId));
      if (g) {
          let name = g.name;
          let avatar = g.avatar;
          if (g.type === 'dm') {
              const other = g.members.find(m => m !== username) || "Unknown";
              name = other;
              const otherUser = readJSON(getUserFilePath(other));
              if (otherUser) avatar = otherUser.avatar;
          }

          // Calculate unread count
          let unread = 0;
          if (g.messages) {
              unread = g.messages.filter(m =>
                  m.type !== 'system' &&
                  (!m.readBy || !m.readBy.includes(username))
              ).length;
          }

          groups.push({ id: g.id, name: name, type: g.type, avatar: avatar, unreadCount: unread });
      }
    }
  }
  res.json({ groups });
});

// Get Group Data
app.get("/api/groups/:id", (req, res) => {
  const group = readJSON(getGroupFilePath(req.params.id));
  if (!group) return res.status(404).json({ error: "Group not found" });
  res.json(group);
});


// --- WebSocket Logic ---

const clients = new Map(); // username -> ws

wss.on("connection", (ws) => {
  let currentUser = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "auth") {
        currentUser = data.username;
        clients.set(currentUser, ws);
        console.log(`WS: User ${currentUser} connected`);

        // Broadcast Online if not invisible
        const user = readJSON(getUserFilePath(currentUser));
        if (user && !user.invisible) {
            broadcastStatusUpdate(currentUser, 'online');
        }
      }
      else if (data.type === "message") {
        const { groupId, text, user, replyTo } = data;

        if (!groupId || !text || !user) return;

        const groupPath = getGroupFilePath(groupId);
        const group = readJSON(groupPath);

        if (group) {
            if (!group.members.includes(user)) return;

            // Check Mute Status
            if (group.muted && group.muted[user] !== undefined) {
                const until = group.muted[user];
                if (until === -1 || until > Date.now()) {
                    // User is muted
                    const ws = clients.get(user);
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `You are muted until ${until === -1 ? 'forever' : new Date(until).toLocaleString()}`
                        }));
                    }
                    return;
                } else {
                    // Expired
                    delete group.muted[user];
                    writeJSON(groupPath, group);
                }
            }

            const msgObj = {
                id: crypto.randomUUID(),
                user,
                text,
                replyTo,
                timestamp: Date.now(),
                readBy: [user],
                receivedBy: [user]
            };
            group.messages.push(msgObj);
            writeJSON(groupPath, group);

            broadcastToGroup(group, {
                type: "new_message",
                groupId,
                message: msgObj
            });
        }
      }
      else if (data.type === "received_message") {
          const { groupId, user, messageId } = data;

           const groupPath = getGroupFilePath(groupId);
           const group = readJSON(groupPath);

           if (group) {
               let changed = false;
               group.messages.forEach(msg => {
                   if (msg.type === 'system') return;
                   if (!msg.receivedBy) msg.receivedBy = [];
                   if (!msg.receivedBy.includes(user)) {
                       msg.receivedBy.push(user);
                       changed = true;
                   }
               });

               if (changed) {
                   writeJSON(groupPath, group);
                   broadcastToGroup(group, {
                       type: "delivery_update",
                       groupId,
                       user,
                       receivedBy: user
                   });
               }
           }
      }
      else if (data.type === "read_message") {
        const { groupId, user } = data;

        const groupPath = getGroupFilePath(groupId);
        const group = readJSON(groupPath);

        if (group) {
            let changed = false;
            group.messages.forEach(msg => {
                if (msg.type === 'system') return;
                if (!msg.readBy) msg.readBy = [];
                if (!msg.receivedBy) msg.receivedBy = [];

                if (!msg.receivedBy.includes(user)) {
                    msg.receivedBy.push(user);
                    changed = true;
                }

                if (!msg.readBy.includes(user)) {
                    msg.readBy.push(user);
                    changed = true;
                }
            });

            if (changed) {
                writeJSON(groupPath, group);
                broadcastToGroup(group, {
                    type: "read_update",
                    groupId,
                    user,
                    readBy: user
                });
            }
        }
      }
    } catch (e) {
      console.error("WS Error:", e);
    }
  });

  ws.on("close", () => {
    if (currentUser) {
      // Broadcast Offline (if not invisible, actually we can just broadcast offline regardless, logic on client? No, client doesn't know if invisible)
      // Check if user was invisible
      const user = readJSON(getUserFilePath(currentUser));
      // If user was invisible, they were already "offline" to others, so no need to broadcast offline?
      // But if they just disconnected, they are definitely offline.
      // If they were invisible, they appeared offline. So disconnection changes nothing visually.
      // If they were visible, broadcast offline.
      if (user && !user.invisible) {
          broadcastStatusUpdate(currentUser, 'offline');
      }

      clients.delete(currentUser);
      console.log(`WS: User ${currentUser} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 25577;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
