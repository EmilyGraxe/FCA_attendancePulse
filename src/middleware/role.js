// Accept a single role or an array of roles
module.exports = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role))
      return res.status(403).json({ message: "Forbidden" });
    next();
  };
};
