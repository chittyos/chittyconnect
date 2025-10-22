/**
 * ChittyOS GPT Connector - Main API Router
 *
 * Comprehensive API for custom GPT integration with all ChittyOS services
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { chittyidRoutes } from "./routes/chittyid.js";
import { chittycasesRoutes } from "./routes/chittycases.js";
import { chittyauthRoutes } from "./routes/chittyauth.js";
import { chittyfinanceRoutes } from "./routes/chittyfinance.js";
import { chittycontextualRoutes } from "./routes/chittycontextual.js";
import { chittychronicleRoutes } from "./routes/chittychronicle.js";
import { chittysyncRoutes } from "./routes/chittysync.js";
import { chittyevidenceRoutes } from "./routes/chittyevidence.js";
import { registryRoutes } from "./routes/registry.js";
import { servicesRoutes } from "./routes/services.js";
import { thirdpartyRoutes } from "./routes/thirdparty.js";
import { intelligence } from "./routes/intelligence.js";
import { authenticate } from "./middleware/auth.js";

const api = new Hono();

// Middleware
api.use("*", logger());
api.use(
  "*",
  cors({
    origin: ["https://chat.openai.com", "https://chatgpt.com"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-ChittyOS-API-Key"],
    exposeHeaders: ["Content-Length", "X-Request-ID"],
    maxAge: 86400,
    credentials: true,
  }),
);

// Authentication middleware for all API routes
api.use("/api/*", authenticate);

// CORS preflight handler
api.options("*", (c) => c.text("", 204));

// Health check (no auth required)
api.get("/api/health", (c) => {
  return c.json({
    status: "healthy",
    service: "chittyconnect-gpt-api",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      chittyid: "/api/chittyid",
      chittycases: "/api/chittycases",
      chittyauth: "/api/chittyauth",
      chittyfinance: "/api/chittyfinance",
      chittycontextual: "/api/chittycontextual",
      chittychronicle: "/api/chittychronicle",
      chittysync: "/api/chittysync",
      chittyevidence: "/api/chittyevidence",
      registry: "/api/registry",
      services: "/api/services",
      thirdparty: "/api/thirdparty",
      intelligence: "/api/intelligence",
    },
  });
});

// OpenAPI spec endpoint
api.get("/openapi.json", async (c) => {
  const spec = await c.env.ASSETS.fetch(
    new Request("https://connect.chitty.cc/openapi.json"),
  );
  return spec;
});

// Route handlers
api.route("/api/chittyid", chittyidRoutes);
api.route("/api/chittycases", chittycasesRoutes);
api.route("/api/chittyauth", chittyauthRoutes);
api.route("/api/chittyfinance", chittyfinanceRoutes);
api.route("/api/chittycontextual", chittycontextualRoutes);
api.route("/api/chittychronicle", chittychronicleRoutes);
api.route("/api/chittysync", chittysyncRoutes);
api.route("/api/chittyevidence", chittyevidenceRoutes);
api.route("/api/registry", registryRoutes);
api.route("/api/services", servicesRoutes);
api.route("/api/thirdparty", thirdpartyRoutes);
api.route("/api/intelligence", intelligence);

export { api };
