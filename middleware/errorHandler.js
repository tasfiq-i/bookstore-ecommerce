const ApiResponse = require('../utils/apiResponse');

// Custom error class for controlled throws
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Catch-all for undefined routes
const notFound = (req, res, next) => {
  const error = new AppError(`Route not found: ${req.originalUrl}`, 404);
  next(error);
};

// Global error handling middleware (must be last in middleware chain)
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log full error server-side
  console.error(`❌ [${req.method}] ${req.originalUrl} -`, err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error.message = `Resource not found. Invalid ${err.path}: ${err.value}`;
    error.statusCode = 404;
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `Duplicate value for field "${field}": "${err.keyValue[field]}" already exists`;
    error.statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    error.message = messages.join('. ');
    error.statusCode = 400;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid authentication token. Please log in again.';
    error.statusCode = 401;
  }
  if (err.name === 'TokenExpiredError') {
    error.message = 'Your session has expired. Please log in again.';
    error.statusCode = 401;
  }

  // Multer file upload errors
  if (err.name === 'MulterError') {
    error.message = `File upload error: ${err.message}`;
    error.statusCode = 400;
  }

  return ApiResponse.error(
    res,
    error.statusCode || 500,
    error.message || 'Internal Server Error',
    process.env.NODE_ENV === 'development' ? { stack: err.stack } : null
  );
};

module.exports = { AppError, notFound, errorHandler };