/**
 * Services Status API Routes
 */

import { Hono } from "hono";
import { getServiceCatalog } from "../../lib/service-catalog.js";

const servicesRoutes = new Hono();

/**
 * GET /api/services/status
 * Check all ChittyOS services health
 */
servicesRoutes.get("/status", async (c) => {
  try {
    const statusChecks = getServiceCatalog(c.env).map(async (service) => {
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
    const service = getServiceCatalog(c.env).find((s) => s.id === serviceId);

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
