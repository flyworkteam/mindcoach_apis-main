/**
 * Auth Request Models
 * Her provider için gelen request'leri validate etmek için kullanılır
 */

class GoogleAuthRequest {
  constructor(data) {
    this.idToken = data.idToken; // Google ID Token
    this.accessToken = data.accessToken; // OAuth access token (optional)
  }

  validate() {
    if (!this.idToken) {
      throw new Error('Google idToken is required');
    }
    return true;
  }
}

class FacebookAuthRequest {
  constructor(data) {
    this.accessToken = data.accessToken; // Facebook access token
    this.userID = data.userID; // Facebook user ID (optional, can be extracted from token)
  }

  validate() {
    if (!this.accessToken) {
      throw new Error('Facebook accessToken is required');
    }
    return true;
  }
}

class AppleAuthRequest {
  constructor(data) {
    this.identityToken = data.identityToken; // Apple identity token (JWT)
    this.authorizationCode = data.authorizationCode; // Apple authorization code (optional)
    this.userIdentifier = data.userIdentifier; // Apple user identifier
  }

  validate() {
    if (!this.identityToken && !this.userIdentifier) {
      throw new Error('Apple identityToken or userIdentifier is required');
    }
    return true;
  }
}

module.exports = {
  GoogleAuthRequest,
  FacebookAuthRequest,
  AppleAuthRequest,
};

