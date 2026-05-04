/**
 * Error Handler Middleware
 * Tüm hataları merkezi olarak yönetir
 */

const errorHandler = (err, req, res, next) => {
  // Check if response has already been sent
  // This prevents "Cannot set headers after they are sent to the client" errors
  if (res.headersSent) {
    console.error('⚠️ [ERROR-HANDLER] Response already sent, delegating to Express default error handler');
    return next(err);
  }

  console.error('❌ [ERROR-HANDLER] Error:', err);
  console.error('❌ [ERROR-HANDLER] Stack:', err.stack);

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: err.message || 'Validation error'
    });
  }

  // Authentication errors
  if (err.name === 'AuthenticationError') {
    return res.status(401).json({
      success: false,
      error: err.message || 'Authentication failed'
    });
  }

  // Database connection errors
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || 
      err.code === 'ECONNRESET' || 
      err.code === 'ETIMEDOUT' ||
      err.code === 'PROTOCOL_ENQUEUE_AFTER_QUIT') {
    console.error('❌ [ERROR-HANDLER] Database connection error:', err.code);
    return res.status(503).json({
      success: false,
      error: 'Database connection error. Please try again.'
    });
  }

  // Timeout errors
  if (err.code === 'ETIMEDOUT' || err.message && err.message.includes('timeout')) {
    return res.status(504).json({
      success: false,
      error: 'Request timeout. The operation took too long to complete.'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
};

module.exports = errorHandler;

