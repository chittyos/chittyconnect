/**
 * Error Utilities - Structured error handling for API
 *
 * Provides consistent error types and handling across the application
 */

/**
 * Base API Error class with structured information
 */
export class APIError extends Error {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable error message
   * @param {any} details - Additional error details
   * @param {number} statusCode - HTTP status code
   */
  constructor(code, message, details = null, statusCode = 500) {
    super(message);
    this.name = "APIError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Validation Error - For request validation failures
 */
export class ValidationError extends APIError {
  constructor(message, fieldErrors = {}) {
    super("VALIDATION_ERROR", message, { fields: fieldErrors }, 400);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Authentication Error - For auth failures
 */
export class AuthenticationError extends APIError {
  constructor(message = "Authentication required", details = null) {
    super("UNAUTHORIZED", message, details, 401);
    this.name = "AuthenticationError";
  }
}

/**
 * Authorization Error - For permission failures
 */
export class AuthorizationError extends APIError {
  constructor(
    message = "Insufficient permissions",
    requiredScopes = [],
    providedScopes = [],
  ) {
    super("FORBIDDEN", message, { requiredScopes, providedScopes }, 403);
    this.name = "AuthorizationError";
  }
}

/**
 * Not Found Error - For missing resources
 */
export class NotFoundError extends APIError {
  constructor(resource, identifier) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super("NOT_FOUND", message, { resource, identifier }, 404);
    this.name = "NotFoundError";
  }
}

/**
 * Rate Limit Error - For rate limiting
 */
export class RateLimitError extends APIError {
  constructor(limit, resetAt) {
    super(
      "RATE_LIMITED",
      "Rate limit exceeded",
      { limit, resetAt: new Date(resetAt).toISOString() },
      429,
    );
    this.name = "RateLimitError";
  }
}

/**
 * Service Unavailable Error - For upstream service failures
 */
export class ServiceUnavailableError extends APIError {
  constructor(service, reason = null) {
    super(
      "SERVICE_UNAVAILABLE",
      `Service ${service} is temporarily unavailable`,
      { service, reason },
      503,
    );
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Conflict Error - For resource conflicts
 */
export class ConflictError extends APIError {
  constructor(message, conflictDetails = null) {
    super("CONFLICT", message, conflictDetails, 409);
    this.name = "ConflictError";
  }
}

/**
 * Wrap external service errors with context
 */
export function wrapServiceError(serviceName, error, context = {}) {
  if (error instanceof APIError) {
    return error;
  }

  const statusCode = error.status || error.statusCode || 500;

  return new APIError(
    `${serviceName.toUpperCase()}_ERROR`,
    `${serviceName} service error: ${error.message}`,
    {
      originalError: error.message,
      statusCode,
      ...context,
    },
    statusCode,
  );
}

/**
 * Create error from Zod validation failure
 */
export function fromZodError(zodError) {
  const fieldErrors = {};

  zodError.errors.forEach((err) => {
    const path = err.path.join(".");
    fieldErrors[path] = err.message;
  });

  return new ValidationError("Request validation failed", fieldErrors);
}

/**
 * Global error handler middleware
 */
export function errorHandler(err, c) {
  console.error("Error:", {
    code: err.code,
    message: err.message,
    details: err.details,
    stack: err.stack,
  });

  // If it's already an APIError, use it directly
  if (err instanceof APIError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: c.env?.NODE_ENV === "development" ? err.details : undefined,
          timestamp: err.timestamp,
        },
      },
      err.statusCode,
    );
  }

  // Handle Zod validation errors
  if (err.name === "ZodError") {
    const validationError = fromZodError(err);
    return c.json(
      {
        success: false,
        error: validationError.toJSON(),
      },
      400,
    );
  }

  // Generic error response
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        details: c.env?.NODE_ENV === "development" ? err.message : undefined,
        timestamp: new Date().toISOString(),
      },
    },
    500,
  );
}
