/**
 * ChittyFinance API Routes
 * Banking connections and financial operations
 */

import { Hono } from "hono";

const chittyfinanceRoutes = new Hono();

/**
 * GET /api/chittyfinance/account/balance
 * Get account balance
 */
chittyfinanceRoutes.get("/account/balance", async (c) => {
  try {
    const accountId = c.req.query("accountId");

    if (!accountId) {
      return c.json({ error: "accountId is required" }, 400);
    }

    // Forward to ChittyFinance service
    const response = await fetch(
      `https://finance.chitty.cc/api/accounts/${accountId}/balance`,
      {
        headers: {
          Authorization: `Bearer ${c.env.CHITTY_FINANCE_TOKEN}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyFinance service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyfinance/banking/connect
 * Connect external banking account
 */
chittyfinanceRoutes.post("/banking/connect", async (c) => {
  try {
    const { provider, publicToken, accountDetails } = await c.req.json();

    if (!provider) {
      return c.json({ error: "provider is required" }, 400);
    }

    const validProviders = ["plaid", "stripe", "direct"];
    if (!validProviders.includes(provider)) {
      return c.json({ error: "Invalid provider" }, 400);
    }

    // Forward to ChittyFinance banking integration
    const response = await fetch(
      "https://finance.chitty.cc/api/banking/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.CHITTY_FINANCE_TOKEN}`,
        },
        body: JSON.stringify({ provider, publicToken, accountDetails }),
      },
    );

    if (!response.ok) {
      throw new Error(`ChittyFinance service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyfinance/accounts
 * List all connected accounts
 */
chittyfinanceRoutes.get("/accounts", async (c) => {
  try {
    const response = await fetch("https://finance.chitty.cc/api/accounts", {
      headers: {
        Authorization: `Bearer ${c.env.CHITTY_FINANCE_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`ChittyFinance service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyfinance/transactions
 * Get transactions for an account
 */
chittyfinanceRoutes.post("/transactions", async (c) => {
  try {
    const { accountId, startDate, endDate, limit } = await c.req.json();

    if (!accountId) {
      return c.json({ error: "accountId is required" }, 400);
    }

    const response = await fetch("https://finance.chitty.cc/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.CHITTY_FINANCE_TOKEN}`,
      },
      body: JSON.stringify({ accountId, startDate, endDate, limit }),
    });

    if (!response.ok) {
      throw new Error(`ChittyFinance service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittyfinanceRoutes };
