/**
 * JWT Helper — RS256 signing using Web Crypto API
 * For service account assertion flows (Google, etc.)
 *
 * @canonical-uri chittycanon://core/services/chittyconnect#jwt-helper
 */

/**
 * Create a JWT signed with RS256 using the Web Crypto API.
 *
 * @param {object} claims - JWT payload claims.
 * @param {string} privateKeyPem - PEM-encoded PKCS#8 RSA private key.
 * @returns {Promise<string>} The signed JWT in compact serialization (header.payload.signature).
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
 * Encode a string or binary data to Base64url.
 *
 * Accepts a UTF-8 string, an ArrayBuffer, or a Uint8Array and returns its
 * Base64url-encoded representation (RFC 4648 §5) with padding removed.
 *
 * @param {string|ArrayBuffer|Uint8Array} input - Data to encode; strings are UTF-8 encoded.
 * @returns {string} The Base64url-encoded string (characters '+' -> '-', '/' -> '_', no '=' padding).
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
 * Imports a PKCS#8 PEM-encoded RSA private key into the Web Crypto API as a signing key.
 *
 * @param {string} pem - PEM-formatted private key (PKCS#8), may include `-----BEGIN/END (RSA )?PRIVATE KEY-----` wrappers and whitespace.
 * @returns {CryptoKey} A non-extractable `CryptoKey` configured for `RSASSA-PKCS1-v1_5` with `SHA-256` and usable for signing.
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
