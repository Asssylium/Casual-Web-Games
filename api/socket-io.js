const http = require("http");
const { app } = require("../server/app");
const attachSocketServer = require("../server/socket");

const server = http.createServer(app);
attachSocketServer(server);

module.exports = server;