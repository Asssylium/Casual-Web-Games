const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const express = require("express");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const authRoutes = require("./routes/auth");

const app = express();
const sessionSecret = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required");
}
if (isProduction && (sessionSecret === "secretkey" || sessionSecret.length < 32)) {
  throw new Error("Set SESSION_SECRET to a random value of at least 32 characters in production");
}

if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb", type: "application/json" }));

const sessionMiddleware = session({
  name: "casual.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: "sessions",
    touchAfter: 24 * 60 * 60,
  }),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
  },
});
app.use(sessionMiddleware);

app.use("/api/auth", authRoutes);

const frontendDirectory = path.join(__dirname, "..", "dist");
const frontendEntry = path.join(frontendDirectory, "index.html");
app.use(express.static(frontendDirectory));
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    req.accepts("html") &&
    !req.path.startsWith("/api/") &&
    fs.existsSync(frontendEntry)
  ) {
    return res.sendFile(frontendEntry, (error) => {
      if (error) next(error);
    });
  }
  return next();
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON" });
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  if (error.code === 11000) {
    return res.status(409).json({
      error: "That username or email is already registered",
    });
  }

  console.error("Request failed:", error);
  return res.status(500).json({ error: "Internal server error" });
});

module.exports = { app, sessionMiddleware };