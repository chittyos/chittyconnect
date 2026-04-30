/**
 * JWT Helper — RS256 signing using Web Crypto API
 * For service account assertion flows (Google, etc.)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#jwt-helper
 */

/**
 * Create a signed JWT using RS256 (Web Crypto).
 * @param {object} claims - JWT payload claims
 * @param {string} privateKeyPem - PEM-encoded RSA private key
 * @returns {Promise<string>} Signed JWT string
 */
export async function createJwt(claims, privateKeyPem) {
  const header = { alg: "RS256", typ: "JWT" };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = base64url(signature);
  return `${signingInput}.${signatureB64}`;
}

function base64url(input) {
  let data;
  if (typeof input === "string") {
    data = new TextEncoder().encode(input);
  } else if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else {
    data = input;
  }
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  // crypto.subtle.importKey("pkcs8", ...) requires PKCS#8 PEM
  // ("BEGIN PRIVATE KEY"). PKCS#1 ("BEGIN RSA PRIVATE KEY") is a different
  // ASN.1 structure and would fail with DataError. Reject explicitly so
  // callers get a clear error instead of an opaque crypto failure.
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      "PKCS#1 keys are not supported. Convert to PKCS#8 (BEGIN PRIVATE KEY) — e.g. `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in pkcs1.key -out pkcs8.key`.",
    );
  }
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
