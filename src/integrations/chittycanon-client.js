/**
 * ChittyCanon Client
 *
 * Integration with ChittyCanon - the source of truth for canonical definitions
 * URL: https://chittycanon-production.ccorp.workers.dev
 *
 * Provides validation for:
 * - Workflow statuses (pending, in_progress, completed, blocked, failed, cancelled, queued)
 * - Health statuses (healthy, degraded, unhealthy, unknown, starting)
 * - Service categories (core-infrastructure, security-verification, etc.)
 * - Contract statuses (draft, pending, partially_executed, fully_executed, etc.)
 * - Currency codes (USD, EUR, GBP, USDC, BTC, ETH)
 * - Payment rails (mercury-ach, circle-usdc, stripe, etc.)
 * - Certification levels (basic, standard, enhanced, premium, enterprise)
 * - System roles (owner, admin, staff, member, user, guest)
 * - Case types, statuses, party roles
 * - Document types, evidence types
 * - Truth levels, verification states
 * - Priority levels, claim types, jurisdiction types
 */

export class ChittyCanonClient {
  constructor(baseUrl = 'https://chittycanon-production.ccorp.workers.dev') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Fetch canonical definitions with caching
   */
  async fetchCanon(category) {
    const cacheKey = `canon:${category}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      const response = await fetch(`${this.baseUrl}/canon/${category}`);
      if (!response.ok) {
        throw new Error(`ChittyCanon fetch failed: ${response.status}`);
      }

      const result = await response.json();
      this.cache.set(cacheKey, {
        data: result.data,
        timestamp: Date.now()
      });

      return result.data;
    } catch (error) {
      console.error(`[ChittyCanon] Failed to fetch ${category}:`, error.message);
      // Return cached data if available, even if expired
      return cached?.data || null;
    }
  }

  /**
   * Validate a value against a canonical type
   */
  async validate(type, value) {
    try {
      const response = await fetch(`${this.baseUrl}/canon/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value })
      });

      if (!response.ok) {
        return { valid: false, error: `Validation failed: ${response.status}` };
      }

      return await response.json();
    } catch (error) {
      console.error(`[ChittyCanon] Validation error:`, error.message);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get all workflow statuses
   */
  async getWorkflowStatuses() {
    return this.fetchCanon('workflow-statuses');
  }

  /**
   * Get all health statuses
   */
  async getHealthStatuses() {
    return this.fetchCanon('health-statuses');
  }

  /**
   * Get all service categories
   */
  async getServiceCategories() {
    return this.fetchCanon('service-categories');
  }

  /**
   * Get all contract statuses
   */
  async getContractStatuses() {
    return this.fetchCanon('contract-statuses');
  }

  /**
   * Get all currency codes
   */
  async getCurrencyCodes() {
    return this.fetchCanon('currency-codes');
  }

  /**
   * Get all payment rails
   */
  async getPaymentRails() {
    return this.fetchCanon('payment-rails');
  }

  /**
   * Get all certification levels
   */
  async getCertificationLevels() {
    return this.fetchCanon('certification-levels');
  }

  /**
   * Get all system roles
   */
  async getSystemRoles() {
    return this.fetchCanon('system-roles');
  }

  /**
   * Get all case types
   */
  async getCaseTypes() {
    return this.fetchCanon('case-types');
  }

  /**
   * Get all case statuses
   */
  async getCaseStatuses() {
    return this.fetchCanon('case-statuses');
  }

  /**
   * Get all document types
   */
  async getDocumentTypes() {
    return this.fetchCanon('document-types');
  }

  /**
   * Get all evidence types
   */
  async getEvidenceTypes() {
    return this.fetchCanon('evidence-types');
  }

  /**
   * Get all party roles
   */
  async getPartyRoles() {
    return this.fetchCanon('party-roles');
  }

  /**
   * Get all truth levels
   */
  async getTruthLevels() {
    return this.fetchCanon('truth-levels');
  }

  /**
   * Get all verification states
   */
  async getVerificationStates() {
    return this.fetchCanon('verification-states');
  }

  /**
   * Validate workflow status
   */
  async validateWorkflowStatus(status) {
    return this.validate('workflowStatus', status);
  }

  /**
   * Validate health status
   */
  async validateHealthStatus(status) {
    return this.validate('healthStatus', status);
  }

  /**
   * Validate service category
   */
  async validateServiceCategory(category) {
    return this.validate('serviceCategory', category);
  }

  /**
   * Validate currency code
   */
  async validateCurrency(code) {
    return this.validate('currencyCode', code);
  }

  /**
   * Validate payment rail
   */
  async validatePaymentRail(rail) {
    return this.validate('paymentRail', rail);
  }

  /**
   * Validate system role
   */
  async validateSystemRole(role) {
    return this.validate('systemRole', role);
  }

  /**
   * Validate case type
   */
  async validateCaseType(type) {
    return this.validate('caseType', type);
  }

  /**
   * Search canonical definitions
   */
  async search(query, category = null) {
    try {
      const url = new URL(`${this.baseUrl}/canon/search`);
      url.searchParams.set('q', query);
      if (category) url.searchParams.set('category', category);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[ChittyCanon] Search error:`, error.message);
      return { results: [] };
    }
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache() {
    this.cache.clear();
  }
}

/**
 * Singleton instance
 */
export const chittyCanon = new ChittyCanonClient();
