const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { Server: SocketServer } = require("socket.io");
const connectDatabase = require("./config/database");
const User = require("./models/User");
const attachMemoryGame = require("./games/memory");
const { app, sessionMiddleware } = require("./app");

const port = Number(process.env.PORT || 5000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

async function start() {
  await connectDatabase();
  const server = http.createServer(app);
  const io = new SocketServer(server, {
    cors: process.env.CLIENT_ORIGIN
      ? { origin: process.env.CLIENT_ORIGIN, credentials: true }
      : undefined,
  });
  io.engine.use(sessionMiddleware);
  io.use(async (socket, next) => {
    try {
      const sessionUserId = socket.request.session?.userId;
      if (!sessionUserId) return next(new Error("Authentication required"));

      const user = await User.findById(sessionUserId).select("username").lean();
      if (!user) return next(new Error("Authentication required"));

      socket.data.user = { id: user._id.toString(), username: user.username };
      return next();
    } catch (error) {
      return next(error);
    }
  });
  attachMemoryGame(io);

  server.listen(port, () => {
    console.log(`Casual Game Portal listening on port ${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down`);
    io.close(async () => {
      try {
        await require("mongoose").disconnect();
      } catch (disconnectError) {
        console.error("MongoDB shutdown failed:", disconnectError);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("Server startup failed:", error);
  process.exitCode = 1;
});
