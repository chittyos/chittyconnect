#!/bin/bash

###############################################################################
# ChittyConnect MCP Setup Script
#
# Interactive setup script for configuring ChittyConnect MCP server
# for Claude Desktop or Claude Code integration.
#
# Usage:
#   ./scripts/setup-mcp.sh [desktop|code]
#
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Platform detection
PLATFORM="${1:-desktop}"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ChittyConnect MCP Setup for Claude Integration      ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

###############################################################################
# Step 1: Check prerequisites
###############################################################################

echo -e "${YELLOW}[Step 1/6]${NC} Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "Please install Node.js 18 or higher from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js version 18 or higher is required${NC}"
    echo "Current version: $(node -v)"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ npm $(npm -v) installed${NC}"

###############################################################################
# Step 2: Install dependencies
###############################################################################

echo ""
echo -e "${YELLOW}[Step 2/6]${NC} Installing MCP SDK dependencies..."

cd "$PROJECT_DIR"

if [ ! -d "node_modules" ]; then
    npm install
fi

# Install MCP SDK if not already installed
if ! npm list @modelcontextprotocol/sdk &> /dev/null; then
    echo "Installing @modelcontextprotocol/sdk..."
    npm install @modelcontextprotocol/sdk
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

###############################################################################
# Step 3: Get ChittyConnect configuration
###############################################################################

echo ""
echo -e "${YELLOW}[Step 3/6]${NC} Configuring ChittyConnect connection..."

# Prompt for ChittyConnect URL
read -p "ChittyConnect URL [https://connect.chitty.cc]: " CHITTYCONNECT_URL
CHITTYCONNECT_URL=${CHITTYCONNECT_URL:-https://connect.chitty.cc}

# Prompt for auth token
echo ""
echo "You need a ChittyAuth token to connect to ChittyConnect."
echo "To get a token, visit: https://auth.chitty.cc/register"
echo ""
read -sp "ChittyAuth Token: " CHITTY_AUTH_TOKEN
echo ""

if [ -z "$CHITTY_AUTH_TOKEN" ]; then
    echo -e "${RED}✗ ChittyAuth token is required${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Configuration collected${NC}"

###############################################################################
# Step 4: Test connection
###############################################################################

echo ""
echo -e "${YELLOW}[Step 4/6]${NC} Testing ChittyConnect connection..."

# Test API connection
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $CHITTY_AUTH_TOKEN" \
    "$CHITTYCONNECT_URL/health")

if [ "$HEALTH_CHECK" != "200" ]; then
    echo -e "${RED}✗ Failed to connect to ChittyConnect (HTTP $HEALTH_CHECK)${NC}"
    echo "Please check your URL and token"
    exit 1
fi

echo -e "${GREEN}✓ Successfully connected to ChittyConnect${NC}"

###############################################################################
# Step 5: Generate configuration
###############################################################################

echo ""
echo -e "${YELLOW}[Step 5/6]${NC} Generating MCP server configuration..."

# Determine config file location based on platform
if [ "$PLATFORM" == "desktop" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        CONFIG_DIR="$HOME/Library/Application Support/Claude"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CONFIG_DIR="$HOME/.config/Claude"
    else
        echo -e "${RED}✗ Unsupported platform: $OSTYPE${NC}"
        exit 1
    fi
    CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
elif [ "$PLATFORM" == "code" ]; then
    CONFIG_DIR="$HOME/.config/Code/User"
    CONFIG_FILE="$CONFIG_DIR/claude_code_config.json"
else
    echo -e "${RED}✗ Unknown platform: $PLATFORM${NC}"
    echo "Use 'desktop' or 'code'"
    exit 1
fi

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Generate MCP server configuration
MCP_CONFIG=$(cat <<EOF
{
  "mcpServers": {
    "chittyconnect": {
      "command": "node",
      "args": ["$PROJECT_DIR/mcp-server.js"],
      "env": {
        "CHITTYCONNECT_URL": "$CHITTYCONNECT_URL",
        "CHITTY_AUTH_TOKEN": "$CHITTY_AUTH_TOKEN",
        "ENABLE_STREAMING": "true",
        "SESSION_PERSISTENCE": "true",
        "PLATFORM": "$PLATFORM",
        "DEBUG": "false"
      }
    }
  }
}
EOF
)

# Check if config file exists
if [ -f "$CONFIG_FILE" ]; then
    echo ""
    echo -e "${YELLOW}Configuration file already exists:${NC}"
    echo "$CONFIG_FILE"
    echo ""
    read -p "Merge with existing configuration? [y/N]: " MERGE_CONFIG

    if [[ "$MERGE_CONFIG" =~ ^[Yy]$ ]]; then
        # Backup existing config
        cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
        echo -e "${GREEN}✓ Backed up existing configuration${NC}"

        # Merge configurations (simple append for now)
        echo "$MCP_CONFIG" > "$CONFIG_FILE.chittyconnect"
        echo -e "${YELLOW}! New configuration saved to: $CONFIG_FILE.chittyconnect${NC}"
        echo "Please manually merge into your existing configuration"
    else
        echo "$MCP_CONFIG" > "$CONFIG_FILE.chittyconnect"
        echo -e "${YELLOW}! Configuration saved to: $CONFIG_FILE.chittyconnect${NC}"
    fi
else
    echo "$MCP_CONFIG" > "$CONFIG_FILE"
    echo -e "${GREEN}✓ Configuration saved to: $CONFIG_FILE${NC}"
fi

###############################################################################
# Step 6: Create convenience script
###############################################################################

echo ""
echo -e "${YELLOW}[Step 6/6]${NC} Creating convenience scripts..."

# Create test script
cat > "$PROJECT_DIR/test-mcp.sh" <<'EOF'
#!/bin/bash
# Test ChittyConnect MCP Server

source .env 2>/dev/null || true

export CHITTYCONNECT_URL=${CHITTYCONNECT_URL:-https://connect.chitty.cc}
export ENABLE_STREAMING=true
export SESSION_PERSISTENCE=true
export DEBUG=true

echo "Testing ChittyConnect MCP Server..."
echo "Platform: ${PLATFORM:-desktop}"
echo ""

node mcp-server.js
EOF

chmod +x "$PROJECT_DIR/test-mcp.sh"
echo -e "${GREEN}✓ Created test-mcp.sh${NC}"

# Create .env.example
cat > "$PROJECT_DIR/.env.example" <<EOF
# ChittyConnect MCP Configuration
CHITTYCONNECT_URL=https://connect.chitty.cc
CHITTY_AUTH_TOKEN=your_token_here
ENABLE_STREAMING=true
SESSION_PERSISTENCE=true
PLATFORM=desktop
DEBUG=false
EOF

echo -e "${GREEN}✓ Created .env.example${NC}"

###############################################################################
# Setup complete
###############################################################################

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Setup Complete Successfully! ✓              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Next steps:${NC}"
echo ""

if [ "$PLATFORM" == "desktop" ]; then
    echo "1. Restart Claude Desktop"
    echo "2. Look for 'ChittyConnect' in the MCP servers list"
    echo "3. Start chatting with Claude and use ChittyConnect tools!"
elif [ "$PLATFORM" == "code" ]; then
    echo "1. Restart Claude Code"
    echo "2. Look for 'ChittyConnect' in the MCP servers list"
    echo "3. Start coding with Claude and use ChittyConnect tools!"
fi

echo ""
echo -e "${BLUE}Available tools include:${NC}"
echo "  • ChittyID minting and validation"
echo "  • Legal case management"
echo "  • Evidence ingestion and analysis"
echo "  • ContextConsciousness™ ecosystem awareness"
echo "  • MemoryCloude™ persistent memory"
echo "  • Secure credential management via 1Password"
echo "  • Service health monitoring"
echo "  • And many more..."

echo ""
echo -e "${BLUE}Testing:${NC}"
echo "  Run ./test-mcp.sh to test the MCP server locally"

echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  • Architecture Review: MCP_ARCHITECTURE_REVIEW.md"
echo "  • Project Guide: CLAUDE.md"
echo "  • Quick Start: QUICK_START.md"

echo ""
echo -e "${YELLOW}Need help? Visit: https://chitty.cc/docs${NC}"
echo ""