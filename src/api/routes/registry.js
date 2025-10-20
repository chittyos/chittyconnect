/**
 * ChittyRegistry API Routes
 */

import { Hono } from 'hono';

const registryRoutes = new Hono();

/**
 * GET /api/registry/services
 * List all registered services
 */
registryRoutes.get('/services', async (c) => {
  try {
    const response = await fetch('https://registry.chitty.cc/api/services', {
      headers: {
        'Authorization': `Bearer ${c.env.CHITTY_REGISTRY_TOKEN}`
      }
    });

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/registry/services/:serviceId
 * Get service details
 */
registryRoutes.get('/services/:serviceId', async (c) => {
  try {
    const serviceId = c.req.param('serviceId');

    const response = await fetch(`https://registry.chitty.cc/api/services/${serviceId}`, {
      headers: {
        'Authorization': `Bearer ${c.env.CHITTY_REGISTRY_TOKEN}`
      }
    });

    if (!response.ok) {
      throw new Error(`ChittyRegistry service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { registryRoutes };
