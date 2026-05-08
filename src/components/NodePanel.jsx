/**
 * NodePanel.jsx
 * Column B: AI-detected node chips (draggable onto canvas)
 * Column C: Connection instruction cards (🔴🟡🟢 state machine)
 */
import React, { useMemo } from 'react';

/* ── Category config ─────────────────────────────────────────────── */
const CATEGORY_META = {
  actor:           { icon: '🧍', color: '#3b82f6', bg: '#dbeafe', label: 'Actors',           jointType: 'uml.Actor' },
  use_case:        { icon: '🔵', color: '#7c3aed', bg: '#ede9fe', label: 'Use Cases',        jointType: 'uml.UseCase' },
  process:         { icon: '🟩', color: '#16a34a', bg: '#dcfce7', label: 'Processes',        jointType: 'dfd.Process' },
  data_store:      { icon: '🗄️', color: '#ea580c', bg: '#ffedd5', label: 'Data Stores',     jointType: 'dfd.DataStore' },
  system_boundary: { icon: '🔲', color: '#0284c7', bg: '#e0f2fe', label: 'System Boundary',  jointType: 'uml.SystemBoundary' },
  decision:        { icon: '🔶', color: '#d97706', bg: '#fef3c7', label: 'Decisions',        jointType: 'uml.DecisionNode' },
  start:           { icon: '⚫', color: '#1e293b', bg: '#e2e8f0', label: 'Start/End',        jointType: 'uml.StartNode' },
  end:             { icon: '🔴', color: '#dc2626', bg: '#fee2e2', label: 'Start/End',        jointType: 'uml.EndState' },
};

const DEFAULT_META = { icon: '📦', color: '#6366f1', bg: '#e0e7ff', label: 'Nodes', jointType: 'standard.Rectangle' };

const getMeta = (cat) => CATEGORY_META[cat?.toLowerCase()] || DEFAULT_META;

/* ── Instruction card state ─────────────────────────────────────── */
const getCardState = (instr, placedIds) => {
  const fromPlaced = placedIds.has(instr.from);
  const toPlaced   = placedIds.has(instr.to);
  if (fromPlaced && toPlaced) return 'ready';
  return 'locked';
};

/* ── NodePanel ───────────────────────────────────────────────────── */
export default function NodePanel({ 
  nodes = [], 
  instructions = [], 
  placedNodeIds = new Set(),
  connectedEdgeIds = new Set(),
  onDropNode,         // (node) => void — called when user drags chip to canvas
  onConnectInstruction, // (instr) => void — called when card clicked
  onDropAll,          // () => void — drop all unplaced nodes
  isDark = false,
  T = {}
}) {
  /* Group nodes by category */
  const grouped = useMemo(() => {
    const map = {};
    nodes.forEach(n => {
      const cat = n.category || 'use_case';
      if (!map[cat]) map[cat] = [];
      map[cat].push(n);
    });
    return map;
  }, [nodes]);

  const unplacedCount = nodes.filter(n => !placedNodeIds.has(n.id)).length;
  const connectedCount = instructions.filter(i => connectedEdgeIds.has(i.id)).length;

  /* ── Chip drag start ─────────────────────────────────────────── */
  const handleDragStart = (e, node) => {
    const meta = getMeta(node.category);
    e.dataTransfer.setData('application/intellispec-node', JSON.stringify({
      ...node,
      jointType: meta.jointType
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const col = {
    background: isDark ? '#1e293b' : '#ffffff',
    borderRight: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    padding: '12px 8px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '160px',
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Column B: AI Nodes ─────────────────────────────────── */}
      <div style={col}>
        <div style={{ fontSize: '10px', fontWeight: '800', color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
          AI Nodes
        </div>

        {nodes.length === 0 ? (
          <div style={{ fontSize: '11px', color: isDark ? '#475569' : '#94a3b8', textAlign: 'center', marginTop: '20px' }}>
            Generate or upload an SRS to see detected nodes
          </div>
        ) : (
          Object.entries(grouped).map(([cat, catNodes]) => {
            const meta = getMeta(cat);
            return (
              <div key={cat} style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '9px', fontWeight: '700', color: meta.color, textTransform: 'uppercase', marginBottom: '4px', paddingLeft: '2px' }}>
                  {meta.label}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {catNodes.map(node => {
                    const placed = placedNodeIds.has(node.id);
                    return (
                      <div
                        key={node.id}
                        draggable={!placed}
                        onDragStart={e => handleDragStart(e, node)}
                        title={placed ? `${node.label} (placed)` : `Drag to canvas`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          padding: '4px 8px', borderRadius: '20px',
                          background: placed ? (isDark ? '#0f172a' : '#f1f5f9') : meta.bg,
                          border: `1px solid ${placed ? (isDark ? '#1e293b' : '#e2e8f0') : meta.color}`,
                          fontSize: '10px', fontWeight: '600',
                          color: placed ? (isDark ? '#475569' : '#94a3b8') : meta.color,
                          cursor: placed ? 'default' : 'grab',
                          opacity: placed ? 0.5 : 1,
                          transition: 'all 0.15s',
                          userSelect: 'none',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: '135px',
                        }}
                      >
                        <span style={{ fontSize: '12px' }}>{meta.icon}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</span>
                        {placed && <span style={{ fontSize: '9px' }}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        {/* Drop All button */}
        {unplacedCount > 0 && (
          <button
            onClick={onDropAll}
            style={{
              marginTop: 'auto', padding: '8px', borderRadius: '8px',
              border: `1px solid ${isDark ? '#6366f1' : '#6366f1'}`,
              background: 'transparent', color: '#6366f1',
              fontSize: '11px', fontWeight: '700', cursor: 'pointer',
            }}
          >
            ↓ Drop All ({unplacedCount})
          </button>
        )}
      </div>

      {/* ── Column C: Instructions ─────────────────────────────── */}
      <div style={{ ...col, borderRight: 'none', width: '168px' }}>
        <div style={{ fontSize: '10px', fontWeight: '800', color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
          Connections
        </div>

        {/* Progress bar */}
        {instructions.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '9px', color: isDark ? '#64748b' : '#94a3b8', marginBottom: '3px' }}>
              {connectedCount}/{instructions.length} connected
            </div>
            <div style={{ height: '4px', borderRadius: '2px', background: isDark ? '#1e293b' : '#e2e8f0' }}>
              <div style={{
                height: '100%', borderRadius: '2px', background: '#22c55e',
                width: `${instructions.length ? (connectedCount / instructions.length) * 100 : 0}%`,
                transition: 'width 0.4s ease'
              }} />
            </div>
          </div>
        )}

        {instructions.length === 0 ? (
          <div style={{ fontSize: '11px', color: isDark ? '#475569' : '#94a3b8', textAlign: 'center', marginTop: '20px' }}>
            Connection instructions will appear here after analysis
          </div>
        ) : (
          instructions.map(instr => {
            const isConnected = connectedEdgeIds.has(instr.id);
            const state = isConnected ? 'connected' : getCardState(instr, placedNodeIds);

            const stateConfig = {
              connected: { dot: '🟢', bg: isDark ? '#052e16' : '#f0fdf4', border: '#22c55e', text: isDark ? '#86efac' : '#15803d', cursor: 'default', opacity: 0.7 },
              ready:     { dot: '🟡', bg: isDark ? '#1c1917' : '#fffbeb', border: '#f59e0b', text: isDark ? '#fcd34d' : '#92400e', cursor: 'pointer', opacity: 1 },
              locked:    { dot: '🔴', bg: isDark ? '#0f172a' : '#f8fafc', border: isDark ? '#334155' : '#e2e8f0', text: isDark ? '#475569' : '#94a3b8', cursor: 'not-allowed', opacity: 0.6 },
            };
            const sc = stateConfig[state];

            return (
              <div
                key={instr.id}
                onClick={() => state === 'ready' && onConnectInstruction(instr)}
                title={
                  state === 'locked'    ? 'Place both nodes on canvas first' :
                  state === 'ready'     ? 'Click to draw connection' :
                  'Already connected'
                }
                style={{
                  padding: '8px 10px', borderRadius: '10px',
                  background: sc.bg, border: `1px solid ${sc.border}`,
                  cursor: sc.cursor, opacity: sc.opacity,
                  fontSize: '11px', color: sc.text,
                  transition: 'all 0.15s',
                  lineHeight: '1.4',
                  ...(state === 'ready' ? { boxShadow: `0 0 0 2px ${sc.border}40` } : {})
                }}
                onMouseEnter={e => { if (state === 'ready') e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <span style={{ marginRight: '5px' }}>{sc.dot}</span>
                {instr.text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
