const connectDatabase = require("../server/config/database");
const { app } = require("../server/app");

module.exports = async function apiHandler(req, res) {
  try {
    const route = Array.isArray(req.query.route)
      ? req.query.route.join("/")
      : req.query.route;

    if (typeof route !== "string" || !route) {
      return res.status(404).json({ error: "Not found" });
    }

    const requestUrl = new URL(req.url, "http://vercel.local");
    requestUrl.searchParams.delete("route");
    req.url = `/api/${route}${requestUrl.search}`;

    await connectDatabase();
    return app(req, res);
  } catch (error) {
    console.error("API request failed:", error);
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
};