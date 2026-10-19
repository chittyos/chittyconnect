// Regression: every credential broker must answer the provisioner's legacy
// getInfrastructureCredential(service, field) call shape.
//
// The 1Password retirement repointed EnhancedCredentialProvisioner.onePassword at
// the broker, but only OnePasswordConnectClient implemented that method. With the
// production setting CREDENTIAL_BROKER_TYPE="cloudflare-secrets" the provisioner
// threw TypeError at call time — and only at call time, since nothing exercises
// it until a Cloudflare API token mint is attempted. That silently severed the
// sanctioned path for minting scoped tokens, which is why the estate kept falling
// back to the account Global API Key.
//
// Real env bindings, no mocked broker: the CloudflareSecretsBroker reads from
// env, so a plain object with the mapped binding IS the real backend here.

import { describe, it, expect } from 'vitest';
import { createCredentialBroker } from '../src/lib/credential-broker.js';

const CF_ENV = {
  CREDENTIAL_BROKER_TYPE: 'cloudflare-secrets',
  // PATH_TO_ENV maps infrastructure/cloudflare/make_api_key -> CLOUDFLARE_MAKE_API_KEY
  CLOUDFLARE_MAKE_API_KEY: 'test-binding-value-not-a-real-credential',
};

describe('getInfrastructureCredential adapter', () => {
  it('exists on the broker the production config actually selects', () => {
    const broker = createCredentialBroker(CF_ENV);
    expect(broker.type).toBe('cloudflare-secrets');
    expect(typeof broker.getInfrastructureCredential).toBe('function');
  });

  it('resolves (service, field) through the documented path convention', async () => {
    const broker = createCredentialBroker(CF_ENV);
    const value = await broker.getInfrastructureCredential('cloudflare', 'make_api_key', {
      service: 'chittyconnect',
      purpose: 'credential_provisioning',
    });
    expect(value).toBe(CF_ENV.CLOUDFLARE_MAKE_API_KEY);
  });

  it('rejects a malformed reference instead of building "infrastructure/undefined/undefined"', async () => {
    const broker = createCredentialBroker(CF_ENV);
    await expect(broker.getInfrastructureCredential(undefined, 'field')).rejects.toThrow(
      /E_CREDENTIAL_BAD_REF/,
    );
    await expect(broker.getInfrastructureCredential('cloudflare')).rejects.toThrow(
      /E_CREDENTIAL_BAD_REF/,
    );
  });

  it('an unmapped path fails loudly rather than returning undefined', async () => {
    const broker = createCredentialBroker(CF_ENV);
    // infrastructure/github/* has no PATH_TO_ENV entry — a separate, real gap.
    // It must surface as an error, not a silent undefined that a caller then
    // sends to the Cloudflare API as an empty bearer token.
    await expect(
      broker.getInfrastructureCredential('github', 'app_id'),
    ).rejects.toThrow();
  });
});
