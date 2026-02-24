/**
 * ChittyCanon Integration Tests
 *
 * Tests ChittyConnect integration with ChittyCanon for canonical type validation.
 * Uses mocked fetch to avoid live HTTP calls to the ChittyCanon service.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ChittyCanonClient } from "../chittycanon-client.js";

// --- Fixtures ---

const VALID_VALUES = {
  workflowStatus: [
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "BLOCKED",
    "FAILED",
    "CANCELLED",
    "QUEUED",
  ],
  healthStatus: ["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN", "STARTING"],
  serviceCategory: [
    "CORE_INFRASTRUCTURE",
    "SECURITY_VERIFICATION",
    "BLOCKCHAIN_INFRASTRUCTURE",
    "AI_INTELLIGENCE",
    "DOCUMENT_EVIDENCE",
    "BUSINESS_OPERATIONS",
    "FOUNDATION_GOVERNANCE",
  ],
  currencyCode: ["USD", "EUR", "GBP", "USDC", "BTC", "ETH"],
  paymentRail: ["MERCURY_ACH", "CIRCLE_USDC", "STRIPE_ISSUING"],
  systemRole: ["OWNER", "ADMIN", "STAFF", "MEMBER", "USER", "GUEST"],
  caseType: ["EVICTION", "CIVIL", "CRIMINAL", "FAMILY"],
};

const CATEGORY_FIXTURES = {
  "workflow-statuses": {
    PENDING: { value: "pending" },
    IN_PROGRESS: { value: "in_progress" },
    COMPLETED: { value: "completed" },
    BLOCKED: { value: "blocked" },
    FAILED: { value: "failed" },
    CANCELLED: { value: "cancelled" },
    QUEUED: { value: "queued" },
  },
  "health-statuses": {
    HEALTHY: { level: 4 },
    DEGRADED: { level: 3 },
    UNHEALTHY: { level: 2 },
    UNKNOWN: { level: 1 },
    STARTING: { level: 0 },
  },
  "service-categories": {
    CORE_INFRASTRUCTURE: { label: "Core Infrastructure" },
    SECURITY_VERIFICATION: { label: "Security & Verification" },
    BLOCKCHAIN_INFRASTRUCTURE: { label: "Blockchain Infrastructure" },
    AI_INTELLIGENCE: { label: "AI & Intelligence" },
    DOCUMENT_EVIDENCE: { label: "Document & Evidence" },
    BUSINESS_OPERATIONS: { label: "Business Operations" },
    FOUNDATION_GOVERNANCE: { label: "Foundation Governance" },
  },
  "currency-codes": {
    USD: { symbol: "$", decimals: 2 },
    EUR: { symbol: "€", decimals: 2 },
    GBP: { symbol: "£", decimals: 2 },
    USDC: { symbol: "$", decimals: 2 },
    BTC: { symbol: "₿", decimals: 8 },
    ETH: { symbol: "Ξ", decimals: 18 },
  },
  "payment-rails": {
    MERCURY_ACH: { provider: "Mercury" },
    CIRCLE_USDC: { provider: "Circle" },
    STRIPE_ISSUING: { provider: "Stripe" },
  },
  "case-types": {
    EVICTION: { label: "Eviction" },
    CIVIL: { label: "Civil" },
    CRIMINAL: { label: "Criminal" },
    FAMILY: { label: "Family" },
  },
  "case-statuses": {
    DRAFT: { order: 0 },
    FILED: { order: 1 },
    ACTIVE: { order: 2 },
    CLOSED: { order: 3 },
  },
  "party-roles": {
    PLAINTIFF: { label: "Plaintiff" },
    DEFENDANT: { label: "Defendant" },
    WITNESS: { label: "Witness" },
  },
  "system-roles": {
    OWNER: { level: 5, permissions: ["*"] },
    ADMIN: { level: 4, permissions: ["manage_users", "manage_settings"] },
    STAFF: { level: 3, permissions: ["manage_content"] },
    MEMBER: { level: 2, permissions: ["read", "write"] },
    USER: { level: 1, permissions: ["read"] },
    GUEST: { level: 0, permissions: ["read_public"] },
  },
};

// --- Mock fetch ---

const BASE_URL = "https://chittycanon-production.ccorp.workers.dev";

function createMockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const mockFetch = vi.fn(async (url, options) => {
  const urlStr = typeof url === "string" ? url : url.toString();

  // Reject requests to unknown hosts (simulates network error)
  if (!urlStr.startsWith(BASE_URL)) {
    throw new TypeError("fetch failed");
  }

  // POST /canon/validate
  if (urlStr === `${BASE_URL}/canon/validate` && options?.method === "POST") {
    const body = JSON.parse(options.body);
    const validList = VALID_VALUES[body.type];
    const valid = validList ? validList.includes(body.value) : false;
    return createMockResponse({ valid });
  }

  // GET /canon/search?q=...&category=...
  if (urlStr.startsWith(`${BASE_URL}/canon/search`)) {
    const parsed = new URL(urlStr);
    const q = parsed.searchParams.get("q") || "";
    const category = parsed.searchParams.get("category");
    const results = [];

    const sources = category
      ? { [category]: CATEGORY_FIXTURES[category] }
      : CATEGORY_FIXTURES;

    for (const [cat, data] of Object.entries(sources)) {
      if (!data) continue;
      for (const key of Object.keys(data)) {
        if (key.toLowerCase().includes(q.toLowerCase())) {
          results.push({ category: cat, key, ...data[key] });
        }
      }
    }
    return createMockResponse({ results });
  }

  // GET /canon/{category}
  const categoryMatch = urlStr.match(
    new RegExp(`^${BASE_URL.replace(/\./g, "\\.")}/canon/(.+)$`),
  );
  if (categoryMatch) {
    const category = categoryMatch[1];
    const data = CATEGORY_FIXTURES[category];
    if (data) {
      return createMockResponse({ data });
    }
    return createMockResponse({ error: "Not found" }, 404);
  }

  return createMockResponse({ error: "Not found" }, 404);
});

// --- Tests ---

describe("ChittyCanonClient", () => {
  let client;

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    client = new ChittyCanonClient();
    client.clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      await client.getWorkflowStatuses();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should hit cache, not fetch
      await client.getWorkflowStatuses();
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
