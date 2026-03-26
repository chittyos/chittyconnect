/**
 * ChittyOS Service Catalog
 *
 * Single source of truth for known ChittyOS services and their subdomains.
 * URLs are derived from CHITTYOS_DOMAIN env var (default: chitty.cc).
 *
 * @module lib/service-catalog
 */

// Subdomain map — id is the canonical service ID, sub is the subdomain prefix
const SERVICE_ENTRIES = [
  { id: "chittyid", sub: "id" },
  { id: "chittyauth", sub: "auth" },
  { id: "chittygateway", sub: "gateway" },
  { id: "chittyrouter", sub: "router" },
  { id: "chittyregistry", sub: "registry" },
  { id: "chittycases", sub: "cases" },
  { id: "chittyfinance", sub: "finance" },
  { id: "chittyevidence", sub: "evidence" },
  { id: "chittysync", sub: "sync" },
  { id: "chittychronicle", sub: "chronicle" },
  { id: "chittycontextual", sub: "contextual" },
  { id: "chittyschema", sub: "schema" },
  { id: "chittytrust", sub: "trust" },
  { id: "chittyscore", sub: "score" },
  { id: "chittychain", sub: "chain" },
  { id: "chittyledger", sub: "ledger" },
  { id: "chittydisputes", sub: "disputes" },
  { id: "chittytrack", sub: "track" },
  { id: "chittytask", sub: "tasks" },
];

/**
 * Get the full service catalog with resolved URLs.
 *
 * @param {object} env - Worker environment bindings
 * @returns {Array<{id: string, url: string}>}
 */
export function getServiceCatalog(env = {}) {
  const domain = env.CHITTYOS_DOMAIN || "chitty.cc";
  return SERVICE_ENTRIES.map(({ id, sub }) => ({
    id,
    url: `https://${sub}.${domain}`,
  }));
}

/**
 * Look up a single service URL by ID.
 *
 * @param {object} env - Worker environment bindings
 * @param {string} serviceId - e.g. "chittychronicle"
 * @returns {string|null} Full URL or null if not found
 */
export function getServiceUrl(env = {}, serviceId) {
  const entry = SERVICE_ENTRIES.find((s) => s.id === serviceId);
  if (!entry) return null;
  const domain = env.CHITTYOS_DOMAIN || "chitty.cc";
  return `https://${entry.sub}.${domain}`;
}
