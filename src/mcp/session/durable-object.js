export class MCPSessionDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "mcp-session-do" });
    }

    // Session persistence not yet implemented — return 501 instead of faking success
    return Response.json(
      {
        error: "MCP session management not yet implemented",
        path: url.pathname,
      },
      { status: 501 },
    );
  }
}
