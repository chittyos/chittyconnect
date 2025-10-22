/**
 * Error Handling Utilities
 *
 * Provides comprehensive error handling with:
 * - Exponential backoff retry logic
 * - Circuit breaker pattern
 * - Error classification
 * - Logging and monitoring hooks
 */

/**
 * Error types for classification
 */
export const ErrorTypes = {
  NETWORK: "network",
  TIMEOUT: "timeout",
  RATE_LIMIT: "rate_limit",
  AUTH: "authentication",
  VALIDATION: "validation",
  NOT_FOUND: "not_found",
  SERVER: "server",
  UNKNOWN: "unknown",
};

/**
 * Circuit breaker states
 */
const CircuitState = {
  CLOSED: "closed", // Normal operation
  OPEN: "open", // Failing, rejecting requests
  HALF_OPEN: "half_open", // Testing if service recovered
};

/**
 * Circuit breaker for service calls
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitorWindow = options.monitorWindow || 120000; // 2 minutes

    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Record a successful call
   */
  recordSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      console.log("[CircuitBreaker] Service recovered, closing circuit");
      this.state = CircuitState.CLOSED;
      this.failures = [];
    }
  }

  /**
   * Record a failed call
   */
  recordFailure() {
    const now = Date.now();
    this.lastFailureTime = now;

    // Remove old failures outside monitor window
    this.failures = this.failures.filter(
      (time) => now - time < this.monitorWindow,
    );

    // Add new failure
    this.failures.push(now);

    // Check if threshold exceeded
    if (this.failures.length >= this.failureThreshold) {
      console.error(
        `[CircuitBreaker] Failure threshold exceeded (${this.failures.length}/${this.failureThreshold}), opening circuit`,
      );
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = now + this.resetTimeout;
    }
  }

  /**
   * Check if request should be allowed
   */
  canAttempt() {
    const now = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (now >= this.nextAttemptTime) {
          console.log("[CircuitBreaker] Testing service recovery (half-open)");
          this.state = CircuitState.HALF_OPEN;
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return true;

      default:
        return true;
    }
  }

  /**
   * Get circuit state
   */
  getState() {
    return {
      state: this.state,
      failures: this.failures.length,
      threshold: this.failureThreshold,
      nextAttempt: this.nextAttemptTime,
    };
  }
}

/**
 * Circuit breakers for different services
 */
const circuitBreakers = {
  chittyid: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 }),
  auth: new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 }),
  registry: new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000 }),
  default: new CircuitBreaker(),
};

/**
 * Get circuit breaker for service
 */
function getCircuitBreaker(serviceName) {
  return circuitBreakers[serviceName] || circuitBreakers.default;
}

/**
 * Classify error type
 */
export function classifyError(error) {
  if (!error) return ErrorTypes.UNKNOWN;

  const message = error.message?.toLowerCase() || "";
  const status = error.status || error.statusCode;

  // Network errors
  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("econnrefused")
  ) {
    return ErrorTypes.NETWORK;
  }

  // Timeout errors
  if (message.includes("timeout") || message.includes("timed out")) {
    return ErrorTypes.TIMEOUT;
  }

  // HTTP status codes
  if (status === 401 || status === 403) return ErrorTypes.AUTH;
  if (status === 404) return ErrorTypes.NOT_FOUND;
  if (status === 429) return ErrorTypes.RATE_LIMIT;
  if (status >= 400 && status < 500) return ErrorTypes.VALIDATION;
  if (status >= 500) return ErrorTypes.SERVER;

  return ErrorTypes.UNKNOWN;
}

/**
 * Check if error is retryable
 */
export function isRetryable(error) {
  const errorType = classifyError(error);

  // Retryable errors
  const retryableTypes = [
    ErrorTypes.NETWORK,
    ErrorTypes.TIMEOUT,
    ErrorTypes.RATE_LIMIT,
    ErrorTypes.SERVER,
  ];

  return retryableTypes.includes(errorType);
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000) {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

  // Add jitter (±25%)
  const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of function or throws last error
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetry = null,
    serviceName = "default",
  } = options;

  const breaker = getCircuitBreaker(serviceName);
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Check circuit breaker
      if (!breaker.canAttempt()) {
        const state = breaker.getState();
        throw new Error(
          `Circuit breaker OPEN for ${serviceName}. Next attempt at ${new Date(state.nextAttempt).toISOString()}`,
        );
      }

      // Attempt function call
      const result = await fn();

      // Success! Record in circuit breaker
      breaker.recordSuccess();

      return result;
    } catch (error) {
      lastError = error;

      // Record failure in circuit breaker
      breaker.recordFailure();

      // Check if error is retryable
      if (!isRetryable(error)) {
        console.error(
          `[Retry] Non-retryable error (${classifyError(error)}):`,
          error.message,
        );
        throw error;
      }

      // Last attempt - don't retry
      if (attempt === maxAttempts - 1) {
        console.error(
          `[Retry] Max attempts (${maxAttempts}) reached for ${serviceName}`,
        );
        break;
      }

      // Calculate backoff delay
      const delay = calculateBackoff(attempt, baseDelay, maxDelay);

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${maxAttempts} failed for ${serviceName}. ` +
          `Error: ${error.message}. Retrying in ${delay}ms...`,
      );

      // Call onRetry hook if provided
      if (onRetry) {
        await onRetry(attempt, error, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // All attempts failed
  throw lastError;
}

/**
 * Timeout wrapper for fetch requests
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Enhanced fetch with retry and circuit breaker
 */
export async function resilientFetch(url, options = {}, retryOptions = {}) {
  const serviceName = new URL(url).hostname.split(".")[0] || "default";

  return retryWithBackoff(
    async () => {
      const response = await fetchWithTimeout(
        url,
        options,
        retryOptions.timeout || 10000,
      );

      // Check if response is OK
      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
        error.status = response.status;
        error.response = response;
        throw error;
      }

      return response;
    },
    {
      ...retryOptions,
      serviceName,
    },
  );
}

/**
 * Get circuit breaker status for service
 */
export function getCircuitBreakerStatus(serviceName = null) {
  if (serviceName) {
    const breaker = getCircuitBreaker(serviceName);
    return {
      [serviceName]: breaker.getState(),
    };
  }

  // Return all circuit breakers
  const status = {};
  for (const [name, breaker] of Object.entries(circuitBreakers)) {
    status[name] = breaker.getState();
  }
  return status;
}

/**
 * Reset circuit breaker for service (admin only)
 */
export function resetCircuitBreaker(serviceName) {
  const breaker = getCircuitBreaker(serviceName);
  breaker.state = CircuitState.CLOSED;
  breaker.failures = [];
  breaker.lastFailureTime = null;
  breaker.nextAttemptTime = null;

  console.log(`[CircuitBreaker] Manually reset circuit for ${serviceName}`);

  return {
    success: true,
    service: serviceName,
    state: breaker.getState(),
  };
}
