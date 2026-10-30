const User = require('../models/User');

/**
 * Enforces admin authorization.
 * Must be preceded by the `protect` middleware which sets `req.userId`.
 */
async function adminOnly(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await User.findById(req.userId).select('role name email');
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Administrator privileges required' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Authorization error', error: err.message });
  }
}

module.exports = adminOnly;
