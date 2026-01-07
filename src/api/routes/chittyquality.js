/**
 * ChittyQuality API Routes
 * Document quality validation and quality gate system
 */

import { Hono } from "hono";
import { ChittyQualityEngine, QualityRules } from "../../services/quality-engine.js";

const chittyqualityRoutes = new Hono();

// Rate limiting helper
let requestCounts = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const limit = requestCounts.get(ip);

  if (!limit || now > limit.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (limit.count >= 60) {
    return false;
  }

  limit.count++;
  return true;
}

/**
 * GET /api/chittyquality
 * Health check
 */
chittyqualityRoutes.get("/", (c) => {
  return c.json({
    service: 'ChittyQuality',
    version: '1.0.0',
    status: 'healthy',
    description: 'Document quality validation and quality gate system'
  });
});

/**
 * POST /api/chittyquality/validate
 * Validate single document
 */
chittyqualityRoutes.post("/validate", async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  if (!rateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const body = await c.req.json();
    const { filename, filesize, content, metadata } = body;

    if (!filename || !content) {
      return c.json({ error: 'filename and content are required' }, 400);
    }

    const engine = new ChittyQualityEngine();
    const result = await engine.validateDocument({
      name: filename,
      size: filesize || content.length,
      content,
      metadata
    });

    return c.json(result);
  } catch (error) {
    console.error('Error validating document:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyquality/validate/batch
 * Validate multiple documents
 */
chittyqualityRoutes.post("/validate/batch", async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  if (!rateLimit(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  try {
    const body = await c.req.json();
    const { files } = body;

    if (!files || !Array.isArray(files)) {
      return c.json({ error: 'files array is required' }, 400);
    }

    const engine = new ChittyQualityEngine();
    const results = await Promise.all(
      files.map((file) => engine.validateDocument({
        name: file.filename,
        size: file.filesize || file.content?.length || 0,
        content: file.content,
        metadata: file.metadata
      }))
    );

    const summary = {
      total: results.length,
      approved: results.filter(r => r.recommendation === 'approve').length,
      quarantined: results.filter(r => r.recommendation === 'quarantine').length,
      rejected: results.filter(r => r.recommendation === 'reject').length,
      details: results
    };

    return c.json(summary);
  } catch (error) {
    console.error('Error in batch validation:', error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyquality/rules
 * Get validation rules configuration
 */
chittyqualityRoutes.get("/rules", (c) => {
  return c.json(QualityRules);
});

export { chittyqualityRoutes };
