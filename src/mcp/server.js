/**
 * ChittyConnect MCP Server
 *
 * Protocol Version: 2024-11-05
 * Tools: 11
 * Resources: 3
 * Prompts: 0 (future)
 */

import { mintChittyID, logEvent, discoverServices } from '../integrations/chittyos-ecosystem.js';

/**
 * MCP Server Manifest
 */
export const MCP_MANIFEST = {
  schema_version: '2024-11-05',
  name: 'chittyconnect',
  version: '1.0.0',
  description: 'ChittyConnect MCP Server - ContextConsciousness™ AI spine for ChittyOS ecosystem',
  capabilities: {
    tools: true,
    resources: true,
    prompts: false
  }
};

/**
 * MCP Tools Registry
 */
export const MCP_TOOLS = [
  {
    name: 'chittyid_mint',
    description: 'Mint a new ChittyID with contextual metadata',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: {
          type: 'string',
          enum: ['PEO', 'PLACE', 'PROP', 'EVNT', 'AUTH', 'INFO', 'FACT', 'CONTEXT', 'ACTOR'],
          description: 'Type of entity to mint ChittyID for'
        },
        metadata: {
          type: 'object',
          description: 'Contextual metadata for the entity'
        }
      },
      required: ['entityType']
    }
  },
  {
    name: 'chitty_contextual_analyze',
    description: 'Analyze content with ContextConsciousness™ - deep contextual understanding',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content to analyze'
        },
        context: {
          type: 'object',
          description: 'Additional context for analysis'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'chitty_case_create',
    description: 'Create a new legal case in ChittyCases',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Case title'
        },
        description: {
          type: 'string',
          description: 'Case description'
        },
        parties: {
          type: 'array',
          description: 'Parties involved in the case'
        }
      },
      required: ['title', 'description']
    }
  },
  {
    name: 'chitty_chronicle_log',
    description: 'Log an event to ChittyChronicle timeline',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'string',
          description: 'Event name'
        },
        metadata: {
          type: 'object',
          description: 'Event metadata'
        }
      },
      required: ['event']
    }
  },
  {
    name: 'chitty_evidence_ingest',
    description: 'Ingest evidence file into ChittyEvidence',
    inputSchema: {
      type: 'object',
      properties: {
        fileUrl: {
          type: 'string',
          description: 'URL of evidence file'
        },
        caseId: {
          type: 'string',
          description: 'Associated case ChittyID'
        },
        description: {
          type: 'string',
          description: 'Evidence description'
        }
      },
      required: ['fileUrl']
    }
  },
  {
    name: 'chitty_sync_trigger',
    description: 'Trigger data synchronization in ChittySync',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source system'
        },
        target: {
          type: 'string',
          description: 'Target system'
        },
        entityType: {
          type: 'string',
          description: 'Type of entity to sync'
        }
      },
      required: ['source', 'target']
    }
  },
  {
    name: 'chitty_services_status',
    description: 'Get health status of all ChittyOS services',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'chitty_registry_discover',
    description: 'Discover services from ChittyRegistry',
    inputSchema: {
      type: 'object',
      properties: {
        serviceType: {
          type: 'string',
          description: 'Filter by service type (optional)'
        }
      }
    }
  },
  {
    name: 'chitty_finance_connect_bank',
    description: 'Connect a bank account via ChittyFinance',
    inputSchema: {
      type: 'object',
      properties: {
        bankName: {
          type: 'string',
          description: 'Name of the bank'
        },
        accountType: {
          type: 'string',
          enum: ['checking', 'savings', 'credit'],
          description: 'Type of account'
        }
      },
      required: ['bankName', 'accountType']
    }
  },
  {
    name: 'notion_query',
    description: 'Query Notion databases',
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: {
          type: 'string',
          description: 'Notion database ID'
        },
        filter: {
          type: 'object',
          description: 'Query filter'
        }
      },
      required: ['databaseId']
    }
  },
  {
    name: 'openai_chat',
    description: 'Chat with OpenAI models',
    inputSchema: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          description: 'Chat messages'
        },
        model: {
          type: 'string',
          description: 'OpenAI model (default: gpt-4)',
          default: 'gpt-4'
        }
      },
      required: ['messages']
    }
  }
];

/**
 * MCP Resources Registry
 */
export const MCP_RESOURCES = [
  {
    uri: 'chitty://services/status',
    name: 'ChittyOS Services Status',
    description: 'Real-time health status of all ChittyOS services',
    mimeType: 'application/json'
  },
  {
    uri: 'chitty://registry/services',
    name: 'ChittyRegistry Services',
    description: 'Complete service registry from ChittyRegistry',
    mimeType: 'application/json'
  },
  {
    uri: 'chitty://context/awareness',
    name: 'ContextConsciousness™ State',
    description: 'Current ContextConsciousness™ awareness state',
    mimeType: 'application/json'
  }
];

/**
 * Execute MCP Tool
 */
export async function executeTool(toolName, params, env) {
  console.log(`[MCP] Executing tool: ${toolName}`);

  switch (toolName) {
    case 'chittyid_mint':
      return await toolChittyIDMint(params, env);

    case 'chitty_contextual_analyze':
      return await toolContextualAnalyze(params, env);

    case 'chitty_case_create':
      return await toolCaseCreate(params, env);

    case 'chitty_chronicle_log':
      return await toolChronicleLog(params, env);

    case 'chitty_evidence_ingest':
      return await toolEvidenceIngest(params, env);

    case 'chitty_sync_trigger':
      return await toolSyncTrigger(params, env);

    case 'chitty_services_status':
      return await toolServicesStatus(params, env);

    case 'chitty_registry_discover':
      return await toolRegistryDiscover(params, env);

    case 'chitty_finance_connect_bank':
      return await toolFinanceConnectBank(params, env);

    case 'notion_query':
      return await toolNotionQuery(params, env);

    case 'openai_chat':
      return await toolOpenAIChat(params, env);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Get MCP Resource
 */
export async function getResource(uri, env) {
  console.log(`[MCP] Getting resource: ${uri}`);

  switch (uri) {
    case 'chitty://services/status':
      return await resourceServicesStatus(env);

    case 'chitty://registry/services':
      return await resourceRegistryServices(env);

    case 'chitty://context/awareness':
      return await resourceContextAwareness(env);

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

// ============================================================================
// Tool Implementations
// ============================================================================

async function toolChittyIDMint(params, env) {
  const chittyId = await mintChittyID(env, params.entityType, params.metadata || {});

  return {
    success: true,
    chittyId,
    entityType: params.entityType,
    timestamp: new Date().toISOString()
  };
}

async function toolContextualAnalyze(params, env) {
  // Call ChittyContextual service
  const response = await fetch('https://contextual.chitty.cc/v1/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHITTY_CONTEXTUAL_TOKEN || ''}`
    },
    body: JSON.stringify({
      content: params.content,
      context: params.context || {}
    })
  });

  if (!response.ok) {
    throw new Error(`ContextConsciousness™ analysis failed: ${response.status}`);
  }

  return await response.json();
}

async function toolCaseCreate(params, env) {
  // Call ChittyCases service
  const response = await fetch('https://cases.chitty.cc/v1/cases', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHITTY_CASES_TOKEN || ''}`
    },
    body: JSON.stringify({
      title: params.title,
      description: params.description,
      parties: params.parties || []
    })
  });

  if (!response.ok) {
    throw new Error(`Case creation failed: ${response.status}`);
  }

  return await response.json();
}

async function toolChronicleLog(params, env) {
  const result = await logEvent(env, {
    event: params.event,
    metadata: params.metadata || {}
  });

  return {
    success: result.logged !== false,
    event: params.event,
    timestamp: new Date().toISOString()
  };
}

async function toolEvidenceIngest(params, env) {
  // Call ChittyEvidence service
  const response = await fetch('https://evidence.chitty.cc/v1/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHITTY_EVIDENCE_TOKEN || ''}`
    },
    body: JSON.stringify({
      fileUrl: params.fileUrl,
      caseId: params.caseId,
      description: params.description
    })
  });

  if (!response.ok) {
    throw new Error(`Evidence ingestion failed: ${response.status}`);
  }

  return await response.json();
}

async function toolSyncTrigger(params, env) {
  // Call ChittySync service
  const response = await fetch('https://sync.chitty.cc/v1/trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHITTY_SYNC_TOKEN || ''}`
    },
    body: JSON.stringify({
      source: params.source,
      target: params.target,
      entityType: params.entityType
    })
  });

  if (!response.ok) {
    throw new Error(`Sync trigger failed: ${response.status}`);
  }

  return await response.json();
}

async function toolServicesStatus(params, env) {
  const services = ['id', 'auth', 'dna', 'verify', 'certify', 'chronicle', 'registry', 'contextual', 'cases', 'finance', 'evidence', 'sync'];
  const statuses = {};

  for (const service of services) {
    try {
      const response = await fetch(`https://${service}.chitty.cc/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env[`CHITTY_${service.toUpperCase()}_TOKEN`] || ''}`
        }
      });

      statuses[service] = {
        status: response.ok ? 'healthy' : 'unhealthy',
        statusCode: response.status
      };
    } catch (error) {
      statuses[service] = {
        status: 'unreachable',
        error: error.message
      };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    services: statuses
  };
}

async function toolRegistryDiscover(params, env) {
  const registry = await discoverServices(env);

  if (params.serviceType) {
    const filtered = registry.services?.filter(s => s.type === params.serviceType) || [];
    return { services: filtered };
  }

  return registry;
}

async function toolFinanceConnectBank(params, env) {
  // Call ChittyFinance service
  const response = await fetch('https://finance.chitty.cc/v1/bank/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CHITTY_FINANCE_TOKEN || ''}`
    },
    body: JSON.stringify({
      bankName: params.bankName,
      accountType: params.accountType
    })
  });

  if (!response.ok) {
    throw new Error(`Bank connection failed: ${response.status}`);
  }

  return await response.json();
}

async function toolNotionQuery(params, env) {
  // Call Notion API via third-party integration
  const response = await fetch(`https://api.notion.com/v1/databases/${params.databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_TOKEN || ''}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filter: params.filter || {}
    })
  });

  if (!response.ok) {
    throw new Error(`Notion query failed: ${response.status}`);
  }

  return await response.json();
}

async function toolOpenAIChat(params, env) {
  // Call OpenAI API
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model || 'gpt-4',
      messages: params.messages
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI chat failed: ${response.status}`);
  }

  return await response.json();
}

// ============================================================================
// Resource Implementations
// ============================================================================

async function resourceServicesStatus(env) {
  const result = await toolServicesStatus({}, env);

  return {
    contents: [
      {
        uri: 'chitty://services/status',
        mimeType: 'application/json',
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

async function resourceRegistryServices(env) {
  const registry = await discoverServices(env);

  return {
    contents: [
      {
        uri: 'chitty://registry/services',
        mimeType: 'application/json',
        text: JSON.stringify(registry, null, 2)
      }
    ]
  };
}

async function resourceContextAwareness(env) {
  // Get current ContextConsciousness™ state
  const awareness = {
    timestamp: new Date().toISOString(),
    service: 'chittyconnect',
    capabilities: ['mcp', 'rest-api', 'github-app'],
    contextDepth: 'high',
    awarenessLevel: 'full',
    integrations: {
      chittyos: true,
      github: true,
      notion: true,
      openai: true
    }
  };

  return {
    contents: [
      {
        uri: 'chitty://context/awareness',
        mimeType: 'application/json',
        text: JSON.stringify(awareness, null, 2)
      }
    ]
  };
}
