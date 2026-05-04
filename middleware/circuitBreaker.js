/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures and provides graceful degradation
 * For production-grade API handling millions of requests
 */

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5; // Open after 5 failures
    this.successThreshold = options.successThreshold || 2; // Half-open after 2 successes
    this.timeout = options.timeout || 60000; // 60 seconds timeout
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds before retry
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      stateChanges: []
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    this.stats.totalRequests++;
    
    // Check if circuit is open
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        // Circuit is still open, use fallback or throw error
        if (fallback) {
          return await fallback();
        }
        throw new Error(`Circuit breaker ${this.name} is OPEN. Please try again later.`);
      } else {
        // Time to try again - transition to HALF_OPEN
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        this.stats.stateChanges.push({
          from: 'OPEN',
          to: 'HALF_OPEN',
          timestamp: new Date().toISOString()
        });
        console.log(`🟡 [CIRCUIT-BREAKER] ${this.name} transitioned to HALF_OPEN`);
      }
    }
    
    try {
      // Execute the function with timeout
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
        )
      ]);
      
      // Success
      this.onSuccess();
      return result;
    } catch (error) {
      // Failure
      this.onFailure();
      if (fallback) {
        console.warn(`⚠️ [CIRCUIT-BREAKER] ${this.name} execution failed, using fallback:`, error.message);
        return await fallback();
      }
      throw error;
    }
  }

  onSuccess() {
    this.stats.totalSuccesses++;
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        // Circuit recovered - transition to CLOSED
        this.state = 'CLOSED';
        this.successCount = 0;
        this.stats.stateChanges.push({
          from: 'HALF_OPEN',
          to: 'CLOSED',
          timestamp: new Date().toISOString()
        });
        console.log(`🟢 [CIRCUIT-BREAKER] ${this.name} recovered and transitioned to CLOSED`);
      }
    }
  }

  onFailure() {
    this.stats.totalFailures++;
    this.failureCount++;
    this.successCount = 0;
    
    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      // Too many failures - open the circuit
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.stats.stateChanges.push({
        from: 'CLOSED',
        to: 'OPEN',
        timestamp: new Date().toISOString()
      });
      console.error(`🔴 [CIRCUIT-BREAKER] ${this.name} opened due to ${this.failureCount} failures`);
    } else if (this.state === 'HALF_OPEN') {
      // Failed in half-open state - open again
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.stats.stateChanges.push({
        from: 'HALF_OPEN',
        to: 'OPEN',
        timestamp: new Date().toISOString()
      });
      console.error(`🔴 [CIRCUIT-BREAKER] ${this.name} opened again after failure in HALF_OPEN state`);
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
      stats: this.stats
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    console.log(`🔄 [CIRCUIT-BREAKER] ${this.name} manually reset to CLOSED`);
  }
}

// Global circuit breakers for different services
const circuitBreakers = {
  database: new CircuitBreaker('database', {
    failureThreshold: 10,
    successThreshold: 3,
    timeout: 15000,
    resetTimeout: 30000
  }),
  webhook: new CircuitBreaker('webhook', {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 45000,
    resetTimeout: 60000
  }),
  externalAPI: new CircuitBreaker('externalAPI', {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    resetTimeout: 60000
  })
};

/**
 * Middleware to check circuit breaker state before processing requests
 */
const circuitBreakerMiddleware = (breakerName) => {
  return (req, res, next) => {
    const breaker = circuitBreakers[breakerName];
    if (!breaker) {
      return next();
    }
    
    const state = breaker.getState();
    if (state.state === 'OPEN' && Date.now() < new Date(state.nextAttempt).getTime()) {
      return res.status(503).json({
        success: false,
        error: `Service ${breakerName} is temporarily unavailable. Please try again later.`,
        retryAfter: Math.ceil((new Date(state.nextAttempt).getTime() - Date.now()) / 1000)
      });
    }
    
    next();
  };
};

/**
 * Get circuit breaker statistics endpoint
 */
const getCircuitBreakerStats = () => {
  const stats = {};
  for (const [name, breaker] of Object.entries(circuitBreakers)) {
    stats[name] = breaker.getState();
  }
  return stats;
};

module.exports = {
  CircuitBreaker,
  circuitBreakers,
  circuitBreakerMiddleware,
  getCircuitBreakerStats
};
