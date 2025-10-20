/**
 * ChittyAuth API Routes
 * Authentication and authorization
 */

import { Hono } from 'hono';

const chittyauthRoutes = new Hono();

/**
 * POST /api/chittyauth/verify
 * Verify authentication token
 */
chittyauthRoutes.post('/verify', async (c) => {
  try {
    const { token } = await c.req.json();

    if (!token) {
      return c.json({ error: 'token is required' }, 400);
    }

    const response = await fetch('https://auth.chitty.cc/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.CHITTY_AUTH_TOKEN}`
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      throw new Error(`ChittyAuth service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyauth/refresh
 * Refresh access token
 */
chittyauthRoutes.post('/refresh', async (c) => {
  try {
    const { refreshToken } = await c.req.json();

    if (!refreshToken) {
      return c.json({ error: 'refreshToken is required' }, 400);
    }

    const response = await fetch('https://auth.chitty.cc/api/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${c.env.CHITTY_AUTH_TOKEN}`
      },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) {
      throw new Error(`ChittyAuth service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittyauthRoutes };
