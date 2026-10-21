const express = require("express");
const { rateLimit } = require("express-rate-limit");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const requireAuth = require("../middleware/auth");

const router = express.Router();
const googleClient = new OAuth2Client();
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many authentication attempts. Try again later." },
});

router.use(["/signup", "/login", "/google"], authAttemptLimiter);

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isValidEmail(email) {
  return typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return typeof password === "string" &&
    password.length >= 8 &&
    Buffer.byteLength(password, "utf8") <= 72;
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    stats: user.stats,
  };
}

function establishSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = userId;
      return resolve();
    });
  });
}

async function availableUsername(email) {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  const prefix = base.length >= 3 ? base : "player";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = attempt === 0 ? "" : `_${crypto.randomBytes(3).toString("hex")}`;
    const username = `${prefix.slice(0, 24 - suffix.length)}${suffix}`;
    if (!(await User.exists({ username }))) return username;
  }

  throw new Error("Could not create a unique username for this Google account");
}

router.get("/google/config", (req, res) => {
  return res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

router.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { credential } = req.body || {};
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId) {
      return res.status(503).json({ error: "Google authentication is not configured" });
    }
    if (typeof credential !== "string" || credential.length > 10_000) {
      return res.status(400).json({ error: "A valid Google credential is required" });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: "Google sign-in could not be verified" });
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: "Google must verify your email address" });
    }

    const email = payload.email.trim().toLowerCase();
    let user = await User.findOne({ googleId: payload.sub });

    if (!user) {
      user = await User.findOne({ email });
      if (user?.googleId && user.googleId !== payload.sub) {
        return res.status(409).json({
          error: "This email is already linked to another Google account",
        });
      }
      if (user) {
        user.googleId = payload.sub;
        await user.save();
      } else {
        user = await User.create({
          username: await availableUsername(email),
          email,
          googleId: payload.sub,
        });
      }
    }

    await establishSession(req, user._id.toString());
    return res.json({ user: publicUser(user) });
  })
);

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body || {};
    const normalizedUsername =
      typeof username === "string" ? username.trim() : "";
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (
      normalizedUsername.length < 3 ||
      normalizedUsername.length > 24 ||
      !/^[a-zA-Z0-9_-]+$/.test(normalizedUsername)
    ) {
      return res.status(400).json({
        error: "Username must be 3-24 characters using letters, numbers, _ or -",
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    })
      .select("_id")
      .lean();

    if (existingUser) {
      return res.status(409).json({
        error: "That username or email is already registered",
      });
    }

    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
    });

    await establishSession(req, user._id.toString());

    return res.status(201).json({ user: publicUser(user) });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body || {};

    if (
      typeof identifier !== "string" ||
      identifier.trim().length === 0 ||
      identifier.length > 254 ||
      typeof password !== "string" ||
      password.length === 0 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({ error: "Enter your username/email and password" });
    }

    const normalizedIdentifier = identifier.trim();
    const query = normalizedIdentifier.includes("@")
      ? { email: normalizedIdentifier.toLowerCase() }
      : { username: normalizedIdentifier };
    const user = await User.findOne(query).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid username/email or password" });
    }

    await establishSession(req, user._id.toString());

    return res.json({ user: publicUser(user) });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (!req.session) {
      return res.json({ message: "Logged out" });
    }

    await new Promise((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });
    res.clearCookie("casual.sid", { path: "/" });
    return res.json({ message: "Logged out" });
  })
);

router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({ authenticated: true, user: publicUser(req.user) });
  })
);

module.exports = router;
