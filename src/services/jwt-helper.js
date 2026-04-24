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

/**
 * Encode binary or text input into base64url format.
 *
 * @param {string|ArrayBuffer|Uint8Array|ArrayLike<number>} input - The data to encode. If a string is provided it is UTF-8 encoded; if an ArrayBuffer or byte-like array is provided its bytes are used directly.
 * @returns {string} The base64url-encoded string (uses '-' and '_' instead of '+' and '/', and omits padding).
 */
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

/**
 * Imports a PEM-encoded RSA private key and returns a CryptoKey configured for RSASSA-PKCS1-v1_5 (SHA-256) signing.
 *
 * @param {string} pem - PEM string containing a PKCS#8 private key; PEM headers and whitespace are ignored.
 * @returns {CryptoKey} The imported private key usable for the "sign" operation.
 */
async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, "")
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
