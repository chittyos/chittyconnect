import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDashboardStore } from "../stores/dashboardStore";

const HEALTH_COLORS = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  down: "#ef4444",
  unknown: "#6b7280",
};

const CATEGORY_COLORS = {
  chittyos_service: "#6366f1",
  thirdparty: "#06b6d4",
  database: "#f59e0b",
  ai_provider: "#ec4899",
};

const NODE_W = 140;
const NODE_H = 48;
const TIER_GAP = 100;
const NODE_GAP = 16;
const TOP_OFFSET = 60;
const LEFT_OFFSET = 40;
const TP_COLUMN_X = 900;

export default function ConnectionGraph() {
  const { connectionGraph, fetchConnectionGraph } = useDashboardStore();
  const [hoveredNode, setHoveredNode] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConnectionGraph();
  }, [fetchConnectionGraph]);

  if (!connectionGraph) {
    return (
      <>
        <header className="page-header">
          <h1 className="page-title">Connection Graph</h1>
        </header>
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      </>
    );
  }

  const { nodes, edges } = connectionGraph;

  // Layout: ChittyOS nodes by tier, third-party/db/ai in right column
  const chittyNodes = nodes.filter((n) => n.category === "chittyos_service");
  const otherNodes = nodes.filter((n) => n.category !== "chittyos_service");

  // Group ChittyOS by tier
  const tiers = {};
  for (const node of chittyNodes) {
    const t = node.tier ?? 99;
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(node);
  }

  const tierKeys = Object.keys(tiers).sort((a, b) => Number(a) - Number(b));

  // Assign positions
  const positions = {};

  tierKeys.forEach((tier, tierIdx) => {
    const nodesInTier = tiers[tier];
    const tierWidth = nodesInTier.length * (NODE_W + NODE_GAP) - NODE_GAP;
    const startX = LEFT_OFFSET + (800 - tierWidth) / 2;
    nodesInTier.forEach((node, nodeIdx) => {
      positions[node.id] = {
        x: startX + nodeIdx * (NODE_W + NODE_GAP),
        y: TOP_OFFSET + tierIdx * TIER_GAP,
      };
    });
  });

  // Right column for non-ChittyOS
  otherNodes.forEach((node, idx) => {
    positions[node.id] = {
      x: TP_COLUMN_X,
      y: TOP_OFFSET + idx * (NODE_H + NODE_GAP),
    };
  });

  const svgHeight = Math.max(
    TOP_OFFSET + tierKeys.length * TIER_GAP + 60,
    TOP_OFFSET + otherNodes.length * (NODE_H + NODE_GAP) + 60,
    400,
  );
  const svgWidth = TP_COLUMN_X + NODE_W + LEFT_OFFSET + 40;

  return (
    <>
      <header
        className="page-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 className="page-title">Connection Graph</h1>
          <p className="page-subtitle">Service dependency topology</p>
        </div>
        <Link
          to="/connections"
          className="btn btn-secondary btn-sm"
          style={{ textDecoration: "none" }}
        >
          List View
        </Link>
      </header>

      <div className="page-content" style={{ overflow: "auto" }}>
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          <defs>
            <marker
              id="arrow"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L8,3 L0,6" fill="rgba(99, 102, 241, 0.4)" />
            </marker>
          </defs>

          {/* Tier labels */}
          {tierKeys.map((tier, idx) => (
            <text
              key={`tier-${tier}`}
              x={10}
              y={TOP_OFFSET + idx * TIER_GAP + NODE_H / 2 + 4}
              fill="rgba(255,255,255,0.2)"
              fontSize="11"
              fontWeight="600"
            >
              T{tier}
            </text>
          ))}

          {/* "Third-Party" label */}
          {otherNodes.length > 0 && (
            <text
              x={TP_COLUMN_X}
              y={TOP_OFFSET - 16}
              fill="rgba(255,255,255,0.2)"
              fontSize="11"
              fontWeight="600"
            >
              Integrations
            </text>
          )}

          {/* Edges */}
          {edges.map((edge, i) => {
            const from = positions[edge.source];
            const to = positions[edge.target];
            if (!from || !to) return null;

            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;

            const isHovered =
              hoveredNode === edge.source || hoveredNode === edge.target;

            return (
              <path
                key={i}
                d={`M${x1},${y1} C${x1},${y1 + 30} ${x2},${y2 - 30} ${x2},${y2}`}
                fill="none"
                stroke={
                  isHovered
                    ? "rgba(99, 102, 241, 0.8)"
                    : "rgba(99, 102, 241, 0.2)"
                }
                strokeWidth={isHovered ? 2 : 1}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = positions[node.id];
            if (!pos) return null;

            const borderColor =
              HEALTH_COLORS[node.health] || HEALTH_COLORS.unknown;
            const catColor = CATEGORY_COLORS[node.category] || "#6366f1";
            const isHovered = hoveredNode === node.id;

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => navigate(`/connections/${node.slug}`)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={
                    isHovered
                      ? "rgba(30, 30, 46, 0.95)"
                      : "rgba(20, 20, 36, 0.9)"
                  }
                  stroke={borderColor}
                  strokeWidth={isHovered ? 2 : 1}
                />
                {/* Icon circle */}
                <circle
                  cx={20}
                  cy={NODE_H / 2}
                  r={12}
                  fill={catColor}
                  opacity={0.2}
                />
                <text
                  x={20}
                  y={NODE_H / 2 + 4}
                  textAnchor="middle"
                  fill={catColor}
                  fontSize="9"
                  fontWeight="700"
                >
                  {node.icon}
                </text>
                {/* Name */}
                <text
                  x={38}
                  y={NODE_H / 2 + 4}
                  fill="rgba(255,255,255,0.9)"
                  fontSize="11"
                  fontWeight="500"
                >
                  {node.name.length > 13
                    ? node.name.slice(0, 13) + "..."
                    : node.name}
                </text>
                {/* Health dot */}
                <circle
                  cx={NODE_W - 12}
                  cy={NODE_H / 2}
                  r={4}
                  fill={borderColor}
                />
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            marginTop: "16px",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          {Object.entries(HEALTH_COLORS).map(([label, color]) => (
            <div
              key={label}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: color,
                }}
              />
              {label}
            </div>
          ))}
          <div style={{ marginLeft: "16px", display: "flex", gap: "16px" }}>
            {Object.entries(CATEGORY_COLORS).map(([label, color]) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "2px",
                    background: color,
                  }}
                />
                {label.replace("_", " ")}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
