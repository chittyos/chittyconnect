/**
 * 1Password Events API Client
 *
 * Fetches audit events from 1Password Events API and transforms them
 * for ChittyChronicle integration.
 *
 * Based on: https://github.com/1Password/events-api-elastic
 *
 * @module services/onepassword-events
 */

const EVENTS_API_BASE = 'https://events.1password.com/api/v1';

/**
 * Event types from 1Password Events API
 */
export const EventTypes = {
  SIGN_IN_ATTEMPTS: 'signinattempts',
  ITEM_USAGES: 'itemusages',
  AUDIT_EVENTS: 'auditevents',
};

/**
 * 1Password Events API Client
 */
export class OnePasswordEventsClient {
  /**
   * @param {string} token - 1Password Events API bearer token
   */
  constructor(token) {
    this.token = token;
    this.cursors = {
      [EventTypes.SIGN_IN_ATTEMPTS]: null,
      [EventTypes.ITEM_USAGES]: null,
      [EventTypes.AUDIT_EVENTS]: null,
    };
  }

  /**
   * Fetch events from the Events API
   *
   * @param {string} eventType - Type of events to fetch
   * @param {object} options - Fetch options
   * @returns {Promise<{events: object[], cursor: string}>}
   */
  async fetchEvents(eventType, options = {}) {
    const { limit = 100, startTime = null, cursor = null } = options;

    const url = `${EVENTS_API_BASE}/${eventType}`;

    const body = {
      limit,
    };

    // Use cursor for pagination, or startTime for initial fetch
    if (cursor || this.cursors[eventType]) {
      body.cursor = cursor || this.cursors[eventType];
    } else if (startTime) {
      body.start_time = startTime;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Events API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Store cursor for next fetch
    if (data.cursor) {
      this.cursors[eventType] = data.cursor;
    }

    return {
      events: data.items || [],
      cursor: data.cursor,
      hasMore: data.has_more || false,
    };
  }

  /**
   * Fetch sign-in attempt events
   *
   * @param {object} options - Fetch options
   * @returns {Promise<object[]>} Sign-in events
   */
  async getSignInAttempts(options = {}) {
    const { events } = await this.fetchEvents(EventTypes.SIGN_IN_ATTEMPTS, options);
    return events.map(this.transformSignInEvent);
  }

  /**
   * Fetch item usage events
   *
   * @param {object} options - Fetch options
   * @returns {Promise<object[]>} Item usage events
   */
  async getItemUsages(options = {}) {
    const { events } = await this.fetchEvents(EventTypes.ITEM_USAGES, options);
    return events.map(this.transformItemUsageEvent);
  }

  /**
   * Fetch audit events
   *
   * @param {object} options - Fetch options
   * @returns {Promise<object[]>} Audit events
   */
  async getAuditEvents(options = {}) {
    const { events } = await this.fetchEvents(EventTypes.AUDIT_EVENTS, options);
    return events.map(this.transformAuditEvent);
  }

  /**
   * Transform sign-in event for ChittyChronicle
   */
  transformSignInEvent(event) {
    return {
      type: 'onepassword.signin',
      timestamp: event.timestamp,
      source: '1password-events-api',
      data: {
        uuid: event.uuid,
        sessionUuid: event.session_uuid,
        userUuid: event.user?.uuid,
        userEmail: event.user?.email,
        userName: event.user?.name,
        clientApp: event.client?.app_name,
        clientVersion: event.client?.app_version,
        clientPlatform: event.client?.platform_name,
        clientOs: event.client?.os_name,
        ipAddress: event.location?.ip,
        country: event.location?.country,
        region: event.location?.region,
        city: event.location?.city,
        category: event.category, // success, credentials_failed, mfa_failed, etc.
        type: event.type,
      },
      // ChittyChronicle metadata
      chronicle: {
        service: 'chittyconnect',
        category: 'security',
        severity: event.category === 'success' ? 'info' : 'warning',
        action: 'signin_attempt',
      },
    };
  }

  /**
   * Transform item usage event for ChittyChronicle
   */
  transformItemUsageEvent(event) {
    return {
      type: 'onepassword.item_usage',
      timestamp: event.timestamp,
      source: '1password-events-api',
      data: {
        uuid: event.uuid,
        userUuid: event.user?.uuid,
        userEmail: event.user?.email,
        userName: event.user?.name,
        clientApp: event.client?.app_name,
        clientPlatform: event.client?.platform_name,
        itemUuid: event.item_uuid,
        vaultUuid: event.vault_uuid,
        action: event.action, // reveal, copy, etc.
        ipAddress: event.location?.ip,
        country: event.location?.country,
      },
      // ChittyChronicle metadata
      chronicle: {
        service: 'chittyconnect',
        category: 'credential_access',
        severity: 'info',
        action: 'item_access',
      },
    };
  }

  /**
   * Transform audit event for ChittyChronicle
   */
  transformAuditEvent(event) {
    return {
      type: 'onepassword.audit',
      timestamp: event.timestamp,
      source: '1password-events-api',
      data: {
        uuid: event.uuid,
        actorUuid: event.actor_uuid,
        actorEmail: event.actor_details?.email,
        actorName: event.actor_details?.name,
        action: event.action,
        objectType: event.object_type,
        objectUuid: event.object_uuid,
        auxId: event.aux_id,
        auxUuid: event.aux_uuid,
        auxInfo: event.aux_info,
        sessionUuid: event.session?.uuid,
        ipAddress: event.session?.ip,
      },
      // ChittyChronicle metadata
      chronicle: {
        service: 'chittyconnect',
        category: 'audit',
        severity: 'info',
        action: event.action,
      },
    };
  }

  /**
   * Fetch all event types and combine
   *
   * @param {object} options - Fetch options
   * @returns {Promise<object[]>} All events combined
   */
  async getAllEvents(options = {}) {
    const [signIns, itemUsages, auditEvents] = await Promise.all([
      this.getSignInAttempts(options),
      this.getItemUsages(options),
      this.getAuditEvents(options),
    ]);

    // Combine and sort by timestamp
    const allEvents = [...signIns, ...itemUsages, ...auditEvents];
    allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return allEvents;
  }
}

/**
 * Create events client from environment
 *
 * @param {object} env - Environment bindings
 * @returns {OnePasswordEventsClient}
 */
export function createEventsClient(env) {
  const token = env.OP_EVENTS_API_TOKEN;

  if (!token) {
    throw new Error('OP_EVENTS_API_TOKEN not configured');
  }

  return new OnePasswordEventsClient(token);
}

/**
 * Sync 1Password events to ChittyChronicle
 *
 * @param {object} env - Environment bindings
 * @param {object} options - Sync options
 * @returns {Promise<{synced: number, errors: number}>}
 */
export async function syncEventsToChronicle(env, options = {}) {
  const { sinceMinutes = 60 } = options;

  const client = createEventsClient(env);

  // Calculate start time
  const startTime = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

  // Fetch events
  const events = await client.getAllEvents({ startTime });

  let synced = 0;
  let errors = 0;

  // Send to ChittyChronicle
  for (const event of events) {
    try {
      // Store in D1 (chronicle table)
      await env.DB.prepare(
        `INSERT INTO chronicle_events (id, type, timestamp, source, data, service, category, severity, action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          event.data.uuid,
          event.type,
          event.timestamp,
          event.source,
          JSON.stringify(event.data),
          event.chronicle.service,
          event.chronicle.category,
          event.chronicle.severity,
          event.chronicle.action
        )
        .run();

      synced++;
    } catch (error) {
      console.error(`[1Password Events] Failed to sync event ${event.data.uuid}:`, error);
      errors++;
    }
  }

  console.log(`[1Password Events] Synced ${synced} events, ${errors} errors`);

  return { synced, errors, total: events.length };
}

export default {
  OnePasswordEventsClient,
  createEventsClient,
  syncEventsToChronicle,
  EventTypes,
};
