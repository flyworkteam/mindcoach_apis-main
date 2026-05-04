/**
 * JWT Secret Key Generator
 * Bu script güvenli bir JWT secret key oluşturur
 * 
 * Kullanım: node scripts/generate-secret.js
 */

const crypto = require('crypto');

// 256 bit (32 byte) güvenli random key oluştur
const secret = crypto.randomBytes(32).toString('hex');

console.log('\n✅ JWT Secret Key oluşturuldu!\n');
console.log('Aşağıdaki key\'i .env dosyanıza ekleyin:\n');
console.log('JWT_SECRET=' + secret);
console.log('\n⚠️  ÖNEMLİ: Bu key\'i güvenli bir yerde saklayın ve asla public repository\'lere commit etmeyin!\n');

// Alternatif olarak base64 formatında
const secretBase64 = crypto.randomBytes(32).toString('base64');
console.log('Alternatif (Base64 formatında):');
console.log('JWT_SECRET=' + secretBase64);
console.log('\n');

