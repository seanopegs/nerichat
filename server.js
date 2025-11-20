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

// --- API Routes ---

// Register
app.post("/api/register", (req, res) => {
  const { username, password, displayName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  // Sanitize username (alphanumeric + underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "Username must be alphanumeric" });
  }

  const filepath = getUserFilePath(username);
  if (fs.existsSync(filepath)) {
    return res.status(409).json({ error: "Username already exists" });
  }

  const newUser = {
    username,
    password, // In a real app, hash this!
    displayName: displayName || username,
    avatar: "https://ui-avatars.com/api/?name=" + encodeURIComponent(displayName || username),
    theme: "light",
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
      theme: user.theme
    }
  });
});

// Get User Data
app.get("/api/user/:username", (req, res) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: "Invalid username" });

  const user = readJSON(getUserFilePath(username));
  if (!user) return res.status(404).json({ error: "User not found" });

  // Don't send password
  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// Search Users (for adding friends)
app.get("/api/users/search", (req, res) => {
  const { query } = req.query;
  if (!query) return res.json({ users: [] });

  // NOTE: In a real DB this would be efficient. Here we scan files. Not scalable but fits requirement.
  // We'll just check if a user with that exact username exists for now.
  // Or we can list all files if not too many. Let's exact match for now.

  const user = readJSON(getUserFilePath(query));
  if (user) {
      return res.json({ users: [{ username: user.username, displayName: user.displayName, avatar: user.avatar }] });
  }
  res.json({ users: [] });
});


// Update Settings
app.post("/api/user/settings", (req, res) => {
  const { username, displayName, avatar, theme, password } = req.body;
  const filepath = getUserFilePath(username);
  const user = readJSON(filepath);

  if (!user) return res.status(404).json({ error: "User not found" });

  if (displayName) user.displayName = displayName;

  // Avatar logic: if empty string passed, reset to default
  if (avatar !== undefined) {
     if (avatar === "") {
        user.avatar = "https://ui-avatars.com/api/?name=" + encodeURIComponent(user.displayName);
     } else {
        user.avatar = avatar;
     }
  }

  if (theme) user.theme = theme;
  if (password) user.password = password;

  writeJSON(filepath, user);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// --- Friend Routes ---

app.get("/api/friends", (req, res) => {
    const { username } = req.query;
    const user = readJSON(getUserFilePath(username));
    if (!user) return res.status(404).json({ error: "User not found" });

    // Populate friends details
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

    // Initialize arrays if missing
    if (!toUser.friendRequests) toUser.friendRequests = [];
    if (!toUser.friends) toUser.friends = [];
    if (!fromUser.friends) fromUser.friends = [];

    // Check if already friends
    if (toUser.friends.includes(from)) return res.status(400).json({ error: "Already friends" });
    // Check if already requested
    if (toUser.friendRequests.find(r => r.from === from)) return res.status(400).json({ error: "Request already sent" });

    toUser.friendRequests.push({ from, timestamp: Date.now() });
    writeJSON(getUserFilePath(to), toUser);

    res.json({ success: true });
});

app.post("/api/friends/respond", (req, res) => {
    const { user, from, action } = req.body; // user = who is responding (me), from = who sent request
    const myUserPath = getUserFilePath(user);
    const myUser = readJSON(myUserPath);
    const otherUserPath = getUserFilePath(from);
    const otherUser = readJSON(otherUserPath);

    if (!myUser || !otherUser) return res.status(404).json({ error: "User not found" });

    // Remove request
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

// Create Group / Start DM
app.post("/api/groups", (req, res) => {
  const { name, creator, members, type } = req.body; // members is optional array of usernames, type='dm' or 'group'
  if (!creator) return res.status(400).json({ error: "Creator required" });

  // For DM: Check if exists
  if (type === 'dm' && members && members.length === 1) {
      // Search for existing DM between creator and members[0]
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
    members: [...new Set(initialMembers)], // unique
    messages: []
  };

  writeJSON(getGroupFilePath(groupId), newGroup);

  // Update all members
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

// Join Group
app.post("/api/groups/join", (req, res) => {
  const { groupId, username } = req.body;
  const groupPath = getGroupFilePath(groupId);
  const group = readJSON(groupPath);
  const userPath = getUserFilePath(username);
  const user = readJSON(userPath);

  if (!group || !user) return res.status(404).json({ error: "Group or user not found" });

  if (!group.members.includes(username)) {
    group.members.push(username);
    writeJSON(groupPath, group);
  }

  if (!user.groups.includes(groupId)) {
    user.groups.push(groupId);
    writeJSON(userPath, user);
  }

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
          // If DM, format name
          let name = g.name;
          if (g.type === 'dm') {
              const other = g.members.find(m => m !== username) || "Unknown";
              name = other; // DM name is the other person
          }
          groups.push({ id: g.id, name: name, type: g.type });
      }
    }
  }
  res.json({ groups });
});

// Get Group Messages
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
      }
      else if (data.type === "message") {
        const { groupId, text, user } = data;

        if (!groupId || !text || !user) return;

        const groupPath = getGroupFilePath(groupId);
        const group = readJSON(groupPath);

        if (group) {
          const msgObj = {
            id: crypto.randomUUID(),
            user,
            text,
            timestamp: Date.now(),
            readBy: [user] // sender has read it
          };
          group.messages.push(msgObj);
          writeJSON(groupPath, group);

          const broadcastData = JSON.stringify({
            type: "new_message",
            groupId,
            message: msgObj
          });

          group.members.forEach(member => {
            const memberWs = clients.get(member);
            if (memberWs && memberWs.readyState === WebSocket.OPEN) {
              memberWs.send(broadcastData);
            }
          });
        }
      }
      else if (data.type === "read_message") {
        const { groupId, user } = data;
        // Mark all messages in group as read by user
        // Optimization: client should send specific message IDs, but usually "opening chat" reads all.
        // For simplicity, let's mark all messages in the group as read by this user.

        const groupPath = getGroupFilePath(groupId);
        const group = readJSON(groupPath);

        if (group) {
            let changed = false;
            group.messages.forEach(msg => {
                if (!msg.readBy) msg.readBy = [];
                if (!msg.readBy.includes(user)) {
                    msg.readBy.push(user);
                    changed = true;
                }
            });

            if (changed) {
                writeJSON(groupPath, group);
                // Broadcast read update
                 const broadcastData = JSON.stringify({
                    type: "read_update",
                    groupId,
                    user,
                    readBy: user // inform others that this user read messages
                });

                group.members.forEach(member => {
                    const memberWs = clients.get(member);
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(broadcastData);
                    }
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
      clients.delete(currentUser);
      console.log(`WS: User ${currentUser} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 25577;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
