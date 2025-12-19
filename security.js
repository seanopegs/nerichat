const crypto = require("crypto");

// --- Password Hashing ---
const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(SALT_LEN).toString("hex");
        crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
            if (err) reject(err);
            resolve(`${salt}:${derivedKey.toString("hex")}`);
        });
    });
}

function verifyPassword(password, storedHash) {
    return new Promise((resolve, reject) => {
        const [salt, key] = storedHash.split(":");
        if (!salt || !key) {
             // Not a valid hash format (likely legacy plaintext)
             return resolve(false);
        }
        crypto.scrypt(password, salt, KEY_LEN, (err, derivedKey) => {
            if (err) reject(err);
            resolve(key === derivedKey.toString("hex"));
        });
    });
}

function isHashed(password) {
    return password && password.includes(":") && password.length > 20;
}


// --- Session Management ---
// In-memory store: sessionId -> { username, expiresAt }
const sessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function createSession(username) {
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_DURATION;
    sessions.set(sessionId, { username, expiresAt });
    return { sessionId, expiresAt };
}

function getSessionUser(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(sessionId);
        return null;
    }
    return session.username;
}

function destroySession(sessionId) {
    sessions.delete(sessionId);
}


// --- Rate Limiting ---
// In-memory store: ip -> { count, startTime }
const limits = new Map();

function rateLimiter(req, res, next, limitCount, windowMs) {
    // Basic IP extraction
    const ip = req.ip || req.connection.remoteAddress;

    if (!limits.has(ip)) {
        limits.set(ip, { count: 1, startTime: Date.now() });
        return next();
    }

    const record = limits.get(ip);
    const now = Date.now();

    if (now - record.startTime > windowMs) {
        // Reset window
        record.count = 1;
        record.startTime = now;
        return next();
    }

    if (record.count >= limitCount) {
        return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    record.count++;
    next();
}

// Wrapper for easier use in routes
const authLimiter = (req, res, next) => rateLimiter(req, res, next, 10, 60 * 1000); // 10 req / min
const apiLimiter = (req, res, next) => rateLimiter(req, res, next, 100, 60 * 1000); // 100 req / min


module.exports = {
    hashPassword,
    verifyPassword,
    isHashed,
    createSession,
    getSessionUser,
    destroySession,
    authLimiter,
    apiLimiter
};
