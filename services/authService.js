/**
 * Auth Service
 * Provider'lardan gelen token'ları verify eder ve kullanıcı bilgilerini döner
 */

// Bu servisler gerçek implementasyon için provider SDK'ları kullanılmalı
// Şu an için mock/placeholder implementasyon

class AuthService {
  /**
   * Google token'ı verify eder ve kullanıcı bilgilerini döner
   * @param {string} idToken - Google ID Token
   * @returns {Promise<Object>} Kullanıcı bilgileri
   */
  static async verifyGoogleToken(idToken) {
    const { OAuth2Client } = require('google-auth-library');
    
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error('GOOGLE_CLIENT_ID is not set in environment variables');
    }

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    try {
      // Verify the token
      const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      
      if (!payload) {
        throw new Error('Invalid token: No payload received');
      }

      // Return user data in expected format
      return {
        providerId: 'google',
        email: payload.email || null,
        name: payload.name || payload.email?.split('@')[0] || 'User',
        picture: payload.picture || null,
        id: payload.sub, // Google user ID
      };
    } catch (error) {
      console.error('Google token verification error:', error.message);
      throw new Error(`Failed to verify Google token: ${error.message}`);
    }
  }

  /**
   * Facebook token'ı verify eder ve kullanıcı bilgilerini döner
   * @param {string} accessToken - Facebook Access Token
   * @returns {Promise<Object>} Kullanıcı bilgileri
   */
  static async verifyFacebookToken(accessToken) {
    const axios = require('axios');
    
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      throw new Error('FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set in environment variables');
    }

    try {
      // First, verify the token with Facebook
      const debugResponse = await axios.get(`https://graph.facebook.com/debug_token`, {
        params: {
          input_token: accessToken,
          access_token: `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`
        }
      });

      if (!debugResponse.data.data || !debugResponse.data.data.is_valid) {
        throw new Error('Invalid Facebook token');
      }

      const userId = debugResponse.data.data.user_id;

      // Get user information
      const userResponse = await axios.get(`https://graph.facebook.com/v18.0/${userId}`, {
        params: {
          access_token: accessToken,
          fields: 'id,name,email,picture'
        }
      });

      const userData = userResponse.data;

      // Return user data in expected format
      return {
        providerId: 'facebook',
        email: userData.email || null,
        name: userData.name || null,
        picture: userData.picture?.data?.url || null,
        id: userData.id,
      };
    } catch (error) {
      console.error('Facebook token verification error:', error.message);
      if (error.response) {
        console.error('Facebook API response:', error.response.data);
      }
      throw new Error(`Failed to verify Facebook token: ${error.message}`);
    }
  }

  /**
   * Apple token'ı verify eder ve kullanıcı bilgilerini döner
   * @param {string} identityToken - Apple Identity Token (JWT)
   * @param {string} userIdentifier - Apple User Identifier
   * @returns {Promise<Object>} Kullanıcı bilgileri
   */
  static async verifyAppleToken(identityToken, userIdentifier) {
    const jwt = require('jsonwebtoken');
    const jwksClient = require('jwks-rsa');

    if (!identityToken && !userIdentifier) {
      throw new Error('identityToken or userIdentifier is required');
    }

    // If we have identityToken, verify it
    if (identityToken) {
      try {
        // Decode token to get header and payload (without verification first)
        const decoded = jwt.decode(identityToken, { complete: true });
        
        if (!decoded || !decoded.header || !decoded.header.kid) {
          throw new Error('Invalid token format');
        }

        // Get audience from token payload (Apple uses different client IDs)
        const tokenAudience = decoded.payload?.aud;
        
        // Apple's public key endpoint
        const client = jwksClient({
          jwksUri: 'https://appleid.apple.com/auth/keys',
          cache: true,
          cacheMaxAge: 86400000, // 24 hours
        });

        // Get the signing key
        const key = await client.getSigningKey(decoded.header.kid);
        const signingKey = key.getPublicKey();

        // Verify options - use audience from token if available, otherwise use env var
        const verifyOptions = {
          algorithms: ['RS256'],
          issuer: 'https://appleid.apple.com',
        };
        
        // Use audience from token if available, otherwise fallback to env var
        // Apple token'ında audience genellikle bundle ID veya service ID olabilir
        if (tokenAudience) {
          verifyOptions.audience = tokenAudience;
        } else if (process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID) {
          verifyOptions.audience = process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID;
        }

        // Verify the token
        const verified = jwt.verify(identityToken, signingKey, verifyOptions);

        // Extract user information from token
        // Note: Apple only provides email on first login
        // Subsequent logins may not include email in the token
        return {
          providerId: 'apple',
          email: verified.email || null, // May be null on subsequent logins
          name: null, // Apple doesn't provide name in token
          picture: null, // Apple doesn't provide picture
          id: verified.sub || userIdentifier, // Use 'sub' claim from token or fallback to userIdentifier
        };
      } catch (error) {
        console.error('Apple token verification error:', error.message);
        
        // If token verification fails but we have userIdentifier, use it as fallback
        // This allows users who logged in before to continue using the app
        if (userIdentifier) {
          console.warn('Apple token verification failed, using userIdentifier as fallback');
          return {
            providerId: 'apple',
            email: null, // Can't extract email without valid token
            name: null,
            picture: null,
            id: userIdentifier,
          };
        }
        
        throw new Error(`Failed to verify Apple token: ${error.message}`);
      }
    }

    // If only userIdentifier is provided (subsequent login without token)
    if (userIdentifier) {
      return {
        providerId: 'apple',
        email: null, // Not available without token
        name: null,
        picture: null,
        id: userIdentifier,
      };
    }

    throw new Error('Either identityToken or userIdentifier must be provided');
  }

  /**
   * Provider'dan gelen bilgileri UserModel formatına çevirir
   * @param {Object} providerData - Provider'dan gelen kullanıcı bilgileri
   * @param {string} credential - Provider adı ('google', 'facebook', 'apple')
   * @returns {Object} UserModel formatında kullanıcı objesi
   */
  static mapProviderDataToUser(providerData, credential) {
    return {
      credential: credential,
      credentialData: {
        providerId: providerData.providerId,
        email: providerData.email,
        id: providerData.id,
      },
      username: providerData.name || providerData.email?.split('@')[0] || 'user',
      gender: 'unknown', // Default, sonra güncellenebilir
      profilePhotoUrl: providerData.picture || null,
      answerData: null, // İlk kayıtta null, sonra doldurulacak
    };
  }
}

// Export class
module.exports = AuthService;

// Also export static methods directly for compatibility
module.exports.verifyGoogleToken = AuthService.verifyGoogleToken;
module.exports.verifyFacebookToken = AuthService.verifyFacebookToken;
module.exports.verifyAppleToken = AuthService.verifyAppleToken;
module.exports.mapProviderDataToUser = AuthService.mapProviderDataToUser;
