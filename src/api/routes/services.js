/**
 * Services Status API Routes
 */

import { Hono } from "hono";

const servicesRoutes = new Hono();

const CHITTYOS_SERVICES = [
  { id: "chittyid", url: "https://id.chitty.cc" },
  { id: "chittyauth", url: "https://auth.chitty.cc" },
  { id: "chittygateway", url: "https://gateway.chitty.cc" },
  { id: "chittyrouter", url: "https://router.chitty.cc" },
  { id: "chittyregistry", url: "https://registry.chitty.cc" },
  { id: "chittycases", url: "https://cases.chitty.cc" },
  { id: "chittyfinance", url: "https://finance.chitty.cc" },
  { id: "chittyevidence", url: "https://evidence.chitty.cc" },
  { id: "chittysync", url: "https://sync.chitty.cc" },
  { id: "chittychronicle", url: "https://chronicle.chitty.cc" },
  { id: "chittycontextual", url: "https://contextual.chitty.cc" },
  { id: "chittyschema", url: "https://schema.chitty.cc" },
  { id: "chittytrust", url: "https://trust.chitty.cc" },
  { id: "chittyscore", url: "https://score.chitty.cc" },
  { id: "chittychain", url: "https://chain.chitty.cc" },
  { id: "chittyledger", url: "https://ledger.chitty.cc" },
];

/**
 * GET /api/services/status
 * Check all ChittyOS services health
 */
servicesRoutes.get("/status", async (c) => {
  try {
    const statusChecks = CHITTYOS_SERVICES.map(async (service) => {
      try {
        const response = await fetch(`${service.url}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });

        return {
          serviceId: service.id,
          name: service.id,
          url: service.url,
          status: response.ok ? "healthy" : "degraded",
          statusCode: response.status,
          lastChecked: new Date().toISOString(),
        };
      } catch (error) {
        return {
          serviceId: service.id,
          name: service.id,
          url: service.url,
          status: "down",
          error: error.message,
          lastChecked: new Date().toISOString(),
        };
      }
    });

    const results = await Promise.all(statusChecks);

    const services = {};
    results.forEach((result) => {
      services[result.serviceId] = result;
    });

    return c.json({ services });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/services/:serviceId/status
 * Check specific service health
 */
servicesRoutes.get("/:serviceId/status", async (c) => {
  try {
    const serviceId = c.req.param("serviceId");
    const service = CHITTYOS_SERVICES.find((s) => s.id === serviceId);

    if (!service) {
      return c.json({ error: "Service not found" }, 404);
    }

    const response = await fetch(`${service.url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    return c.json({
      serviceId: service.id,
      name: service.id,
      url: service.url,
      status: response.ok ? "healthy" : "degraded",
      statusCode: response.status,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { servicesRoutes };
