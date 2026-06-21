#!/usr/bin/env bash
# Setup script for Tailscale Aperture and App Connectors on ChittyOS nodes
#
# This script configures the local node to act as an App Connector
# for external SaaS dependencies required by AI Agents, and registers
# the node's ChittyConnect Webhook for Aperture Governance.

set -e

# ==========================================
# 1. App Connector Setup
# ==========================================
echo "Configuring node as a Tailscale App Connector..."
# By routing these domains through this node, AI agents on the tailnet
# can securely access these external resources without traversing the public internet directly.
APPS="api.github.com,github.com,api.stripe.com"

# You need to run tailscale up with sudo, so we prompt for it:
sudo tailscale up --advertise-connector="$APPS" --accept-routes

echo "✅ App Connector advertised for: $APPS"
echo "Make sure to approve this App Connector route in the Tailscale Admin Console!"

# ==========================================
# 2. Aperture Configuration Information
# ==========================================
echo ""
echo "=========================================================="
echo "Tailscale Aperture Webhook & Governance Endpoint:"
echo "=========================================================="
echo ""
echo "Your ChittyConnect node is now ready to process Aperture Events"
echo "and enforce local ChittyOS Governance policies for AI Agents."
echo ""
echo "In your Tailscale Aperture Configuration (or Admin Console), configure the Webhook URL to:"
echo "https://chittyserv-vm.cockatoo-dominant.ts.net/api/v1/aperture/webhook"
echo ""
echo "For synchronous Access Control (AuthZ) checks, configure the endpoint to:"
echo "https://chittyserv-vm.cockatoo-dominant.ts.net/api/v1/aperture/authorize"
echo ""
echo "Make sure ChittyConnect is running securely behind Tailscale Serve:"
echo "$ tailscale serve --bg 8787"
echo "=========================================================="
