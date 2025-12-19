const { run, get } = require('./database');

async function migrateSecurity() {
    console.log("Running Security Migration...");

    // Check if column exists
    try {
        // SQLite doesn't have a simple "IF COLUMN EXISTS", so we check table info
        // But `ADD COLUMN IF NOT EXISTS` is supported in newer SQLite, but safer to check.
        // Or just try-catch the alter table.

        // Add avatar_original_name to users
        try {
            await run(`ALTER TABLE users ADD COLUMN avatar_original_name TEXT`);
            console.log("Added avatar_original_name to users table.");
        } catch (e) {
            // Likely already exists
            if (!e.message.includes('duplicate column')) {
                console.log("Column avatar_original_name might already exist or error: " + e.message);
            }
        }

    } catch (err) {
        console.error("Security Migration Failed:", err);
    }
}

module.exports = { migrateSecurity };
