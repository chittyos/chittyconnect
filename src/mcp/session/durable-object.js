export class MCPSessionDurableObject {
  constructor(state, env) {
    this.state = state
    this.env = env
  }
  async fetch(request) {
    // Minimal stub to satisfy DO binding; extend with real session logic as needed
    return new Response('OK', { status: 200 })
  }
}

