require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured in production.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Create a PostgreSQL database and set DATABASE_URL.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.json({ limit: "10kb" }));

const sessionStore = new PgSession({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true,
  pruneSessionInterval: 15 * 60
});

app.use(session({
  store: sessionStore,
  name: "clearview.sid",
  secret: process.env.SESSION_SECRET || "local-development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  maxAge: isProduction ? "1h" : 0
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function validEmail(email) {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function safeUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/register", authLimiter, asyncRoute(async (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (displayName.length < 2 || displayName.length > 60) {
    return res.status(400).json({ error: "Name must be between 2 and 60 characters." });
  }
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 72) {
    return res.status(400).json({ error: "Password must be 10–72 characters." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await pool.query(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at",
      [email, displayName, passwordHash]
    );
    const user = safeUser(result.rows[0]);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Could not start a secure session." });
      req.session.user = user;
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: "Account created, but sign-in failed. Please sign in." });
        res.status(201).json({ user });
      });
    });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    throw err;
  }
}));

app.post("/api/login", authLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!validEmail(email) || !password || password.length > 72) {
    return res.status(400).json({ error: "Enter your email and password." });
  }

  const result = await pool.query(
    "SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = $1",
    [email]
  );
  const row = result.rows[0];
  const matches = row ? await bcrypt.compare(password, row.password_hash) : false;
  if (!matches) return res.status(401).json({ error: "Email or password is incorrect." });

  const user = safeUser(row);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not start a secure session." });
    req.session.user = user;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "Could not save your session. Try again." });
      res.json({ user });
    });
  });
}));

app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("clearview.sid", {
      httpOnly: true, secure: isProduction, sameSite: "lax"
    });
    res.json({ ok: true });
  });
});

app.get("/api/dashboard", requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT created_at FROM users WHERE id = $1",
    [req.session.user.id]
  );
  if (!result.rows[0]) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Account not found. Please sign in again." });
  }
  res.json({
    stats: [
      { label: "Account status", value: "Active", detail: "Your account is ready" },
      { label: "Member since", value: new Date(result.rows[0].created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }), detail: "Your account creation date" },
      { label: "Security", value: "Protected", detail: "Password hashing and secure sessions" }
    ],
    activity: [
      { title: "Account created", detail: "Your profile is ready to use", time: new Date(result.rows[0].created_at).toLocaleDateString() },
      { title: "Secure sign-in enabled", detail: "Sessions are stored in PostgreSQL", time: "Enabled" },
      { title: "Dashboard initialized", detail: "Your workspace is ready", time: "Ready" }
    ]
  });
}));

app.get("/api/settings", requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query("SELECT preferences FROM user_settings WHERE user_id = $1", [req.session.user.id]);
  res.json({ preferences: result.rows[0]?.preferences || { emailNotifications: true, compactMode: false } });
}));

app.put("/api/settings", requireAuth, asyncRoute(async (req, res) => {
  const emailNotifications = req.body.emailNotifications;
  const compactMode = req.body.compactMode;
  if (typeof emailNotifications !== "boolean" || typeof compactMode !== "boolean") {
    return res.status(400).json({ error: "Settings values must be true or false." });
  }
  const preferences = { emailNotifications, compactMode };
  await pool.query(
    `INSERT INTO user_settings (user_id, preferences) VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = NOW()`,
    [req.session.user.id, JSON.stringify(preferences)]
  );
  res.json({ preferences });
}));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error("Request error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`Clearview dashboard listening on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
