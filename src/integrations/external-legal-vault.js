/**
 * External legal client-vault adapter.
 *
 * Provider-specific identity, hostnames, paths, and credential names live only
 * in runtime configuration. Secret material is resolved at the provider
 * execution boundary through ChittySecrets and is never returned by this module.
 */

const DEFAULT_MAX_REDIRECTS = 5;
const HTML_SAMPLE_LIMIT = 256 * 1024;
const LOGIN_MODES = new Set(["auto", "basic", "form"]);

export class LegalVaultConnectorError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "LegalVaultConnectorError";
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, name) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_MISSING",
      `${name} is not configured`,
      503,
    );
  }
  return result;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathPrefix(value) {
  const prefix = requiredString(value, "LEGAL_VAULT_PATH_PREFIX");
  if (!prefix.startsWith("/") || prefix.includes("..")) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      "LEGAL_VAULT_PATH_PREFIX must be an absolute path without traversal",
      503,
    );
  }
  return prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
}

function assertHttpsUrl(url, name) {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_DESTINATION_BLOCKED",
      `${name} must be an HTTPS URL without embedded credentials`,
      400,
    );
  }
}

function parseOptionalJsonObject(value, name) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      `${name} must be valid JSON`,
      503,
    );
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      `${name} must be a JSON object`,
      503,
    );
  }
  const safe = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== "string") {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_CONFIG_INVALID",
        `${name} values must be strings`,
        503,
      );
    }
    safe[key] = entry;
  }
  return safe;
}

export function getLegalVaultRuntimeState(env = {}) {
  const allowedHosts = parseCsv(env.LEGAL_VAULT_ALLOWED_HOSTS);
  const allowedPrincipals = parseCsv(env.LEGAL_VAULT_ALLOWED_PRINCIPALS);
  const mode = String(env.LEGAL_VAULT_LOGIN_MODE || "auto").trim().toLowerCase();
  return {
    configured:
      Boolean(env.LEGAL_VAULT_BASE_URL) &&
      Boolean(env.LEGAL_VAULT_PATH_PREFIX) &&
      allowedHosts.length > 0 &&
      Boolean(env.LEGAL_VAULT_LOGIN_EMAIL) &&
      Boolean(env.LEGAL_VAULT_PASSWORD_SECRET_NAME) &&
      Boolean(env.LEGAL_VAULT_PASSWORD_CREDENTIAL_REF),
    principal_gate_configured: allowedPrincipals.length > 0,
    provider_allowlist_configured: allowedHosts.length > 0,
    login_mode: LOGIN_MODES.has(mode) ? mode : "invalid",
    form_login_configured:
      Boolean(env.LEGAL_VAULT_LOGIN_URL) &&
      Boolean(env.LEGAL_VAULT_USERNAME_FIELD) &&
      Boolean(env.LEGAL_VAULT_PASSWORD_FIELD),
  };
}

export function getLegalVaultConfig(env = {}) {
  const baseUrl = new URL(
    requiredString(env.LEGAL_VAULT_BASE_URL, "LEGAL_VAULT_BASE_URL"),
  );
  assertHttpsUrl(baseUrl, "LEGAL_VAULT_BASE_URL");

  const pathPrefix = normalizePathPrefix(env.LEGAL_VAULT_PATH_PREFIX);
  const allowedHosts = new Set(
    parseCsv(env.LEGAL_VAULT_ALLOWED_HOSTS).map((host) => host.toLowerCase()),
  );
  if (allowedHosts.size === 0) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_MISSING",
      "LEGAL_VAULT_ALLOWED_HOSTS is not configured",
      503,
    );
  }
  if (!allowedHosts.has(baseUrl.hostname.toLowerCase())) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      "LEGAL_VAULT_BASE_URL host is not in LEGAL_VAULT_ALLOWED_HOSTS",
      503,
    );
  }

  const loginMode = String(env.LEGAL_VAULT_LOGIN_MODE || "auto")
    .trim()
    .toLowerCase();
  if (!LOGIN_MODES.has(loginMode)) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      "LEGAL_VAULT_LOGIN_MODE must be auto, basic, or form",
      503,
    );
  }

  const loginUrl = env.LEGAL_VAULT_LOGIN_URL
    ? new URL(String(env.LEGAL_VAULT_LOGIN_URL))
    : null;
  if (loginUrl) {
    assertHttpsUrl(loginUrl, "LEGAL_VAULT_LOGIN_URL");
    if (!allowedHosts.has(loginUrl.hostname.toLowerCase())) {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_CONFIG_INVALID",
        "LEGAL_VAULT_LOGIN_URL host is not in LEGAL_VAULT_ALLOWED_HOSTS",
        503,
      );
    }
  }

  const loginPostUrl = env.LEGAL_VAULT_LOGIN_POST_URL
    ? new URL(String(env.LEGAL_VAULT_LOGIN_POST_URL))
    : null;
  if (loginPostUrl) {
    assertHttpsUrl(loginPostUrl, "LEGAL_VAULT_LOGIN_POST_URL");
    if (!allowedHosts.has(loginPostUrl.hostname.toLowerCase())) {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_CONFIG_INVALID",
        "LEGAL_VAULT_LOGIN_POST_URL host is not in LEGAL_VAULT_ALLOWED_HOSTS",
        503,
      );
    }
  }

  const secretName = requiredString(
    env.LEGAL_VAULT_PASSWORD_SECRET_NAME,
    "LEGAL_VAULT_PASSWORD_SECRET_NAME",
  ).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(secretName)) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      "LEGAL_VAULT_PASSWORD_SECRET_NAME is invalid",
      503,
    );
  }

  const credentialRef = requiredString(
    env.LEGAL_VAULT_PASSWORD_CREDENTIAL_REF,
    "LEGAL_VAULT_PASSWORD_CREDENTIAL_REF",
  );
  if (!credentialRef.startsWith("chittysecrets://")) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CONFIG_INVALID",
      "LEGAL_VAULT_PASSWORD_CREDENTIAL_REF must use chittysecrets://",
      503,
    );
  }

  return {
    baseUrl,
    pathPrefix,
    allowedHosts,
    loginMode,
    loginUrl,
    loginPostUrl,
    loginEmail: requiredString(
      env.LEGAL_VAULT_LOGIN_EMAIL,
      "LEGAL_VAULT_LOGIN_EMAIL",
    ),
    usernameField: env.LEGAL_VAULT_USERNAME_FIELD
      ? String(env.LEGAL_VAULT_USERNAME_FIELD)
      : null,
    passwordField: env.LEGAL_VAULT_PASSWORD_FIELD
      ? String(env.LEGAL_VAULT_PASSWORD_FIELD)
      : null,
    csrfField: env.LEGAL_VAULT_CSRF_FIELD
      ? String(env.LEGAL_VAULT_CSRF_FIELD)
      : null,
    extraFields: parseOptionalJsonObject(
      env.LEGAL_VAULT_LOGIN_EXTRA_FIELDS,
      "LEGAL_VAULT_LOGIN_EXTRA_FIELDS",
    ),
    secretName,
    credentialRef,
    maxRedirects: Math.min(
      10,
      Math.max(0, Number(env.LEGAL_VAULT_MAX_REDIRECTS || DEFAULT_MAX_REDIRECTS)),
    ),
  };
}

export function legalVaultPrincipalAuthorized(keyInfo, env = {}) {
  if (!keyInfo || typeof keyInfo !== "object") return false;
  const allowed = new Set(
    parseCsv(env.LEGAL_VAULT_ALLOWED_PRINCIPALS).map((value) =>
      value.toLowerCase(),
    ),
  );
  if (allowed.size === 0) return false;

  const candidates = [
    keyInfo.userId,
    keyInfo.email,
    keyInfo.name,
    keyInfo.subject,
    keyInfo.sub,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase());

  return candidates.some((candidate) => allowed.has(candidate));
}

export function validateLegalVaultProviderUrl(config, input) {
  const url = input instanceof URL ? new URL(input.href) : new URL(String(input));
  assertHttpsUrl(url, "provider URL");
  if (!config.allowedHosts.has(url.hostname.toLowerCase())) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_DESTINATION_BLOCKED",
      "Provider destination host is not allowlisted",
      400,
    );
  }
  return url;
}

export function buildLegalVaultReadUrl(config, requestedPath) {
  let url;
  if (!requestedPath) {
    url = new URL(config.pathPrefix, config.baseUrl.origin);
  } else if (/^https?:\/\//i.test(String(requestedPath))) {
    url = new URL(String(requestedPath));
  } else if (String(requestedPath).startsWith("/")) {
    url = new URL(String(requestedPath), config.baseUrl.origin);
  } else {
    const prefix = config.pathPrefix === "/" ? "" : config.pathPrefix;
    url = new URL(`${prefix}/${String(requestedPath)}`, config.baseUrl.origin);
  }

  validateLegalVaultProviderUrl(config, url);
  if (url.hostname.toLowerCase() !== config.baseUrl.hostname.toLowerCase()) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_DESTINATION_BLOCKED",
      "Read destination must stay on the configured vault host",
      400,
    );
  }
  const inScope =
    url.pathname === config.pathPrefix ||
    url.pathname.startsWith(`${config.pathPrefix}/`);
  if (!inScope) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_DESTINATION_BLOCKED",
      "Read destination is outside the configured vault path",
      400,
    );
  }
  return url;
}

export async function resolveLegalVaultPassword(env, config = getLegalVaultConfig(env)) {
  const broker = env?.SVC_SECRETS;
  if (!broker || typeof broker.resolveReference !== "function") {
    throw new LegalVaultConnectorError(
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
      "ChittySecrets runtime broker is unavailable",
      503,
    );
  }

  let result;
  try {
    result = await broker.resolveReference({
      secretName: config.secretName,
      credentialRef: config.credentialRef,
    });
  } catch {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CREDENTIAL_UNAVAILABLE",
      "Legal vault credential could not be resolved",
      503,
    );
  }

  if (
    !result ||
    result.credentialRef !== config.credentialRef ||
    typeof result.value !== "string" ||
    !result.value
  ) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_CREDENTIAL_UNAVAILABLE",
      "Legal vault credential resolution returned an invalid result",
      503,
    );
  }

  return result.value;
}

function readSetCookies(headers) {
  if (typeof headers?.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers?.get?.("set-cookie");
  return raw ? [raw] : [];
}

function parseSetCookie(header, responseUrl) {
  const parts = String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || !parts[0].includes("=")) return null;

  const separator = parts[0].indexOf("=");
  const name = parts[0].slice(0, separator).trim();
  const value = parts[0].slice(separator + 1);
  if (!name) return null;

  let domain = responseUrl.hostname.toLowerCase();
  let hostOnly = true;
  let path = "/";
  let secure = false;

  for (const part of parts.slice(1)) {
    const [rawName, ...rawValue] = part.split("=");
    const attr = rawName.trim().toLowerCase();
    const attrValue = rawValue.join("=").trim();
    if (attr === "domain" && attrValue) {
      const candidate = attrValue.replace(/^\./, "").toLowerCase();
      const responseHost = responseUrl.hostname.toLowerCase();
      if (
        responseHost === candidate ||
        responseHost.endsWith(`.${candidate}`)
      ) {
        domain = candidate;
        hostOnly = false;
      }
    } else if (attr === "path" && attrValue.startsWith("/")) {
      path = attrValue;
    } else if (attr === "secure") {
      secure = true;
    }
  }

  return { name, value, domain, hostOnly, path, secure };
}

function captureCookies(jar, headers, responseUrl) {
  for (const header of readSetCookies(headers)) {
    const cookie = parseSetCookie(header, responseUrl);
    if (!cookie) continue;
    jar.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
  }
}

function cookieApplies(cookie, url) {
  if (cookie.secure && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const domainMatches = cookie.hostOnly
    ? host === cookie.domain
    : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
  if (!domainMatches) return false;
  return url.pathname.startsWith(cookie.path);
}

function cookieHeader(jar, url) {
  return [...jar.values()]
    .filter((cookie) => cookieApplies(cookie, url))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function cloneHeaders(headers = {}) {
  return new Headers(headers);
}

async function requestWithRedirects(
  fetchImpl,
  config,
  initialUrl,
  initialInit = {},
  jar = new Map(),
) {
  let url = validateLegalVaultProviderUrl(config, initialUrl);
  let method = String(initialInit.method || "GET").toUpperCase();
  let body = initialInit.body;
  let headers = cloneHeaders(initialInit.headers);

  for (let redirectCount = 0; ; redirectCount += 1) {
    if (redirectCount > config.maxRedirects) {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_REDIRECT_LIMIT",
        "Provider redirect limit exceeded",
        502,
      );
    }

    const requestHeaders = cloneHeaders(headers);
    const cookies = cookieHeader(jar, url);
    if (cookies) requestHeaders.set("Cookie", cookies);

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        ...initialInit,
        method,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        headers: requestHeaders,
        redirect: "manual",
      });
    } catch {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_PROVIDER_UNREACHABLE",
        "Legal vault provider request failed",
        502,
      );
    }

    captureCookies(jar, response.headers, url);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, url, jar };
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_PROVIDER_INVALID_RESPONSE",
        "Provider returned a redirect without a Location header",
        502,
      );
    }

    const nextUrl = validateLegalVaultProviderUrl(
      config,
      new URL(location, url),
    );

    if (nextUrl.hostname.toLowerCase() !== url.hostname.toLowerCase()) {
      headers.delete("Authorization");
    }

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== "GET" &&
        method !== "HEAD")
    ) {
      method = "GET";
      body = undefined;
      headers.delete("Content-Type");
    }

    url = nextUrl;
  }
}

function parseInputAttributes(tag) {
  const attrs = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function inputTags(html) {
  return String(html).match(/<input\b[^>]*>/gi) || [];
}

function hasPasswordInput(html) {
  return inputTags(html).some(
    (tag) => parseInputAttributes(tag).type?.toLowerCase() === "password",
  );
}

function hiddenInputValue(html, fieldName) {
  for (const tag of inputTags(html)) {
    const attrs = parseInputAttributes(tag);
    if (attrs.name === fieldName) return attrs.value || "";
  }
  return null;
}

async function inspectAuthSurface(response) {
  const contentType = response.headers.get("content-type") || "";
  const challenge = response.headers.get("www-authenticate") || "";
  if (response.status === 401 && /\bbasic\b/i.test(challenge)) {
    return { kind: "basic", contentType };
  }

  let html = "";
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    try {
      html = (await response.clone().text()).slice(0, HTML_SAMPLE_LIMIT);
    } catch {
      html = "";
    }
  }
  if (html && hasPasswordInput(html)) {
    return { kind: "form", contentType, html };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "auth-required", contentType, html };
  }
  return { kind: "none", contentType, html };
}

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function basicRead(fetchImpl, config, target, password) {
  const { response } = await requestWithRedirects(
    fetchImpl,
    config,
    target,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${utf8Base64(`${config.loginEmail}:${password}`)}`,
      },
    },
    new Map(),
  );

  const auth = await inspectAuthSurface(response);
  if (response.status === 401 || response.status === 403) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_AUTH_FAILED",
      "Legal vault authentication failed",
      502,
    );
  }
  if (auth.kind === "form") {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_PROTOCOL_UNCONFIGURED",
      "Provider uses form authentication; form-login runtime configuration is required",
      503,
    );
  }
  return response;
}

function formConfigReady(config) {
  return Boolean(
    config.loginUrl &&
      config.usernameField &&
      config.passwordField,
  );
}

async function formRead(fetchImpl, config, target, password) {
  if (!formConfigReady(config)) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_PROTOCOL_UNCONFIGURED",
      "Form-login runtime configuration is incomplete",
      503,
    );
  }

  const jar = new Map();
  const loginPage = await requestWithRedirects(
    fetchImpl,
    config,
    config.loginUrl,
    { method: "GET" },
    jar,
  );
  if (loginPage.response.status >= 400) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_AUTH_FAILED",
      "Provider login page could not be loaded",
      502,
    );
  }

  let html = "";
  try {
    html = (await loginPage.response.clone().text()).slice(0, HTML_SAMPLE_LIMIT);
  } catch {
    html = "";
  }

  const fields = new URLSearchParams();
  fields.set(config.usernameField, config.loginEmail);
  fields.set(config.passwordField, password);
  for (const [key, value] of Object.entries(config.extraFields)) {
    fields.set(key, value);
  }
  if (config.csrfField) {
    const csrf = hiddenInputValue(html, config.csrfField);
    if (csrf === null) {
      throw new LegalVaultConnectorError(
        "LEGAL_VAULT_PROTOCOL_UNCONFIGURED",
        "Configured CSRF field was not present on the provider login page",
        503,
      );
    }
    fields.set(config.csrfField, csrf);
  }

  const postUrl = config.loginPostUrl || loginPage.url;
  validateLegalVaultProviderUrl(config, postUrl);
  await requestWithRedirects(
    fetchImpl,
    config,
    postUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: postUrl.origin,
        Referer: loginPage.url.toString(),
      },
      body: fields.toString(),
    },
    jar,
  );

  const readResult = await requestWithRedirects(
    fetchImpl,
    config,
    target,
    { method: "GET" },
    jar,
  );
  const auth = await inspectAuthSurface(readResult.response);
  if (
    readResult.response.status === 401 ||
    readResult.response.status === 403 ||
    auth.kind === "form"
  ) {
    throw new LegalVaultConnectorError(
      "LEGAL_VAULT_AUTH_FAILED",
      "Legal vault authentication did not establish a readable session",
      502,
    );
  }
  return readResult.response;
}

export async function probeLegalVault(
  env,
  { path, fetchImpl = globalThis.fetch } = {},
) {
  const config = getLegalVaultConfig(env);
  const target = buildLegalVaultReadUrl(config, path);
  const { response, url } = await requestWithRedirects(
    fetchImpl,
    config,
    target,
    { method: "GET" },
    new Map(),
  );
  const auth = await inspectAuthSurface(response);
  return {
    reachable: true,
    status: response.status,
    final_host: url.hostname,
    final_path: url.pathname,
    authentication: auth.kind,
    content_type: auth.contentType || null,
  };
}

export async function readLegalVault(
  env,
  { path, fetchImpl = globalThis.fetch } = {},
) {
  const config = getLegalVaultConfig(env);
  const target = buildLegalVaultReadUrl(config, path);

  // Resolve the credential before any provider network I/O. A missing or
  // unauthorized credential therefore fails closed before the external system
  // sees a request.
  const password = await resolveLegalVaultPassword(env, config);

  if (config.loginMode === "basic") {
    return basicRead(fetchImpl, config, target, password);
  }
  if (config.loginMode === "form") {
    return formRead(fetchImpl, config, target, password);
  }

  const unauthenticated = await requestWithRedirects(
    fetchImpl,
    config,
    target,
    { method: "GET" },
    new Map(),
  );
  const auth = await inspectAuthSurface(unauthenticated.response);

  if (
    unauthenticated.response.status >= 200 &&
    unauthenticated.response.status < 400 &&
    auth.kind === "none"
  ) {
    return unauthenticated.response;
  }
  if (auth.kind === "basic") {
    return basicRead(fetchImpl, config, target, password);
  }
  if (auth.kind === "form" && formConfigReady(config)) {
    return formRead(fetchImpl, config, target, password);
  }

  throw new LegalVaultConnectorError(
    "LEGAL_VAULT_PROTOCOL_UNCONFIGURED",
    "Provider authentication protocol requires additional runtime configuration",
    503,
  );
}

const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "etag",
  "last-modified",
];

export function proxyLegalVaultResponse(providerResponse) {
  const headers = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = providerResponse.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "no-store");
  return new Response(providerResponse.body, {
    status: providerResponse.status,
    statusText: providerResponse.statusText,
    headers,
  });
}
