const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('./errorHandler');

// Protect routes: verifies JWT and attaches req.user
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return next(new AppError('Not authorized. Please log in to access this resource.', 401));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    if (!currentUser.isActive) {
      return next(new AppError('This account has been deactivated. Contact support.', 403));
    }

    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return next(new AppError('Password was recently changed. Please log in again.', 401));
    }

    req.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Not authorized. Please log in.', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(`Access denied. Role "${req.user.role}" is not permitted for this action.`, 403)
      );
    }
    next();
  };
};

// Optional auth: attaches req.user if token present, but doesn't block guests
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const currentUser = await User.findById(decoded.id);
    req.user = currentUser && currentUser.isActive ? currentUser : null;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

module.exports = { protect, authorize, optionalAuth };