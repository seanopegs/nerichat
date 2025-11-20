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
    groups: []
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

// Update Settings
app.post("/api/user/settings", (req, res) => {
  const { username, displayName, avatar, theme, password } = req.body;
  const filepath = getUserFilePath(username);
  const user = readJSON(filepath);

  if (!user) return res.status(404).json({ error: "User not found" });

  if (displayName) user.displayName = displayName;
  if (avatar) user.avatar = avatar;
  if (theme) user.theme = theme;
  if (password) user.password = password; // Allow password change

  writeJSON(filepath, user);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// Create Group
app.post("/api/groups", (req, res) => {
  const { name, creator } = req.body;
  if (!name || !creator) return res.status(400).json({ error: "Name and creator required" });

  const groupId = crypto.randomUUID();
  const newGroup = {
    id: groupId,
    name,
    members: [creator],
    messages: []
  };

  // Save group
  writeJSON(getGroupFilePath(groupId), newGroup);

  // Update creator's group list
  const userPath = getUserFilePath(creator);
  const user = readJSON(userPath);
  if (user) {
    if (!user.groups) user.groups = [];
    user.groups.push(groupId);
    writeJSON(userPath, user);
  }

  res.json({ success: true, group: newGroup });
});

// Join Group (Simplified: Just requires knowing the ID)
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
      if (g) groups.push({ id: g.id, name: g.name });
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

        // Validate
        if (!groupId || !text || !user) return;

        const groupPath = getGroupFilePath(groupId);
        const group = readJSON(groupPath);

        if (group) {
          const msgObj = {
            id: crypto.randomUUID(),
            user,
            text,
            timestamp: Date.now()
          };
          group.messages.push(msgObj);
          writeJSON(groupPath, group);

          // Broadcast to all members who are connected
          const broadcastData = JSON.stringify({
            type: "new_message",
            groupId,
            message: msgObj
          });

          // Simple broadcast to everyone, client filters.
          // Optimization: Only send to members.
          group.members.forEach(member => {
            const memberWs = clients.get(member);
            if (memberWs && memberWs.readyState === WebSocket.OPEN) {
              memberWs.send(broadcastData);
            }
          });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
