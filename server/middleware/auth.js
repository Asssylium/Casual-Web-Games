const User = require("../models/User");

module.exports = async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const user = await User.findById(req.session.userId)
      .select("username email stats")
      .lean();

    if (!user) {
      return req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("casual.sid", { path: "/" });
        return res.status(401).json({ error: "Authentication required" });
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};
