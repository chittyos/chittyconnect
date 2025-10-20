/**
 * ChittyContextual API Routes
 * Contextual analysis and AI-powered insights
 */

import { Hono } from 'hono';

const chittycontextualRoutes = new Hono();

/**
 * POST /api/chittycontextual/analyze
 * Perform contextual analysis
 */
chittycontextualRoutes.post('/analyze', async (c) => {
  try {
    const { text, context, analysisType = 'comprehensive' } = await c.req.json();

    if (!text) {
      return c.json({ error: 'text is required' }, 400);
    }

    const validTypes = ['sentiment', 'entities', 'legal', 'financial', 'comprehensive'];
    if (!validTypes.includes(analysisType)) {
      return c.json({ error: 'Invalid analysisType' }, 400);
    }

    // Forward to ChittyContextual service
    const response = await fetch('https://contextual.chitty.cc/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.CHITTY_CONTEXTUAL_TOKEN}`
      },
      body: JSON.stringify({ text, context, analysisType })
    });

    if (!response.ok) {
      throw new Error(`ChittyContextual service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittycontextual/extract
 * Extract entities and metadata from text
 */
chittycontextualRoutes.post('/extract', async (c) => {
  try {
    const { text, entityTypes } = await c.req.json();

    if (!text) {
      return c.json({ error: 'text is required' }, 400);
    }

    const response = await fetch('https://contextual.chitty.cc/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.CHITTY_CONTEXTUAL_TOKEN}`
      },
      body: JSON.stringify({ text, entityTypes })
    });

    if (!response.ok) {
      throw new Error(`ChittyContextual service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittycontextualRoutes };
