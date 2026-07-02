const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  // Accept JWT from Authorization header OR ?token=... query for image/print loads.
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.query && req.query.token) token = req.query.token;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};
