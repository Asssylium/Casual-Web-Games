const connectDatabase = require("../server/config/database");
const { app } = require("../server/app");

module.exports = async function apiHandler(req, res) {
  try {
    await connectDatabase();
    return app(req, res);
  } catch (error) {
    console.error("API request failed:", error);
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
};