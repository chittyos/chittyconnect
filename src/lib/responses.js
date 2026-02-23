/**
 * Response Utilities - GPT-optimized response formatting
 *
 * Provides consistent, context-aware response formatting
 * specifically designed for Custom GPT Actions consumption
 */

/**
 * Generate a contextual response with GPT-friendly hints
 *
 * @param {HonoContext} c - Hono context
 * @param {object} data - Response data
 * @param {object} options - Response options
 * @param {string} options.conversationId - Conversation ID
 * @param {string} options.hint - Continuation hint for GPT
 * @param {Array} options.nextSteps - Suggested next actions
 * @param {string} options.explanation - Detailed explanation
 * @param {string} options.currentStep - Current workflow step
 * @param {number} options.processingTime - Processing time in ms
 * @param {number} options.status - HTTP status code (default 200)
 * @returns {Response} Hono JSON response
 */
export function contextualResponse(c, data, options = {}) {
  const context = c.get("context") || {};
  const auth = c.get("auth") || {};

  const response = {
    success: true,
    data,
    context: {
      conversationId: options.conversationId || context.session?.conversationId,
      requestId: context.session?.requestId || crypto.randomUUID(),
      continuationHint: options.hint || null,
      suggestedNextSteps: options.nextSteps || null,
      explanation: options.explanation || null,
      currentStep: options.currentStep || null,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      processingTime:
        options.processingTime ||
        Date.now() - (c.get("startTime") || Date.now()),
      service: "chittyconnect",
      version: "2.0.2",
    },
  };

  // Add user context if available
  if (auth.userId) {
    response.metadata.userId = auth.userId;
  }

  // Clean up null values from context
  Object.keys(response.context).forEach((key) => {
    if (response.context[key] === null) {
      delete response.context[key];
    }
  });

  return c.json(response, options.status || 200);
}

/**
 * Format error response with recovery guidance
 *
 * @param {HonoContext} c - Hono context
 * @param {APIError|Error} error - Error object
 * @returns {Response} Hono JSON error response
 */
export function errorResponse(c, error) {
  const context = c.get("context") || {};
  const isDevelopment = c.env?.NODE_ENV === "development";

  // Map common errors to user-friendly messages
  const errorMap = {
    INVALID_ENTITY_TYPE: {
      message:
        "The entity type you provided is not valid. Please use one of the canonical types: P (Person), L (Location), T (Thing), E (Event), A (Authority). See chittycanon://gov/governance#core-types",
      recovery:
        "Check the entity type and try again with a valid canonical type code (P/L/T/E/A).",
      statusCode: 400,
    },
    RATE_LIMITED: {
      message:
        "You've made too many requests. Please wait a moment before trying again.",
      recovery:
        "Wait 60 seconds before making another request. Consider batching multiple operations.",
      statusCode: 429,
    },
    SERVICE_UNAVAILABLE: {
      message:
        "The service is temporarily unavailable. Our team has been notified.",
      recovery:
        "Try again in a few minutes. Check service status at /api/services/status.",
      statusCode: 503,
    },
    UNAUTHORIZED: {
      message:
        "Authentication required. Please provide a valid API key or bearer token.",
      recovery:
        "Include 'Authorization: Bearer <token>' header in your request.",
      statusCode: 401,
    },
    FORBIDDEN: {
      message: "You don't have permission to perform this action.",
      recovery:
        "Request additional scopes or contact support to upgrade your access level.",
      statusCode: 403,
    },
    NOT_FOUND: {
      message: "The requested resource was not found.",
      recovery:
        "Verify the ID or path and try again. Use search endpoints to find resources.",
      statusCode: 404,
    },
    VALIDATION_ERROR: {
      message: "The request contains invalid data.",
      recovery: "Review the error details and fix the invalid fields.",
      statusCode: 400,
    },
    CHITTYID_CREATION_FAILED: {
      message:
        "Failed to create ChittyID. The identity service may be experiencing issues.",
      recovery:
        "Try again in a moment. If the problem persists, contact support.",
      statusCode: 500,
    },
    CASE_CREATION_FAILED: {
      message: "Failed to create the case record.",
      recovery: "Verify all required fields are provided and try again.",
      statusCode: 500,
    },
    COMPOSITE_OPERATION_FAILED: {
      message: "The multi-step operation failed partway through.",
      recovery:
        "Review which operations succeeded and retry the failed portions individually.",
      statusCode: 500,
    },
    BATCH_TOO_LARGE: {
      message: "The batch contains too many requests.",
      recovery:
        "Split the batch into smaller chunks (maximum 10 requests per batch).",
      statusCode: 400,
    },
  };

  const errorInfo = errorMap[error.code] || {
    message: error.message || "An unexpected error occurred",
    recovery:
      "Please try again. If the issue persists, contact support with the request ID.",
    statusCode: error.statusCode || 500,
  };

  const response = {
    success: false,
    error: {
      code: error.code || "UNKNOWN_ERROR",
      message: errorInfo.message,
      recovery: errorInfo.recovery,
      conversationId: context.session?.conversationId,
      requestId: context.session?.requestId || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    },
  };

  // Include details only in development or if provided
  if (isDevelopment && error.details) {
    response.error.details = error.details;
  }

  // Include stack trace in development
  if (isDevelopment && error.stack) {
    response.error.stack = error.stack;
  }

  return c.json(response, errorInfo.statusCode);
}

/**
 * Format a success response for simple operations
 *
 * @param {HonoContext} c - Hono context
 * @param {object} data - Response data
 * @param {string} message - Success message
 * @param {number} status - HTTP status code
 * @returns {Response} Hono JSON response
 */
export function successResponse(
  c,
  data,
  message = "Operation completed successfully",
  status = 200,
) {
  return c.json(
    {
      success: true,
      message,
      data,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
    },
    status,
  );
}

/**
 * Format a paginated response
 *
 * @param {HonoContext} c - Hono context
 * @param {Array} items - Array of items
 * @param {object} pagination - Pagination info
 * @param {number} pagination.page - Current page
 * @param {number} pagination.limit - Items per page
 * @param {number} pagination.total - Total items
 * @returns {Response} Hono JSON response
 */
export function paginatedResponse(c, items, pagination) {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);

  return c.json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    },
  });
}

/**
 * Format a streaming response (Server-Sent Events)
 *
 * @param {HonoContext} c - Hono context
 * @param {Function} handler - Async handler function
 * @returns {Response} SSE response
 */
export function streamingResponse(c, handler) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (event, data) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(message));
  };

  // Execute handler and close stream when done
  handler(send)
    .then(() => writer.close())
    .catch((error) => {
      send("error", {
        code: "STREAM_ERROR",
        message: error.message,
      }).finally(() => writer.close());
    });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Format a webhook response (immediate acknowledgment)
 *
 * @param {HonoContext} c - Hono context
 * @param {string} webhookId - Webhook ID for tracking
 * @returns {Response} Hono JSON response
 */
export function webhookResponse(c, webhookId) {
  return c.json(
    {
      success: true,
      acknowledged: true,
      webhookId,
      message: "Webhook received and queued for processing",
      metadata: {
        timestamp: new Date().toISOString(),
        processingStatus: "queued",
      },
    },
    202,
  ); // 202 Accepted
}

/**
 * Format partial success response (for batch operations)
 *
 * @param {HonoContext} c - Hono context
 * @param {Array} succeeded - Successful operations
 * @param {Array} failed - Failed operations
 * @returns {Response} Hono JSON response
 */
export function partialSuccessResponse(c, succeeded, failed) {
  const total = succeeded.length + failed.length;
  const allSucceeded = failed.length === 0;

  return c.json(
    {
      success: allSucceeded,
      summary: {
        total,
        succeeded: succeeded.length,
        failed: failed.length,
        successRate: `${Math.round((succeeded.length / total) * 100)}%`,
      },
      results: {
        succeeded,
        failed,
      },
      context: {
        partialSuccess: !allSucceeded && succeeded.length > 0,
        recommendation:
          failed.length > 0
            ? `${failed.length} operations failed. Review the failed items and retry if needed.`
            : "All operations completed successfully.",
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
    },
    allSucceeded ? 200 : 207,
  ); // 207 Multi-Status
}
