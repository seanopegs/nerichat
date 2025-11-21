const fs = require('fs');
const path = require('path');
const { initDB, run, get, all } = require('./database');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');

async function migrate() {
    console.log("Starting migration check...");

    await initDB();

    if (!fs.existsSync(USERS_DIR) || !fs.existsSync(GROUPS_DIR)) {
        console.log("No data directories found. Skipping migration.");
        return;
    }

    // Check if migration is needed?
    // User said "pas run bila masi ada data json" -> "if run when there is still json data"
    // We can just process them. INSERT OR IGNORE handles duplicates.
    // Ideally we should move them to a 'backup' folder after migration, or just rename them.
    // Or if we want to keep them as backup but not process again?
    // If we don't move/rename, we will re-read them every time.
    // re-reading 13 files is fast. But if thousands...
    // Let's try to detect if we should migrate.

    // Simplest approach: Process all files. If they exist in DB, skip/ignore.

    // Migrate Users
    const userFiles = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    if (userFiles.length > 0) {
        console.log(`Found ${userFiles.length} user JSON files.`);

        for (const file of userFiles) {
            try {
                const raw = fs.readFileSync(path.join(USERS_DIR, file), 'utf8');
                const user = JSON.parse(raw);

                // Insert User
                await run(`INSERT OR IGNORE INTO users (username, password, display_name, avatar, theme, invisible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [user.username, user.password, user.displayName, user.avatar, user.theme, user.invisible ? 1 : 0, Date.now()]);

                // Friends & Requests
                if (user.friends) {
                    for (const friend of user.friends) {
                        const existing = await get(`SELECT * FROM friend_requests WHERE requester = ? AND target = ?`, [user.username, friend]);
                        if (!existing) {
                            await run(`INSERT INTO friend_requests (requester, target, status, timestamp) VALUES (?, ?, 'accepted', ?)`,
                                [user.username, friend, Date.now()]);
                        }
                    }
                }

                if (user.friendRequests) {
                    for (const req of user.friendRequests) {
                         const existing = await get(`SELECT * FROM friend_requests WHERE requester = ? AND target = ?`, [req.from, user.username]);
                         if (!existing) {
                             await run(`INSERT INTO friend_requests (requester, target, status, timestamp) VALUES (?, ?, 'pending', ?)`,
                                 [req.from, user.username, req.timestamp || Date.now()]);
                         }
                    }
                }

                // Pinned Chats
                if (user.pinned_chats) {
                    for (const pid of user.pinned_chats) {
                         await run(`INSERT OR IGNORE INTO pinned_chats (username, group_id) VALUES (?, ?)`, [user.username, pid]);
                    }
                }

            } catch (e) {
                console.error(`Error migrating user ${file}:`, e);
            }
        }
    }

    // Migrate Groups
    const groupFiles = fs.readdirSync(GROUPS_DIR).filter(f => f.endsWith('.json'));
    if (groupFiles.length > 0) {
        console.log(`Found ${groupFiles.length} group JSON files.`);

        for (const file of groupFiles) {
            try {
                const raw = fs.readFileSync(path.join(GROUPS_DIR, file), 'utf8');
                const group = JSON.parse(raw);

                // Insert Group
                await run(`INSERT OR IGNORE INTO groups (id, name, type, owner, invite_permission, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [group.id, group.name, group.type, group.owner, group.invite_permission || 'admin', group.avatar, Date.now()]);

                // Members & Admins
                if (group.members) {
                    for (const member of group.members) {
                        const isAdmin = (group.admins && group.admins.includes(member)) ? 1 : 0;
                        await run(`INSERT OR IGNORE INTO group_members (group_id, username, is_admin, joined_at) VALUES (?, ?, ?, ?)`,
                            [group.id, member, isAdmin, Date.now()]);
                    }
                }

                // Muted
                if (group.muted) {
                    for (const [username, until] of Object.entries(group.muted)) {
                        await run(`INSERT OR IGNORE INTO muted_members (group_id, username, muted_until) VALUES (?, ?, ?)`,
                            [group.id, username, until]);
                    }
                }

                // Messages
                if (group.messages) {
                    for (const msg of group.messages) {
                        if (msg.type === 'system') {
                             await run(`INSERT OR IGNORE INTO messages (id, group_id, sender_username, content, type, reply_to, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [msg.id, group.id, 'system', msg.text, 'system', null, msg.timestamp]);
                        } else {
                             await run(`INSERT OR IGNORE INTO messages (id, group_id, sender_username, content, type, reply_to, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [msg.id, group.id, msg.user, msg.text, 'text', msg.replyTo || null, msg.timestamp]);
                        }

                        // Receipts
                        if (msg.receivedBy) {
                            for (const u of msg.receivedBy) {
                                 await run(`INSERT OR IGNORE INTO message_receipts (message_id, username, received_at) VALUES (?, ?, ?)`,
                                    [msg.id, u, Date.now()]);
                            }
                        }
                         if (msg.readBy) {
                            for (const u of msg.readBy) {
                                 const existing = await get(`SELECT * FROM message_receipts WHERE message_id = ? AND username = ?`, [msg.id, u]);
                                 if (existing) {
                                     await run(`UPDATE message_receipts SET read_at = ? WHERE message_id = ? AND username = ?`, [Date.now(), msg.id, u]);
                                 } else {
                                     await run(`INSERT INTO message_receipts (message_id, username, received_at, read_at) VALUES (?, ?, ?, ?)`,
                                         [msg.id, u, Date.now(), Date.now()]);
                                 }
                            }
                        }
                    }
                }

            } catch (e) {
                console.error(`Error migrating group ${file}:`, e);
            }
        }
    }

    console.log("Migration check complete.");
}

// Allow running directly or importing
if (require.main === module) {
    migrate().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
} else {
    module.exports = { migrate };
}
