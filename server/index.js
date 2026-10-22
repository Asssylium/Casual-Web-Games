const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const connectDatabase = require("./config/database");
const { app } = require("./app");

const port = Number(process.env.PORT || 5000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

async function start() {
  await connectDatabase();
  const server = http.createServer(app);

  server.listen(port, () => {
    console.log(`Casual Game Portal listening on port ${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
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
