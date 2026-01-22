/**
 * ChittyChronicle Engine
 * Database operations for event logging and audit trails
 */

import { Client } from "@neondatabase/serverless";

// ============================================================================
// DATABASE SCHEMA
// ============================================================================

const CHRONICLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS chronicle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  service VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  user_id VARCHAR(255),
  user_email VARCHAR(255),
  metadata JSONB,
  related_events UUID[],
  triggered_by VARCHAR(50),
  integrations TEXT[],
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      service || ' ' ||
      action || ' ' ||
      COALESCE(metadata::text, '')
    )
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chronicle_service ON chronicle_events(service, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chronicle_search ON chronicle_events USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_chronicle_timestamp ON chronicle_events(timestamp DESC);
`;

// ============================================================================
// CHRONICLE ENGINE CLASS
// ============================================================================

export class ChronicleEngine {
  constructor(databaseUrl) {
    this.db = new Client({ connectionString: databaseUrl });
  }

  async connect() {
    await this.db.connect();
    await this.db.query(CHRONICLE_SCHEMA);
  }

  async logEvent(event) {
    const result = await this.db.query(
      `
      INSERT INTO chronicle_events (
        service, action, user_id, user_email, metadata,
        related_events, triggered_by, integrations, status, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, timestamp
    `,
      [
        event.service,
        event.action,
        event.userId || null,
        event.userEmail || null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.relatedEvents || null,
        event.triggeredBy || null,
        event.integrations || null,
        event.status || "success",
        event.errorMessage || null,
      ],
    );

    return {
      id: result.rows[0].id,
      timestamp: result.rows[0].timestamp,
    };
  }

  async searchEvents(params) {
    let query = "SELECT * FROM chronicle_events WHERE 1=1";
    const values = [];
    let paramCount = 1;

    if (params.service) {
      query += ` AND service = $${paramCount++}`;
      values.push(params.service);
    }

    if (params.action) {
      query += ` AND action = $${paramCount++}`;
      values.push(params.action);
    }

    if (params.userId) {
      query += ` AND user_id = $${paramCount++}`;
      values.push(params.userId);
    }

    if (params.startDate) {
      query += ` AND timestamp >= $${paramCount++}`;
      values.push(params.startDate);
    }

    if (params.endDate) {
      query += ` AND timestamp <= $${paramCount++}`;
      values.push(params.endDate);
    }

    if (params.status) {
      query += ` AND status = $${paramCount++}`;
      values.push(params.status);
    }

    if (params.query) {
      query += ` AND search_vector @@ plainto_tsquery('english', $${paramCount++})`;
      values.push(params.query);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramCount}`;
    values.push(params.limit || 100);

    const result = await this.db.query(query, values);
    return result.rows;
  }

  async getTimeline(params) {
    const groupBy = params.groupBy || "day";

    let query = `
      SELECT
        date_trunc('${groupBy}', timestamp) as period,
        service,
        COUNT(*) as event_count,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM chronicle_events
      WHERE timestamp BETWEEN $1 AND $2
    `;

    const values = [params.startDate, params.endDate];

    if (params.services && params.services.length > 0) {
      query += ` AND service = ANY($3)`;
      values.push(params.services);
    }

    query += ` GROUP BY period, service ORDER BY period DESC`;

    const result = await this.db.query(query, values);
    return result.rows;
  }

  async getAuditTrail(entityId, entityType) {
    const result = await this.db.query(
      `
      SELECT * FROM chronicle_events
      WHERE metadata->>'entityId' = $1
        AND metadata->>'entityType' = $2
      ORDER BY timestamp ASC
    `,
      [entityId, entityType],
    );

    return result.rows;
  }

  async getStatistics(startDate, endDate) {
    const result = await this.db.query(
      `
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT service) as service_count,
        COUNT(DISTINCT user_id) as user_count,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM chronicle_events
      WHERE ($1::timestamptz IS NULL OR timestamp >= $1)
        AND ($2::timestamptz IS NULL OR timestamp <= $2)
    `,
      [startDate || null, endDate || null],
    );

    return result.rows[0];
  }

  async getServiceHealth() {
    const result = await this.db.query(`
      SELECT
        service,
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'failed')::numeric /
          NULLIF(COUNT(*), 0) * 100,
          2
        ) as error_rate,
        MAX(timestamp) as last_event
      FROM chronicle_events
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY service
      ORDER BY error_rate DESC NULLS LAST
    `);

    return result.rows;
  }
}
