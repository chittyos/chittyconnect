/**
 * Memory authorization gate.
 *
 * Memory scope is selected by the active session -> Synthetic Person binding.
 * Authorization is separately derived from the authenticated principal.
 * A caller-provided session ID or X-ChittyID header never grants access alone.
 */

export async function authorizeMemorySession(c, memory, sessionId) {
  if (!memory || !sessionId) {
    const error = new Error("Memory authorization requires memory and sessionId");
    error.code = "MEMORY_AUTH_INVALID";
    error.status = 400;
    throw error;
  }

  const boundPersonId = await memory.resolveSessionSyntheticPerson(sessionId);
  if (!boundPersonId) {
    const error = new Error(
      "Session is not bound to an active Synthetic Person",
    );
    error.code = "MEMORY_SCOPE_UNRESOLVED";
    error.status = 403;
    throw error;
  }

  const keyInfo = c.get("apiKey") || {};
  const candidates = [
    keyInfo.userId,
    keyInfo.chittyId,
    keyInfo.metadata?.chittyId,
    keyInfo.metadata?.syntheticPersonId,
  ].filter((value) => memory.isCanonicalPersonId(value));

  if (candidates.length === 0) {
    const error = new Error(
      "Authenticated principal is not bound to a canonical Synthetic Person",
    );
    error.code = "MEMORY_PRINCIPAL_UNBOUND";
    error.status = 403;
    throw error;
  }

  if (!candidates.includes(boundPersonId)) {
    const error = new Error(
      "Authenticated principal does not own the requested memory scope",
    );
    error.code = "MEMORY_SCOPE_FORBIDDEN";
    error.status = 403;
    throw error;
  }

  const assertedChittyId = c.req.header("X-ChittyID");
  if (
    assertedChittyId &&
    (!memory.isCanonicalPersonId(assertedChittyId) ||
      assertedChittyId !== boundPersonId)
  ) {
    const error = new Error(
      "X-ChittyID does not match the authenticated session memory scope",
    );
    error.code = "MEMORY_IDENTITY_MISMATCH";
    error.status = 403;
    throw error;
  }

  return boundPersonId;
}

export function memoryAuthorizationResponse(c, error) {
  return c.json(
    {
      success: false,
      error: error.code || "MEMORY_AUTH_FAILED",
      message: error.message,
    },
    error.status || 403,
  );
}
