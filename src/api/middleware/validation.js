/**
 * Validation Middleware - Request validation using Zod schemas
 */

import { fromZodError } from "../../lib/errors.js";
import { errorResponse } from "../../lib/responses.js";

/**
 * Validate request body against a Zod schema
 *
 * @param {ZodSchema} schema - Zod validation schema
 * @returns {Function} Hono middleware function
 */
export function validateRequest(schema) {
  return async (c, next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);

      // Store validated data in context
      c.set("validated", validated);

      // Add to req object for compatibility
      c.req.valid = (type) => {
        if (type === "json") return validated;
        return validated;
      };

      await next();
    } catch (error) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return errorResponse(c, validationError);
      }
      throw error;
    }
  };
}

/**
 * Validate query parameters against a Zod schema
 *
 * @param {ZodSchema} schema - Zod validation schema
 * @returns {Function} Hono middleware function
 */
export function validateQuery(schema) {
  return async (c, next) => {
    try {
      const query = Object.fromEntries(
        new URLSearchParams(c.req.url.split("?")[1] || ""),
      );

      const validated = schema.parse(query);
      c.set("validatedQuery", validated);

      await next();
    } catch (error) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return errorResponse(c, validationError);
      }
      throw error;
    }
  };
}

/**
 * Validate path parameters against a Zod schema
 *
 * @param {ZodSchema} schema - Zod validation schema
 * @returns {Function} Hono middleware function
 */
export function validateParams(schema) {
  return async (c, next) => {
    try {
      const params = c.req.param();
      const validated = schema.parse(params);
      c.set("validatedParams", validated);

      await next();
    } catch (error) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return errorResponse(c, validationError);
      }
      throw error;
    }
  };
}

/**
 * Common validation schemas for reuse
 */
export const CommonSchemas = {
  ChittyID: {
    pattern: /^01-[CE]-[A-Z]{3,4}-[A-Z0-9]{4}-[PTOCLX]-\d{4}-[0-9A-F]-X$/,
    description: "Valid ChittyID format",
  },

  UUID: {
    pattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    description: "Valid UUID v4",
  },

  Email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    description: "Valid email address",
  },

  Phone: {
    pattern: /^\+?[1-9]\d{1,14}$/,
    description: "Valid phone number (E.164 format)",
  },
};
