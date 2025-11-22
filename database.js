const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'chat.db');

let db;

function initDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            return resolve(db);
        }

        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
            } else {
                console.log('Connected to the SQLite database.');
                initSchema().then(() => resolve(db)).catch(reject);
            }
        });
    });
}

function initSchema() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            try {
                // Users
                db.run(`CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password TEXT,
                    display_name TEXT,
                    avatar TEXT,
                    theme TEXT DEFAULT 'light',
                    invisible INTEGER DEFAULT 0,
                    created_at INTEGER
                )`);

                // Groups
                db.run(`CREATE TABLE IF NOT EXISTS groups (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    owner TEXT,
                    invite_permission TEXT DEFAULT 'admin',
                    avatar TEXT,
                    created_at INTEGER,
                    FOREIGN KEY(owner) REFERENCES users(username)
                )`);

                // Group Members
                db.run(`CREATE TABLE IF NOT EXISTS group_members (
                    group_id TEXT,
                    username TEXT,
                    is_admin INTEGER DEFAULT 0,
                    joined_at INTEGER,
                    PRIMARY KEY (group_id, username),
                    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
                    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
                )`);

                // Messages
                db.run(`CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    group_id TEXT,
                    sender_username TEXT,
                    content TEXT,
                    type TEXT,
                    reply_to TEXT,
                    timestamp INTEGER,
                    is_edited INTEGER DEFAULT 0,
                    is_deleted INTEGER DEFAULT 0,
                    attachment_url TEXT,
                    attachment_type TEXT,
                    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
                )`);

                // Indices for fast message retrieval
                db.run(`CREATE INDEX IF NOT EXISTS idx_messages_group_timestamp ON messages(group_id, timestamp)`);

                // Message Receipts (Read/Received)
                db.run(`CREATE TABLE IF NOT EXISTS message_receipts (
                    message_id TEXT,
                    username TEXT,
                    received_at INTEGER,
                    read_at INTEGER,
                    PRIMARY KEY (message_id, username),
                    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
                )`);

                // Friends / Friend Requests
                db.run(`CREATE TABLE IF NOT EXISTS friend_requests (
                    requester TEXT,
                    target TEXT,
                    status TEXT, -- 'pending', 'accepted'
                    timestamp INTEGER,
                    PRIMARY KEY (requester, target),
                    FOREIGN KEY(requester) REFERENCES users(username),
                    FOREIGN KEY(target) REFERENCES users(username)
                )`);

                // Muted Members
                db.run(`CREATE TABLE IF NOT EXISTS muted_members (
                    group_id TEXT,
                    username TEXT,
                    muted_until INTEGER,
                    PRIMARY KEY (group_id, username),
                    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
                )`);

                // Pinned Chats
                db.run(`CREATE TABLE IF NOT EXISTS pinned_chats (
                    username TEXT,
                    group_id TEXT,
                    PRIMARY KEY (username, group_id),
                    FOREIGN KEY(username) REFERENCES users(username)
                )`);

                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Helper wrapper for async/await
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized"));
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized"));
        db.get(sql, params, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized"));
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function updateSchema() {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized"));
        console.log("Updating schema...");
        db.serialize(() => {
            const columns = [
                "ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0",
                "ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0",
                "ALTER TABLE messages ADD COLUMN attachment_url TEXT",
                "ALTER TABLE messages ADD COLUMN attachment_type TEXT"
            ];

            let completed = 0;
            columns.forEach(sql => {
                db.run(sql, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                         console.warn(`Schema update warning: ${err.message}`);
                    }
                    completed++;
                    if (completed === columns.length) {
                        console.log("Schema update complete.");
                        resolve();
                    }
                });
            });
        });
    });
}

module.exports = {
    initDB,
    updateSchema,
    run,
    get,
    all,
    getDb: () => db
};
