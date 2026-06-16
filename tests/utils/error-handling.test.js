import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ErrorTypes,
  classifyError,
  isRetryable,
  resilientFetch,
  resetCircuitBreaker,
  getCircuitBreakerStatus
} from "../../src/utils/error-handling.js";

describe("error-handling", () => {
  describe("classifyError", () => {
    it("classifies network errors correctly", () => {
      expect(classifyError(new Error("fetch failed"))).toBe(ErrorTypes.NETWORK);
      expect(classifyError(new Error("ECONNREFUSED"))).toBe(ErrorTypes.NETWORK);
    });

    it("classifies timeouts correctly", () => {
      expect(classifyError(new Error("request timed out"))).toBe(ErrorTypes.TIMEOUT);
    });

    it("classifies HTTP status codes correctly", () => {
      expect(classifyError({ status: 401 })).toBe(ErrorTypes.AUTH);
      expect(classifyError({ status: 404 })).toBe(ErrorTypes.NOT_FOUND);
      expect(classifyError({ status: 429 })).toBe(ErrorTypes.RATE_LIMIT);
      expect(classifyError({ status: 500 })).toBe(ErrorTypes.SERVER);
      expect(classifyError({ status: 400 })).toBe(ErrorTypes.VALIDATION);
    });

    it("defaults to UNKNOWN", () => {
      expect(classifyError(new Error("something weird"))).toBe(ErrorTypes.UNKNOWN);
      expect(classifyError(null)).toBe(ErrorTypes.UNKNOWN);
    });
  });

  describe("isRetryable", () => {
    it("returns true for retryable errors", () => {
      expect(isRetryable({ status: 500 })).toBe(true);
      expect(isRetryable({ status: 429 })).toBe(true);
      expect(isRetryable(new Error("fetch failed"))).toBe(true);
    });

    it("returns false for non-retryable errors", () => {
      expect(isRetryable({ status: 400 })).toBe(false);
      expect(isRetryable({ status: 401 })).toBe(false);
      expect(isRetryable({ status: 404 })).toBe(false);
    });
  });

  describe("resilientFetch & Circuit Breaker", () => {
    const originalFetch = global.fetch;
    
    beforeEach(() => {
      vi.useFakeTimers();
      resetCircuitBreaker("test-service");
    });

    afterEach(() => {
      vi.useRealTimers();
      global.fetch = originalFetch;
    });

    it("succeeds on first try", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      });

      const response = await resilientFetch("https://test-service.chitty.cc/api");
      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      const status = getCircuitBreakerStatus("test-service");
      expect(status["test-service"].state).toBe("closed");
    });

    it("retries on server errors and respects exponential backoff", async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Error" })
        .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

      const fetchPromise = resilientFetch("https://test-service.chitty.cc/api", {}, { baseDelay: 10, maxAttempts: 3 });
      
      // Advance timers to trigger the backoffs
      await vi.advanceTimersByTimeAsync(100);
      
      const response = await fetchPromise;
      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("throws immediately on non-retryable errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "Invalid input"
      });

      await expect(resilientFetch("https://test-service.chitty.cc/api")).rejects.toThrow("HTTP 400");
      expect(global.fetch).toHaveBeenCalledTimes(1); // Should not retry 400 errors
    });

    it("opens circuit breaker after threshold failures", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));

      const serviceUrl = "https://test-breaker.chitty.cc/api";
      resetCircuitBreaker("test-breaker");
      
      const fetchPromise = resilientFetch(serviceUrl, {}, { baseDelay: 1, maxAttempts: 6 });
      fetchPromise.catch(() => {}); // prevent unhandled rejection during timer advance
      
      await vi.advanceTimersByTimeAsync(1000);
      
      await expect(fetchPromise).rejects.toThrow(/Circuit breaker OPEN/);
      
      // The default circuit breaker threshold is 5
      const status = getCircuitBreakerStatus("test-breaker");
      expect(status["test-breaker"].state).toBe("open");
      
      // Next call should immediately fail due to open breaker
      await expect(resilientFetch(serviceUrl)).rejects.toThrow(/Circuit breaker OPEN/);
    });
  });
});
