/**
 * GitHub App Utilities
 *
 * - HMAC signature verification (constant-time)
 * - JWT generation for GitHub App authentication
 * - Installation token management
 */

/**
 * Verify GitHub webhook signature (constant-time comparison)
 */
export async function verifySignature(payload, signature, secret) {
  try {
    // GitHub sends: sha256=<hex>
    const expectedSignature = signature.replace('sha256=', '');

    // Compute HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );

    // Convert to hex
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison
    return constantTimeCompare(computedSignature, expectedSignature);

  } catch (error) {
    console.error('[GitHub Utils] Signature verification failed:', error.message);
    return false;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Generate GitHub App JWT for authentication
 */
export async function generateAppJWT(appId, privateKey) {
  try {
    // JWT header
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    // JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 60 seconds in the past to account for clock skew
      exp: now + 600, // Expires in 10 minutes
      iss: appId
    };

    // Encode header and payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));

    // Create signature
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    // Import private key
    const key = await importPrivateKey(privateKey);

    // Sign with RS256
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      key,
      encoder.encode(dataToSign)
    );

    const encodedSignature = base64UrlEncode(signature);

    return `${dataToSign}.${encodedSignature}`;

  } catch (error) {
    console.error('[GitHub Utils] JWT generation failed:', error.message);
    throw error;
  }
}

/**
 * Import RSA private key from PEM format
 */
async function importPrivateKey(pemKey) {
  try {
    // Remove PEM header/footer and newlines
    const pemContents = pemKey
      .replace(/-----BEGIN [A-Z ]+-----/, '')
      .replace(/-----END [A-Z ]+-----/, '')
      .replace(/\s/g, '');

    // Decode base64
    const binaryDer = base64Decode(pemContents);

    // Import key
    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['sign']
    );

  } catch (error) {
    console.error('[GitHub Utils] Private key import failed:', error.message);
    throw error;
  }
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(data) {
  let base64;

  if (typeof data === 'string') {
    base64 = btoa(data);
  } else if (data instanceof ArrayBuffer) {
    base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  } else {
    throw new Error('Unsupported data type for base64 encoding');
  }

  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64 decode
 */
function base64Decode(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Get installation access token
 * Caches tokens in TOKEN_KV (1 hour expiration)
 */
export async function getInstallationToken(env, installationId) {
  try {
    // Check cache first
    const cacheKey = `gh:token:${installationId}`;
    const cachedToken = await env.TOKEN_KV.get(cacheKey);

    if (cachedToken) {
      console.log(`[GitHub Utils] Using cached token for installation ${installationId}`);
      return cachedToken;
    }

    // Generate new token
    console.log(`[GitHub Utils] Fetching new token for installation ${installationId}`);

    // Generate App JWT
    const jwt = await generateAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);

    // Request installation token
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ChittyConnect/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get installation token: ${response.status}`);
    }

    const data = await response.json();
    const token = data.token;

    // Cache token (55 minutes - tokens expire in 1 hour)
    await env.TOKEN_KV.put(cacheKey, token, { expirationTtl: 3300 });

    return token;

  } catch (error) {
    console.error('[GitHub Utils] Get installation token failed:', error.message);
    throw error;
  }
}

/**
 * Get installation details
 */
export async function getInstallationDetails(env, installationId) {
  try {
    const jwt = await generateAppJWT(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ChittyConnect/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get installation details: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    console.error('[GitHub Utils] Get installation details failed:', error.message);
    throw error;
  }
}

/**
 * Make authenticated GitHub API request for installation
 */
export async function makeGitHubRequest(env, installationId, endpoint, options = {}) {
  try {
    const token = await getInstallationToken(env, installationId);

    const response = await fetch(`https://api.github.com${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChittyConnect/1.0',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    console.error('[GitHub Utils] API request failed:', error.message);
    throw error;
  }
}
