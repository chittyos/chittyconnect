/**
 * Authenticated read-only external legal-vault routes.
 *
 * Mounted at /api/thirdparty/legal-vault. The global /api/* authentication
 * middleware runs before these routes; this layer adds an explicit principal
 * allowlist because legal client-vault access is narrower than ordinary
 * ChittyConnect API access.
 */

import { Hono } from "hono";
import {
  LegalVaultConnectorError,
  getLegalVaultRuntimeState,
  legalVaultPrincipalAuthorized,
  probeLegalVault,
  proxyLegalVaultResponse,
  readLegalVault,
} from "../../integrations/external-legal-vault.js";

const legalVaultRoutes = new Hono();

legalVaultRoutes.use("*", async (c, next) => {
  if (!legalVaultPrincipalAuthorized(c.get("apiKey"), c.env)) {
    return c.json(
      {
        error: "Forbidden",
        code: "LEGAL_VAULT_PRINCIPAL_NOT_ALLOWED",
      },
      403,
    );
  }
  await next();
});

legalVaultRoutes.get("/status", (c) => {
  return c.json({
    status: "ok",
    service: "external-legal-vault",
    access: "read-only",
    runtime: getLegalVaultRuntimeState(c.env),
  });
});

legalVaultRoutes.get("/probe", async (c) => {
  try {
    const result = await probeLegalVault(c.env, {
      path: c.req.query("path"),
    });
    return c.json(result);
  } catch (error) {
    return legalVaultError(c, error);
  }
});

legalVaultRoutes.get("/read", async (c) => {
  try {
    const response = await readLegalVault(c.env, {
      path: c.req.query("path"),
    });
    return proxyLegalVaultResponse(response);
  } catch (error) {
    return legalVaultError(c, error);
  }
});

function legalVaultError(c, error) {
  if (error instanceof LegalVaultConnectorError) {
    return c.json(
      {
        error: error.message,
        code: error.code,
      },
      error.status,
    );
  }

  console.error("[legal-vault] connector failure", {
    name: error?.name || "Error",
  });
  return c.json(
    {
      error: "External legal-vault connector failed",
      code: "LEGAL_VAULT_CONNECTOR_FAILED",
    },
    500,
  );
}

export { legalVaultRoutes };
