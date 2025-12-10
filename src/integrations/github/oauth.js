/**
 * GitHub App OAuth Callback Handler
 *
 * Complete Implementation:
 * 1. Fetch Installation Details
 * 2. Mint ChittyID for Installation
 * 3. Initialize ChittyDNA Record
 * 4. Store in D1 installations Table
 * 5. Cache Installation Token
 * 6. Log to ChittyChronicle
 * 7. Redirect to Success Page
 */

import { getInstallationDetails, getInstallationToken } from './utils.js';
import { mintChittyID, initializeChittyDNA, logEvent } from '../chittyos-ecosystem.js';
import { createInstallation, getInstallation } from '../../database/schema.js';

/**
 * Handle GitHub App OAuth callback
 */
export async function handleOAuthCallback(request, env) {
  try {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installation_id');
    const setupAction = url.searchParams.get('setup_action');

    if (!installationId) {
      return new Response('Missing installation_id', { status: 400 });
    }

    console.log(`[GitHub OAuth] Processing installation: ${installationId}`);
    console.log(`[GitHub OAuth] Setup action: ${setupAction}`);

    // Step 1: Fetch Installation Details
    console.log('[GitHub OAuth] Step 1: Fetching installation details...');
    const installation = await getInstallationDetails(env, installationId);

    console.log(`[GitHub OAuth] Installation for: ${installation.account.login} (${installation.account.type})`);
    console.log(`[GitHub OAuth] Repository selection: ${installation.repository_selection}`);

    // Check if installation already exists
    const existing = await getInstallation(env.DB, installationId);

    let chittyId;

    if (existing) {
      console.log(`[GitHub OAuth] Installation already exists: ${existing.chitty_id}`);
      chittyId = existing.chitty_id;

      // Redirect to success page
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `https://connect.chitty.cc/github/installed?installation_id=${installationId}&chittyid=${chittyId}&existing=true`
        }
      });
    }

    // Step 2: Mint ChittyID for Installation
    console.log('[GitHub OAuth] Step 2: Minting ChittyID...');
    chittyId = await mintChittyID(env, 'CONTEXT', {
      type: 'github_installation',
      installationId: installation.id,
      account: installation.account.login,
      accountType: installation.account.type,
      repositorySelection: installation.repository_selection
    });

    console.log(`[GitHub OAuth] ChittyID minted: ${chittyId}`);

    // Step 3: Initialize ChittyDNA Record
    console.log('[GitHub OAuth] Step 3: Initializing ChittyDNA...');
    const dnaResult = await initializeChittyDNA(env, chittyId, {
      type: 'github_installation',
      service: 'chittyconnect',
      version: '1.0.0',
      metadata: {
        installationId: installation.id,
        account: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
        permissions: installation.permissions,
        events: installation.events
      }
    });

    console.log('[GitHub OAuth] ChittyDNA initialized');

    // Step 4: Store in D1 installations Table
    console.log('[GitHub OAuth] Step 4: Storing installation in database...');
    await createInstallation(env.DB, {
      installationId: installation.id,
      chittyId,
      accountId: installation.account.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      events: installation.events,
      metadata: {
        appId: installation.app_id,
        targetId: installation.target_id,
        targetType: installation.target_type,
        createdAt: installation.created_at,
        updatedAt: installation.updated_at
      }
    });

    console.log('[GitHub OAuth] Installation stored in database');

    // Step 5: Cache Installation Token
    console.log('[GitHub OAuth] Step 5: Caching installation token...');
    await getInstallationToken(env, installation.id);
    console.log('[GitHub OAuth] Installation token cached');

    // Step 6: Log to ChittyChronicle
    console.log('[GitHub OAuth] Step 6: Logging to ChittyChronicle...');
    await logEvent(env, {
      event: 'github.app.installed',
      chittyId,
      metadata: {
        installationId: installation.id,
        account: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
        setupAction
      }
    });

    console.log('[GitHub OAuth] Event logged to ChittyChronicle');

    // Step 7: Redirect to Success Page
    console.log('[GitHub OAuth] Step 7: Redirecting to success page...');

    return new Response(null, {
      status: 302,
      headers: {
        'Location': `https://connect.chitty.cc/github/installed?installation_id=${installationId}&chittyid=${chittyId}`
      }
    });

  } catch (error) {
    console.error('[GitHub OAuth] Callback failed:', error.message);

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Installation Failed - ChittyConnect</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 600px;
              margin: 100px auto;
              padding: 20px;
              text-align: center;
            }
            .error {
              background: #fee;
              border: 1px solid #fcc;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            h1 { color: #c33; }
            code {
              background: #f5f5f5;
              padding: 2px 6px;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <h1>Installation Failed</h1>
          <div class="error">
            <p><strong>Error:</strong> ${error.message}</p>
          </div>
          <p>Please try again or contact support.</p>
        </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/**
 * Render installation success page
 */
export async function renderInstallationSuccess(request, env) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get('installation_id');
  const chittyId = url.searchParams.get('chittyid');
  const existing = url.searchParams.get('existing') === 'true';

  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Installation Complete - ChittyConnect</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 700px;
            margin: 100px auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .card {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          }
          h1 {
            color: #667eea;
            margin: 0 0 20px 0;
          }
          .success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
          }
          .info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            border-left: 4px solid #667eea;
          }
          code {
            background: #f5f5f5;
            padding: 2px 8px;
            border-radius: 4px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            color: #667eea;
          }
          .badge {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin: 5px 5px 5px 0;
          }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            margin: 10px 10px 10px 0;
          }
          .button:hover {
            background: #764ba2;
          }
          ul {
            text-align: left;
            line-height: 1.8;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🎉 ${existing ? 'Welcome Back!' : 'Installation Complete!'}</h1>

          <div class="success">
            <strong>${existing ? 'Existing installation detected' : 'ChittyConnect has been successfully installed!'}</strong>
          </div>

          <div class="info">
            <p><strong>Installation ID:</strong> <code>${installationId}</code></p>
            <p><strong>ChittyID:</strong> <code>${chittyId}</code></p>
            ${existing ? '<p><span class="badge">EXISTING</span></p>' : '<p><span class="badge">NEW</span></p>'}
          </div>

          <h2>What's Next?</h2>

          <ul>
            <li><strong>Webhook Events:</strong> ChittyConnect will now receive GitHub events</li>
            <li><strong>ChittyID Tracking:</strong> All events are tracked with ChittyIDs</li>
            <li><strong>MCP Integration:</strong> Access via MCP tools</li>
            <li><strong>REST API:</strong> Query via <code>/api/github/*</code> endpoints</li>
          </ul>

          <div style="margin-top: 30px; text-align: center;">
            <a href="https://github.com/settings/installations/${installationId}" class="button">
              Configure Installation
            </a>
            <a href="https://connect.chitty.cc/api/health" class="button">
              View API Status
            </a>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #666;">
            <p><strong>ChittyConnect™</strong> - The AI-intelligent spine with ContextConsciousness™</p>
            <p>Part of the ChittyOS ecosystem</p>
          </div>
        </div>
      </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
}
