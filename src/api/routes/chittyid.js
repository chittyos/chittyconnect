/**
 * ChittyID API Routes
 * Proxy for ChittyID service (id.chitty.cc)
 *
 * Uses official ChittyIDClient from @chittyfoundation/chittyid
 * ChittyFoundation maintains the minting service and client library.
 */

import { Hono } from "hono";
import { ChittyIDClient, EntityType } from "../../lib/chittyid-client.js";
import { getServiceToken } from "../../lib/credential-helper.js";

const chittyidRoutes = new Hono();

// Legacy entity mapping for backward compatibility
// @canon: chittycanon://gov/governance#core-types
const LEGACY_ENTITY_MAP = {
  // Canonical type codes (P/L/T/E/A)
  P: EntityType.PERSON,
  L: EntityType.PLACE,
  T: EntityType.THING,
  E: EntityType.EVENT,
  A: EntityType.AUTHORITY,
  // Legacy codes (backward compatibility)
  PEO: EntityType.PERSON,
  PLACE: EntityType.PLACE,
  PROP: EntityType.THING,
  EVNT: EntityType.EVENT,
  AUTH: EntityType.AUTHORITY,
  INFO: EntityType.THING,
  FACT: EntityType.THING,
  CONTEXT: EntityType.PERSON, // Contexts are actors with agency (Person, Synthetic)
  ACTOR: EntityType.PERSON,
};

/**
 * POST /api/chittyid/mint
 * Mint a new ChittyID
 *
 * Body: { entity, metadata? }
 * - entity: person | place | thing | event | authority
 * - metadata: { region?, jurisdiction?, trust? }
 */
chittyidRoutes.post("/mint", async (c) => {
  try {
    const { entity, metadata = {} } = await c.req.json();

    if (!entity) {
      return c.json({ error: "entity is required" }, 400);
    }

    // Map legacy entity types
    const entityType = LEGACY_ENTITY_MAP[entity] || entity.toLowerCase();

    // Get service token for authenticated minting
    const serviceToken = await getServiceToken(c.env, "chittyid");

    const client = new ChittyIDClient({
      token: serviceToken,
    });

    const result = await client.mint(entityType, {
      region: metadata.region,
      jurisdiction: metadata.jurisdiction,
      trust: metadata.trust,
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyid/validate
 * Validate a ChittyID
 */
chittyidRoutes.post("/validate", async (c) => {
  try {
    const { chittyid } = await c.req.json();

    if (!chittyid) {
      return c.json({ error: "chittyid is required" }, 400);
    }

    const client = new ChittyIDClient();
    const result = await client.validate(chittyid);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyid/parse/:id
 * Parse ChittyID components (client-side, no network call)
 */
chittyidRoutes.get("/parse/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const components = ChittyIDClient.parse(id);

    if (!components) {
      return c.json({ error: "Invalid ChittyID format" }, 400);
    }

    return c.json({
      success: true,
      chittyId: id,
      components,
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyid/spec
 * Get ChittyID specification
 */
chittyidRoutes.get("/spec", async (c) => {
  try {
    const client = new ChittyIDClient();
    const result = await client.getSpec();
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/chittyid/health
 * Check ChittyID service health
 */
chittyidRoutes.get("/health", async (c) => {
  try {
    const client = new ChittyIDClient();
    const result = await client.health();
    return c.json(result);
  } catch (error) {
    return c.json({ error: error.message, healthy: false }, 500);
  }
});

export { chittyidRoutes };
