/**
 * Database Retry Utility with Circuit Breaker
 * Production-grade retry mechanism with circuit breaker protection
 * Prevents cascading failures and provides graceful degradation
 */

const pool = require('../config/database');
const { circuitBreakers } = require('../middleware/circuitBreaker');

/**
 * Execute a database query with retry mechanism and circuit breaker protection
 * @param {Function} queryFn - Function that returns a promise with the query result
 * @param {number} retries - Number of retries (default: 2)
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<any>} Query result
 */
async function executeWithRetry(queryFn, retries = 2, operationName = 'Database operation') {
  const dbCircuitBreaker = circuitBreakers.database;
  
  // Use circuit breaker to execute the query
  return await dbCircuitBreaker.execute(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await queryFn();
      } catch (error) {
        // Retry on connection errors
        const isRetryableError = 
          error.code === 'ECONNRESET' ||
          error.code === 'PROTOCOL_CONNECTION_LOST' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'PROTOCOL_ENQUEUE_AFTER_QUIT' ||
          (error.message && error.message.includes('Connection lost'));
        
        if (isRetryableError && attempt < retries) {
          const delay = Math.min(200 * (attempt + 1), 2000); // Exponential backoff, max 2 seconds
          console.warn(`⚠️ [DB-RETRY] ${operationName} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`, error.code || error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Last attempt or non-retryable error
        console.error(`❌ [DB-RETRY] ${operationName} failed after ${attempt + 1} attempts:`, error);
        throw error;
      }
    }
  }, async () => {
    // Fallback function when circuit breaker is open
    console.error(`🚨 [DB-RETRY] Circuit breaker is OPEN for ${operationName}, using fallback`);
    throw new Error(`Database service temporarily unavailable. Please try again later.`);
  });
}

/**
 * Execute a pool.execute query with retry
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @param {number} retries - Number of retries
 * @param {string} operationName - Name of the operation
 * @returns {Promise<Array>} Query result
 */
async function executeWithRetryQuery(sql, params = [], retries = 2, operationName = 'Query') {
  return executeWithRetry(
    () => pool.execute(sql, params),
    retries,
    operationName
  );
}

module.exports = {
  executeWithRetry,
  executeWithRetryQuery
};
