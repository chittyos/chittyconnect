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
import { chittydisputesRoutes } from "./routes/chittydisputes.js";
import { chittytrackRoutes } from "./routes/chittytrack.js";
import { chittyauthRoutes } from "./routes/chittyauth.js";
import { chittyfinanceRoutes } from "./routes/chittyfinance.js";
import { chittycontextualRoutes } from "./routes/chittycontextual.js";
import { chittychronicleRoutes } from "./routes/chittychronicle.js";
import { chittyqualityRoutes } from "./routes/chittyquality.js";
import { chittysyncRoutes } from "./routes/chittysync.js";
import { chittyevidenceRoutes } from "./routes/chittyevidence.js";
import { registryRoutes } from "./routes/registry.js";
import { servicesRoutes } from "./routes/services.js";
import { thirdpartyRoutes } from "./routes/thirdparty.js";
import { credentialsRoutes } from "./routes/credentials.js";
import { intelligence } from "./routes/intelligence.js";
import { mcpRoutes } from "./routes/mcp.js";
import { chatgptMcp } from "./routes/chatgpt-mcp.js";
import contextRoutes from "./routes/context.js";
import filesRoutes from "./routes/files.js";
import tasksRoutes from "./routes/tasks.js";
import { dashboard } from "./routes/dashboard.js";
import contextResolution from "./routes/context-resolution.js";
import contextIntelligence from "./routes/context-intelligence.js";
import { authenticate } from "./middleware/auth.js";
import { autoRateLimit } from "./middleware/rateLimit.js";

const api = new Hono();

// Middleware
api.use("*", logger());
api.use(
  "*",
  cors({
    origin: [
      "https://chat.openai.com",
      "https://chatgpt.com",
      "https://chittyconnect-ui.pages.dev",
      /\.chittyconnect-ui\.pages\.dev$/,
      "https://dashboard.chitty.cc",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-ChittyOS-API-Key", "X-ChittyID", "Mcp-Session-Id", "Mcp-Protocol-Version"],
    exposeHeaders: ["Content-Length", "X-Request-ID", "Mcp-Session-Id"],
    maxAge: 86400,
    credentials: true,
  }),
);

// Authentication middleware for all API routes
api.use("/api/*", authenticate);

// Rate limiting for intelligence endpoints
api.use("/api/v1/intelligence/*", autoRateLimit());

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
      chittydisputes: "/api/chittydisputes",
      chittytrack: "/api/chittytrack",
      chittyauth: "/api/chittyauth",
      chittyfinance: "/api/chittyfinance",
      chittycontextual: "/api/chittycontextual",
      chittychronicle: "/api/chittychronicle",
      chittyquality: "/api/chittyquality",
      chittysync: "/api/chittysync",
      chittyevidence: "/api/chittyevidence",
      registry: "/api/registry",
      services: "/api/services",
      thirdparty: "/api/thirdparty",
      credentials: "/api/credentials",
      intelligence: "/api/intelligence",
      dashboard: "/api/dashboard",
      contextResolution: "/api/v1/context",
      githubActions: "/api/github-actions",
      mcp: "/mcp",
      chatgptMcp: "/chatgpt/mcp",
    },
  });
});

// OpenAPI spec endpoint - serve from public directory
// Note: Import attributes not yet supported by ESLint parser, so we use fetch
api.get("/openapi.json", async (c) => {
  try {
    // Fetch the OpenAPI spec from the public directory
    // In Workers, this will be served from the asset binding
    const url = new URL("../../public/openapi.json", import.meta.url);
    const response = await fetch(url.href);
    const openapiSpec = await response.json();

    // Set proper CORS headers for OpenAPI spec
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Content-Type", "application/json");

    return c.json(openapiSpec);
  } catch (error) {
    console.error("[OpenAPI] Failed to load spec:", error);
    return c.json(
      {
        error: "OpenAPI spec not available",
        message: error.message,
      },
      500,
    );
  }
});

// Route handlers
api.route("/api/chittyid", chittyidRoutes);
api.route("/api/chittycases", chittycasesRoutes);
api.route("/api/chittydisputes", chittydisputesRoutes);
api.route("/api/chittytrack", chittytrackRoutes);
api.route("/api/chittyauth", chittyauthRoutes);
api.route("/api/chittyfinance", chittyfinanceRoutes);
api.route("/api/chittycontextual", chittycontextualRoutes);
api.route("/api/chittychronicle", chittychronicleRoutes);
api.route("/api/chittyquality", chittyqualityRoutes);
api.route("/api/chittysync", chittysyncRoutes);
api.route("/api/chittyevidence", chittyevidenceRoutes);
api.route("/api/registry", registryRoutes);
api.route("/api/services", servicesRoutes);
api.route("/api/thirdparty", thirdpartyRoutes);
api.route("/api/credentials", credentialsRoutes);
api.route("/api/intelligence", intelligence);
api.route("/api/context", contextRoutes);
api.route("/api/context/tasks", tasksRoutes);
api.route("/api/files", filesRoutes);
api.route("/api/dashboard", dashboard);
api.route("/api/v1/context", contextResolution);
api.route("/api/v1/intelligence", contextIntelligence);
api.route("/mcp", mcpRoutes);
api.route("/chatgpt/mcp", chatgptMcp);

export { api };
