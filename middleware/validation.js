/**
 * Validation Middleware
 * Request validation için kullanılır
 */

const validateAuthRequest = (req, res, next) => {
  const { provider } = req.params;
  const { body } = req;

  if (!provider || !['google', 'facebook', 'apple', 'guest'].includes(provider)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid provider. Must be one of: google, facebook, apple, guest'
    });
  }

  // Provider'a göre validation
  try {
    switch (provider) {
      case 'google':
        if (!body.idToken) {
          return res.status(400).json({
            success: false,
            error: 'idToken is required for Google authentication'
          });
        }
        break;
      case 'facebook':
        if (!body.accessToken) {
          return res.status(400).json({
            success: false,
            error: 'accessToken is required for Facebook authentication'
          });
        }
        break;
      case 'apple':
        if (!body.identityToken && !body.userIdentifier) {
          return res.status(400).json({
            success: false,
            error: 'identityToken or userIdentifier is required for Apple authentication'
          });
        }
        break;
      case 'guest':
        // Guest login için body validation yok
        break;
    }
    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  validateAuthRequest,
};

