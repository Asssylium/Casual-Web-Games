const { Server: SocketServer } = require("socket.io");
const connectDatabase = require("./config/database");
const User = require("./models/User");
const attachMemoryGame = require("./games/memory");
const { sessionMiddleware } = require("./app");

function attachSocketServer(server) {
  const io = new SocketServer(server);
  io.engine.use((request, response, next) => {
    connectDatabase()
      .then(() => sessionMiddleware(request, response, next))
      .catch(next);
  });
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
  return io;
}

module.exports = attachSocketServer;