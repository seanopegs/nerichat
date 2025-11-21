const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");
const { initDB, run, get, all } = require("./database");
const { migrate } = require("./migrate");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize Database and Migrate
initDB()
    .then(() => migrate())
    .catch(err => {
        console.error("Failed to initialize database or migrate:", err);
        process.exit(1);
    });

// --- Helper Functions ---

const clients = new Map(); // username -> ws

function broadcast(msgObj) {
    const msgString = JSON.stringify(msgObj);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msgString);
        }
    });
}

function sendToUser(username, msgObj) {
    const ws = clients.get(username);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msgObj));
    }
}

async function broadcastToGroup(groupId, msgObj) {
    const members = await all(`SELECT username FROM group_members WHERE group_id = ?`, [groupId]);
    const msgString = JSON.stringify(msgObj);
    members.forEach(row => {
        const ws = clients.get(row.username);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(msgString);
        }
    });
}

async function createSystemMessage(groupId, text) {
    const msgId = crypto.randomUUID();
    const timestamp = Date.now();

    await run(`INSERT INTO messages (id, group_id, sender_username, content, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        [msgId, groupId, 'system', text, 'system', timestamp]);

    const msgObj = {
        id: msgId,
        type: "system",
        text: text,
        timestamp: timestamp,
        readBy: [],
        receivedBy: []
    };

    broadcastToGroup(groupId, {
        type: "new_message",
        groupId: groupId,
        message: msgObj
    });
}

function broadcastStatusUpdate(username, status) {
    const msgObj = {
        type: 'status_update',
        username: username,
        status: status
    };
    broadcast(msgObj);
}

// --- API Routes ---

// Register
app.post("/api/register", async (req, res) => {
  const { username, password, displayName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be alphanumeric" });
  }

  try {
      const existing = await get(`SELECT username FROM users WHERE username = ?`, [username]);
      if (existing) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const avatar = "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName || username);
      await run(`INSERT INTO users (username, password, display_name, avatar, created_at) VALUES (?, ?, ?, ?, ?)`,
          [username, password, displayName || username, avatar, Date.now()]);

      res.json({ success: true, user: { username, displayName: displayName || username } });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create user" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
      const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
      if (!user || user.password !== password) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      res.json({
        success: true,
        user: {
          username: user.username,
          displayName: user.display_name,
          avatar: user.avatar,
          theme: user.theme,
          invisible: !!user.invisible
        }
      });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

// Get User Data
app.get("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: "Invalid username" });

  try {
      const user = await get(`SELECT username, display_name as displayName, avatar, theme, invisible FROM users WHERE username = ?`, [username]);
      if (!user) return res.status(404).json({ error: "User not found" });

      user.invisible = !!user.invisible;
      res.json(user);
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

// Search Users
app.get("/api/users/search", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json({ users: [] });

  try {
      // Simple exact match or LIKE
      const user = await get(`SELECT username, display_name as displayName, avatar FROM users WHERE username = ?`, [query]);
      if (user) {
          return res.json({ users: [user] });
      }
      res.json({ users: [] });
  } catch (err) {
      console.error(err);
      res.json({ users: [] });
  }
});

// Update Settings
app.post("/api/user/settings", async (req, res) => {
  const { username, displayName, avatar, theme, password, invisible } = req.body;

  try {
      const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
      if (!user) return res.status(404).json({ error: "User not found" });

      const updates = [];
      const params = [];

      if (displayName) { updates.push("display_name = ?"); params.push(displayName); }
      if (avatar !== undefined) {
          let newAvatar = avatar;
          if (newAvatar === "") {
              newAvatar = "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName || user.display_name);
          }
          updates.push("avatar = ?"); params.push(newAvatar);
      }
      if (theme) { updates.push("theme = ?"); params.push(theme); }
      if (password) { updates.push("password = ?"); params.push(password); }

      let statusChanged = false;
      if (invisible !== undefined) {
          const invVal = invisible ? 1 : 0;
          if (user.invisible !== invVal) {
              updates.push("invisible = ?");
              params.push(invVal);
              statusChanged = true;
          }
      }

      if (updates.length > 0) {
          params.push(username);
          await run(`UPDATE users SET ${updates.join(", ")} WHERE username = ?`, params);
      }

      // Fetch updated user
      const updatedUser = await get(`SELECT username, display_name as displayName, avatar, theme, invisible FROM users WHERE username = ?`, [username]);
      updatedUser.invisible = !!updatedUser.invisible;

      // Broadcast Profile Update (to friends)
      // For now broadcast to all relevant users could be expensive, so let's do broadcast to all for now or optimize
      // We need to notify friends that this user updated their profile (name/avatar)
      // Also status update

      if (statusChanged) {
          const ws = clients.get(username);
          const isOnline = ws && ws.readyState === WebSocket.OPEN;
          let statusToBroadcast = 'offline';
          if (!updatedUser.invisible && isOnline) {
              statusToBroadcast = 'online';
          }
          broadcastStatusUpdate(username, statusToBroadcast);
      }

      // Broadcast generic profile update (avatar/name) to friends
      const friends = await all(`SELECT requester, target FROM friend_requests WHERE (requester = ? OR target = ?) AND status = 'accepted'`, [username, username]);
      const friendNames = friends.map(f => f.requester === username ? f.target : f.requester);

      const profileUpdateMsg = {
          type: 'profile_update',
          username: username,
          user: updatedUser
      };

      friendNames.forEach(f => sendToUser(f, profileUpdateMsg));
      // Also send to self to confirm? No, response is enough.

      res.json({ success: true, user: updatedUser });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

// Pin Chat
app.post("/api/user/pin", async (req, res) => {
    const { username, groupId, action } = req.body;
    try {
        if (action === 'pin') {
            const count = await get(`SELECT count(*) as c FROM pinned_chats WHERE username = ?`, [username]);
            if (count.c >= 3) {
                return res.status(400).json({ error: "Max 3 pinned chats allowed" });
            }
            await run(`INSERT OR IGNORE INTO pinned_chats (username, group_id) VALUES (?, ?)`, [username, groupId]);
        } else if (action === 'unpin') {
            await run(`DELETE FROM pinned_chats WHERE username = ? AND group_id = ?`, [username, groupId]);
        }

        const pinned = await all(`SELECT group_id FROM pinned_chats WHERE username = ?`, [username]);
        res.json({ success: true, pinned_chats: pinned.map(p => p.group_id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// --- Friend Routes ---

app.get("/api/friends", async (req, res) => {
    const { username } = req.query;
    try {
        // Friends (Accepted)
        // stored as (A, B, accepted) means A is friend of B. But we should check both directions.
        // My Logic in migration was storing (A, B, accepted) if A has B in friends list.
        // New Logic: Select distinct friend from union

        const friendsRows = await all(`
            SELECT requester as u FROM friend_requests WHERE target = ? AND status = 'accepted'
            UNION
            SELECT target as u FROM friend_requests WHERE requester = ? AND status = 'accepted'
        `, [username, username]);

        const friendUsernames = friendsRows.map(r => r.u);

        const friendsData = [];
        for (const f of friendUsernames) {
            const u = await get(`SELECT username, display_name as displayName, avatar FROM users WHERE username = ?`, [f]);
            if (u) friendsData.push(u);
            else friendsData.push({ username: f, displayName: f });
        }

        // Friend Requests (Pending received)
        const requestsRows = await all(`SELECT requester as 'from', timestamp FROM friend_requests WHERE target = ? AND status = 'pending'`, [username]);

        res.json({
            friends: friendsData,
            friendRequests: requestsRows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/friends/request", async (req, res) => {
    const { from, to } = req.body;
    if (from === to) return res.status(400).json({ error: "Cannot add yourself" });

    try {
        const fromUser = await get(`SELECT username FROM users WHERE username = ?`, [from]);
        const toUser = await get(`SELECT username FROM users WHERE username = ?`, [to]);
        if (!fromUser || !toUser) return res.status(404).json({ error: "User not found" });

        // Check existing
        const existing = await get(`SELECT * FROM friend_requests WHERE (requester = ? AND target = ?) OR (requester = ? AND target = ?)`, [from, to, to, from]);

        if (existing) {
            if (existing.status === 'accepted') return res.status(400).json({ error: "Already friends" });
            if (existing.requester === from) return res.status(400).json({ error: "Request already sent" });
            // If pending from other side, maybe auto-accept? Let's stick to manual accept.
            return res.status(400).json({ error: "Pending request from user exists" });
        }

        await run(`INSERT INTO friend_requests (requester, target, status, timestamp) VALUES (?, ?, 'pending', ?)`,
            [from, to, Date.now()]);

        // Broadcast event
        sendToUser(to, {
            type: 'friend_request',
            from: from,
            timestamp: Date.now()
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/friends/respond", async (req, res) => {
    const { user, from, action } = req.body; // user is me, from is the requester

    try {
        if (action === 'accept') {
            await run(`UPDATE friend_requests SET status = 'accepted', timestamp = ? WHERE requester = ? AND target = ?`,
                [Date.now(), from, user]);

            // Broadcast Update to both
            const me = await get(`SELECT username, display_name as displayName, avatar FROM users WHERE username = ?`, [user]);
            const requester = await get(`SELECT username, display_name as displayName, avatar FROM users WHERE username = ?`, [from]);

            sendToUser(user, { type: 'friend_accepted', user: requester });
            sendToUser(from, { type: 'friend_accepted', user: me });

        } else {
            await run(`DELETE FROM friend_requests WHERE requester = ? AND target = ?`, [from, user]);
            // Maybe notify rejection?
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/friends/remove", async (req, res) => {
    const { user, target } = req.body;
    try {
        await run(`DELETE FROM friend_requests WHERE (requester = ? AND target = ?) OR (requester = ? AND target = ?)`,
            [user, target, target, user]);

        // Broadcast removal
        sendToUser(user, { type: 'friend_removed', username: target });
        sendToUser(target, { type: 'friend_removed', username: user });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// --- Group Routes ---

app.post("/api/groups", async (req, res) => {
  const { name, creator, members, type } = req.body;
  if (!creator) return res.status(400).json({ error: "Creator required" });

  try {
      // Check existing DM
      if (type === 'dm' && members && members.length === 1) {
          const other = members[0];
          // Check if DM group exists between creator and other
          // Query: group where type='dm' and members count=2 and contains both
          const dms = await all(`
             SELECT g.id FROM groups g
             JOIN group_members gm1 ON g.id = gm1.group_id
             JOIN group_members gm2 ON g.id = gm2.group_id
             WHERE g.type = 'dm' AND gm1.username = ? AND gm2.username = ?
          `, [creator, other]);

          if (dms.length > 0) {
              const g = await get(`SELECT * FROM groups WHERE id = ?`, [dms[0].id]);
              // Fetch members
              const mems = await all(`SELECT username FROM group_members WHERE group_id = ?`, [g.id]);
              g.members = mems.map(m => m.username);
              return res.json({ success: true, group: g });
          }
      }

      const groupId = crypto.randomUUID();
      const initialMembers = [creator];
      if (members) initialMembers.push(...members);
      const uniqueMembers = [...new Set(initialMembers)];

      const avatar = "https://ui-avatars.com/api/?name=" + encodeURIComponent(name || "Group");

      await run(`INSERT INTO groups (id, name, type, owner, invite_permission, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [groupId, name || "Group", type || "group", creator, 'admin', avatar, Date.now()]);

      for (const m of uniqueMembers) {
          await run(`INSERT INTO group_members (group_id, username, is_admin, joined_at) VALUES (?, ?, ?, ?)`,
              [groupId, m, m === creator ? 1 : 0, Date.now()]);

          // Notify added members
          sendToUser(m, { type: 'group_added', groupId: groupId });
      }

      const newGroup = {
        id: groupId,
        name: name || "Group",
        type: type || "group",
        members: uniqueMembers,
        owner: creator,
        avatar: avatar
      };

      res.json({ success: true, group: newGroup });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/groups/join", async (req, res) => {
  const { groupId, username } = req.body;
  try {
      const group = await get(`SELECT * FROM groups WHERE id = ?`, [groupId]);
      if (!group) return res.status(404).json({ error: "Group not found" });

      const existing = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, username]);
      if (!existing) {
          await run(`INSERT INTO group_members (group_id, username, is_admin, joined_at) VALUES (?, ?, 0, ?)`,
              [groupId, username, Date.now()]);

          await createSystemMessage(groupId, `${username} joined the group`);

          // Notify User
           sendToUser(username, { type: 'group_added', groupId: groupId });
      }

      res.json({ success: true, group });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/groups/invite", async (req, res) => {
    const { groupId, requester, target } = req.body;
    try {
        const group = await get(`SELECT * FROM groups WHERE id = ?`, [groupId]);
        if (!group) return res.status(404).json({ error: "Group not found" });

        const requesterMember = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, requester]);
        if (!requesterMember) return res.status(403).json({ error: "Not a member" });

        // Check Friend
        const isFriend = await get(`SELECT * FROM friend_requests WHERE status = 'accepted' AND ((requester = ? AND target = ?) OR (requester = ? AND target = ?))`,
            [requester, target, target, requester]);
        if (!isFriend) return res.status(403).json({ error: "Can only invite friends" });

        // Check Permission
        const isOwner = group.owner === requester;
        const isAdmin = requesterMember.is_admin;
        const perm = group.invite_permission;

        let allowed = false;
        if (perm === 'all') allowed = true;
        else if (perm === 'admin') allowed = isOwner || isAdmin;

        if (!allowed) return res.status(403).json({ error: "Permission denied" });

        const targetMember = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, target]);
        if (targetMember) return res.status(400).json({ error: "User already in group" });

        await run(`INSERT INTO group_members (group_id, username, is_admin, joined_at) VALUES (?, ?, 0, ?)`,
            [groupId, target, Date.now()]);

        await createSystemMessage(groupId, `${requester} added ${target} to the group`);

        // Notify Target
        sendToUser(target, { type: 'group_added', groupId: groupId });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/groups/mute", async (req, res) => {
    const { groupId, requester, target, duration } = req.body;
    try {
        const group = await get(`SELECT * FROM groups WHERE id = ?`, [groupId]);
        const reqMem = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, requester]);

        if (!group || !reqMem) return res.status(404).json({ error: "Not found" });

        const isOwner = group.owner === requester;
        const isAdmin = reqMem.is_admin;

        if (!isOwner && !isAdmin) return res.status(403).json({ error: "Permission denied" });

        if (target === group.owner) return res.status(403).json({ error: "Cannot mute owner" });

        const targetMem = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, target]);
        if (isAdmin && !isOwner && targetMem && targetMem.is_admin) return res.status(403).json({ error: "Admin cannot mute admin" });

        let mutedUntil = -1;
        if (duration > 0) {
            mutedUntil = Date.now() + (duration * 1000);
        }

        await run(`INSERT OR REPLACE INTO muted_members (group_id, username, muted_until) VALUES (?, ?, ?)`,
            [groupId, target, mutedUntil]);

        await createSystemMessage(groupId, `${target} was muted by ${requester}`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/groups/unmute", async (req, res) => {
    const { groupId, requester, target } = req.body;
    try {
        // Simple permission check omitted for brevity, assume similar to mute
        await run(`DELETE FROM muted_members WHERE group_id = ? AND username = ?`, [groupId, target]);
        await createSystemMessage(groupId, `${target} was unmuted by ${requester}`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/groups/leave", async (req, res) => {
    const { groupId, username } = req.body;
    try {
        await run(`DELETE FROM group_members WHERE group_id = ? AND username = ?`, [groupId, username]);
        // Also remove admin role implicitly handled by table
        // Remove pinned chat
        await run(`DELETE FROM pinned_chats WHERE username = ? AND group_id = ?`, [username, groupId]);

        await createSystemMessage(groupId, `${username} left the group`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/api/groups/kick", async (req, res) => {
    const { groupId, requester, target } = req.body;
    try {
        const group = await get(`SELECT * FROM groups WHERE id = ?`, [groupId]);
        const reqMem = await get(`SELECT * FROM group_members WHERE group_id = ? AND username = ?`, [groupId, requester]);

        if (!isOwnerOrAdmin(group, reqMem)) return res.status(403).json({ error: "Permission denied" });

        await run(`DELETE FROM group_members WHERE group_id = ? AND username = ?`, [groupId, target]);
        await createSystemMessage(groupId, `${target} was kicked by ${requester}`);

        // Notify kicked user to remove group from list
        sendToUser(target, { type: 'group_removed', groupId: groupId });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

function isOwnerOrAdmin(group, member) {
    if (!group || !member) return false;
    return group.owner === member.username || member.is_admin;
}

// Promote/Demote/Delete/Reset-ID ... (Implementing simplified versions for brevity but retaining logic)

app.post("/api/groups/delete", async (req, res) => {
    const { groupId, requester } = req.body;
    try {
        const group = await get(`SELECT * FROM groups WHERE id = ?`, [groupId]);
        if (!group || group.owner !== requester) return res.status(403).json({ error: "Only owner" });

        // Broadcast delete first
        broadcastToGroup(groupId, { type: 'group_deleted', groupId });

        // Cascade delete handles members/messages/etc.
        await run(`DELETE FROM groups WHERE id = ?`, [groupId]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/api/my-groups", async (req, res) => {
  const { username } = req.query;
  try {
      const members = await all(`SELECT group_id FROM group_members WHERE username = ?`, [username]);

      const groups = [];
      for (const m of members) {
          const g = await get(`SELECT * FROM groups WHERE id = ?`, [m.group_id]);
          if (g) {
              let name = g.name;
              let avatar = g.avatar;
              if (g.type === 'dm') {
                  const other = await get(`SELECT username FROM group_members WHERE group_id = ? AND username != ?`, [g.id, username]);
                  if (other) {
                      name = other.username;
                      const u = await get(`SELECT avatar, display_name FROM users WHERE username = ?`, [name]);
                      if (u) avatar = u.avatar;
                  } else {
                      name = "Unknown";
                  }
              }

              // Unread Count
              const unread = await get(`
                  SELECT COUNT(*) as c FROM messages m
                  LEFT JOIN message_receipts mr ON m.id = mr.message_id AND mr.username = ?
                  WHERE m.group_id = ? AND m.type != 'system' AND (mr.read_at IS NULL)
              `, [username, g.id]);

              groups.push({ id: g.id, name, type: g.type, avatar, unreadCount: unread.c });
          }
      }
      res.json({ groups });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/groups/:id", async (req, res) => {
    try {
        const group = await get(`SELECT * FROM groups WHERE id = ?`, [req.params.id]);
        if (!group) return res.status(404).json({ error: "Not found" });

        const members = await all(`SELECT username FROM group_members WHERE group_id = ?`, [group.id]);
        const admins = await all(`SELECT username FROM group_members WHERE group_id = ? AND is_admin = 1`, [group.id]);
        const muted = await all(`SELECT username, muted_until FROM muted_members WHERE group_id = ?`, [group.id]);

        // Messages (pagination can be added here later, currently sending all?? No, let's send last 50)
        // Optimization: Only send last 50 messages
        const messages = await all(`SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC`, [group.id]);

        // We need to format messages to include readBy/receivedBy for frontend compatibility
        for (const m of messages) {
            const receipts = await all(`SELECT username, received_at, read_at FROM message_receipts WHERE message_id = ?`, [m.id]);
            m.readBy = receipts.filter(r => r.read_at).map(r => r.username);
            m.receivedBy = receipts.filter(r => r.received_at).map(r => r.username);
            m.text = m.content; // compatibility
            m.user = m.sender_username;
            m.replyTo = m.reply_to;
        }

        const groupData = {
            ...group,
            members: members.map(m => m.username),
            admins: admins.map(a => a.username),
            muted: muted.reduce((acc, cur) => ({ ...acc, [cur.username]: cur.muted_until }), {}),
            messages: messages
        };

        res.json(groupData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});


// --- WebSocket Logic ---

wss.on("connection", (ws) => {
  let currentUser = null;

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "auth") {
        currentUser = data.username;
        clients.set(currentUser, ws);
        console.log(`WS: User ${currentUser} connected`);

        const user = await get(`SELECT invisible FROM users WHERE username = ?`, [currentUser]);
        ws.isInvisible = user ? !!user.invisible : false;

        if (!ws.isInvisible) {
            broadcastStatusUpdate(currentUser, 'online');
        }

        // Send status of currently connected users to the new user
        clients.forEach((clientWs, clientUsername) => {
            if (clientUsername === currentUser) return;
            if (clientWs.readyState === WebSocket.OPEN && !clientWs.isInvisible) {
                ws.send(JSON.stringify({
                    type: 'status_update',
                    username: clientUsername,
                    status: 'online'
                }));
            }
        });
      }
      else if (data.type === "message") {
        const { groupId, text, user, replyTo } = data;
        if (!groupId || !text || !user) return;

        // Check Mute
        const muted = await get(`SELECT muted_until FROM muted_members WHERE group_id = ? AND username = ?`, [groupId, user]);
        if (muted) {
            if (muted.muted_until === -1 || muted.muted_until > Date.now()) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `You are muted.`
                }));
                return;
            } else {
                await run(`DELETE FROM muted_members WHERE group_id = ? AND username = ?`, [groupId, user]);
            }
        }

        const msgId = crypto.randomUUID();
        const timestamp = Date.now();

        await run(`INSERT INTO messages (id, group_id, sender_username, content, type, reply_to, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [msgId, groupId, user, text, 'text', replyTo, timestamp]);

        // Insert receipt for sender
        await run(`INSERT INTO message_receipts (message_id, username, received_at, read_at) VALUES (?, ?, ?, ?)`,
            [msgId, user, timestamp, timestamp]);

        const msgObj = {
            id: msgId,
            user,
            text,
            replyTo,
            timestamp,
            readBy: [user],
            receivedBy: [user]
        };

        broadcastToGroup(groupId, {
            type: "new_message",
            groupId,
            message: msgObj
        });
      }
      else if (data.type === "received_message") {
          const { groupId, user, messageId } = data;
          await run(`INSERT OR IGNORE INTO message_receipts (message_id, username, received_at) VALUES (?, ?, ?)`,
              [messageId, user, Date.now()]);

          broadcastToGroup(groupId, {
              type: "delivery_update",
              groupId,
              user,
              receivedBy: user,
              messageId // Frontend needs to know which message
          });
      }
      else if (data.type === "read_message") {
        const { groupId, user } = data;

        // Mark all messages in group as read by user? Or specific?
        // Usually "read_message" event means "I opened the chat".
        // Update all unread messages for this user in this group

        // Get unread messages
        const unreadMsgs = await all(`
             SELECT m.id FROM messages m
             LEFT JOIN message_receipts mr ON m.id = mr.message_id AND mr.username = ?
             WHERE m.group_id = ? AND m.type != 'system' AND mr.read_at IS NULL
        `, [user, groupId]);

        for (const m of unreadMsgs) {
            // Upsert receipt
             const existing = await get(`SELECT * FROM message_receipts WHERE message_id = ? AND username = ?`, [m.id, user]);
             const now = Date.now();
             if (existing) {
                 await run(`UPDATE message_receipts SET read_at = ? WHERE message_id = ? AND username = ?`, [now, m.id, user]);
             } else {
                 await run(`INSERT INTO message_receipts (message_id, username, received_at, read_at) VALUES (?, ?, ?, ?)`,
                     [m.id, user, now, now]);
             }
        }

        // Broadcast read update for all these messages? Or just a generic "User X read everything up to now"?
        // Existing frontend expects "read_update" which updates a list or singular.
        // Let's broadcast read_update for the user

         broadcastToGroup(groupId, {
            type: "read_update",
            groupId,
            user,
            readBy: user
        });
      }
    } catch (e) {
      console.error("WS Error:", e);
    }
  });

  ws.on("close", async () => {
    if (currentUser) {
      const user = await get(`SELECT invisible FROM users WHERE username = ?`, [currentUser]);
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
