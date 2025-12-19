const { all, run } = require("./database");
const { hashPassword, isHashed } = require("./security");

async function migratePasswords() {
    console.log("Starting Password Migration...");
    try {
        const users = await all("SELECT username, password FROM users");
        let count = 0;
        for (const user of users) {
            // Check if password is not hashed
            // My secure passwords look like "salt:key", which is 16*2 + 1 + 64*2 = 32 + 1 + 128 = 161 chars approx?
            // Actually scrypt keylen 64 bytes hex is 128 chars. salt 16 bytes hex is 32.
            // So total length is 32 + 1 + 128 = 161.
            // Plain text is likely much shorter.
            // Also we can check for the colon separator.
            if (!isHashed(user.password)) {
                const hashedPassword = await hashPassword(user.password);
                await run("UPDATE users SET password = ? WHERE username = ?", [hashedPassword, user.username]);
                count++;
            }
        }
        if (count > 0) {
            console.log(`Migrated ${count} users to secure passwords.`);
        } else {
            console.log("No legacy passwords found.");
        }
    } catch (err) {
        console.error("Migration failed:", err);
    }
}

module.exports = { migratePasswords };
