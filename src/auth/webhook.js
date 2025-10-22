/**
 * Webhook signature verification
 *
 * Implements constant-time HMAC-SHA256 verification
 * for GitHub webhook signatures (X-Hub-Signature-256)
 */

/**
 * Verify GitHub webhook signature
 * @param {ArrayBuffer} body - Raw request body
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {string} secret - Webhook secret
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(body, signature, secret) {
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected = await signHmac(secret, body);
  return constantTimeEqual(signature, expected);
}

/**
 * Sign data with HMAC-SHA256
 * @param {string} secret
 * @param {ArrayBuffer} data
 * @returns {Promise<string>} Signature in format "sha256=<hex>"
 */
async function signHmac(secret, data) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign("HMAC", key, data);
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return "sha256=" + hex;
}

/**
 * Constant-time string comparison
 * Prevents timing attacks on signature verification
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }

  return result === 0;
}
