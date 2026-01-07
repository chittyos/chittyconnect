/**
 * ChittyCanon Integration Tests
 *
 * Tests ChittyConnect integration with ChittyCanon for canonical type validation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChittyCanonClient } from "../chittycanon-client.js";

describe("ChittyCanonClient", () => {
  let client;

  beforeEach(() => {
    client = new ChittyCanonClient();
    client.clearCache(); // Clear cache before each test
  });

  describe("Workflow Status Validation", () => {
    it("should validate valid workflow statuses", async () => {
      const validStatuses = [
        "PENDING",
        "IN_PROGRESS",
        "COMPLETED",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
        "QUEUED",
      ];

      for (const status of validStatuses) {
        const result = await client.validateWorkflowStatus(status);
        expect(result.valid).toBe(true);
      }
    });

    it("should reject invalid workflow statuses", async () => {
      const result = await client.validateWorkflowStatus("INVALID_STATUS");
      expect(result.valid).toBe(false);
    });

    it("should fetch workflow statuses", async () => {
      const statuses = await client.getWorkflowStatuses();
      expect(statuses).toBeDefined();
      expect(statuses.PENDING).toBeDefined();
      expect(statuses.PENDING.value).toBe("pending");
    });
  });

  describe("Health Status Validation", () => {
    it("should validate valid health statuses", async () => {
      const validStatuses = [
        "HEALTHY",
        "DEGRADED",
        "UNHEALTHY",
        "UNKNOWN",
        "STARTING",
      ];

      for (const status of validStatuses) {
        const result = await client.validateHealthStatus(status);
        expect(result.valid).toBe(true);
      }
    });

    it("should fetch health statuses with levels", async () => {
      const statuses = await client.getHealthStatuses();
      expect(statuses).toBeDefined();
      expect(statuses.HEALTHY.level).toBe(4);
      expect(statuses.DEGRADED.level).toBe(3);
    });
  });

  describe("Service Category Validation", () => {
    it("should validate ChittyRegistry service categories", async () => {
      const validCategories = [
        "CORE_INFRASTRUCTURE",
        "SECURITY_VERIFICATION",
        "BLOCKCHAIN_INFRASTRUCTURE",
        "AI_INTELLIGENCE",
        "DOCUMENT_EVIDENCE",
        "BUSINESS_OPERATIONS",
        "FOUNDATION_GOVERNANCE",
      ];

      for (const category of validCategories) {
        const result = await client.validateServiceCategory(category);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("Currency and Payment Validation", () => {
    it("should validate currency codes", async () => {
      const validCurrencies = ["USD", "EUR", "GBP", "USDC", "BTC", "ETH"];

      for (const currency of validCurrencies) {
        const result = await client.validateCurrency(currency);
        expect(result.valid).toBe(true);
      }
    });

    it("should validate payment rails", async () => {
      const validRails = ["MERCURY_ACH", "CIRCLE_USDC", "STRIPE_ISSUING"];

      for (const rail of validRails) {
        const result = await client.validatePaymentRail(rail);
        expect(result.valid).toBe(true);
      }
    });

    it("should fetch currency codes with metadata", async () => {
      const currencies = await client.getCurrencyCodes();
      expect(currencies).toBeDefined();
      expect(currencies.USD.symbol).toBe("$");
      expect(currencies.USD.decimals).toBe(2);
      expect(currencies.BTC.decimals).toBe(8);
    });
  });

  describe("Legal Case Validation", () => {
    it("should validate case types", async () => {
      const validTypes = ["EVICTION", "CIVIL", "CRIMINAL", "FAMILY"];

      for (const type of validTypes) {
        const result = await client.validateCaseType(type);
        expect(result.valid).toBe(true);
      }
    });

    it("should fetch case statuses with order", async () => {
      const statuses = await client.getCaseStatuses();
      expect(statuses).toBeDefined();
      expect(statuses.DRAFT.order).toBe(0);
      expect(statuses.FILED.order).toBe(1);
    });

    it("should fetch party roles", async () => {
      const roles = await client.getPartyRoles();
      expect(roles).toBeDefined();
      expect(roles.PLAINTIFF).toBeDefined();
      expect(roles.DEFENDANT).toBeDefined();
    });
  });

  describe("System Roles Validation", () => {
    it("should validate system roles", async () => {
      const validRoles = ["OWNER", "ADMIN", "STAFF", "MEMBER", "USER", "GUEST"];

      for (const role of validRoles) {
        const result = await client.validateSystemRole(role);
        expect(result.valid).toBe(true);
      }
    });

    it("should fetch system roles with permissions", async () => {
      const roles = await client.getSystemRoles();
      expect(roles).toBeDefined();
      expect(roles.OWNER.level).toBe(5);
      expect(roles.OWNER.permissions).toContain("*");
      expect(roles.USER.level).toBe(1);
    });
  });

  describe("Caching", () => {
    it("should cache fetched canonical definitions", async () => {
      // First fetch
      const start1 = Date.now();
      await client.getWorkflowStatuses();
      const time1 = Date.now() - start1;

      // Second fetch (should be from cache)
      const start2 = Date.now();
      await client.getWorkflowStatuses();
      const time2 = Date.now() - start2;

      // Cached request should be significantly faster
      expect(time2).toBeLessThan(time1);
    });

    it("should clear cache when requested", async () => {
      await client.getWorkflowStatuses();
      expect(client.cache.size).toBeGreaterThan(0);

      client.clearCache();
      expect(client.cache.size).toBe(0);
    });
  });

  describe("Search Functionality", () => {
    it("should search across canonical definitions", async () => {
      const results = await client.search("pending");
      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
    });

    it("should search within a specific category", async () => {
      const results = await client.search("completed", "workflowStatuses");
      expect(results.results).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors gracefully", async () => {
      const badClient = new ChittyCanonClient("https://invalid.example.com");
      const result = await badClient.validateWorkflowStatus("PENDING");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return cached data on failure if available", async () => {
      // First, populate cache
      await client.getWorkflowStatuses();

      // Now break the client
      client.baseUrl = "https://invalid.example.com";

      // Should still return cached data
      const statuses = await client.getWorkflowStatuses();
      expect(statuses).toBeDefined();
    });
  });
});
