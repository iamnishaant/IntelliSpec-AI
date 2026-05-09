/**
 * NodePanel.jsx
 * Column B: AI-detected node chips (draggable onto canvas)
 * Column C: Connection instruction cards (🔴🟡🟢 state machine)
 */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';

/* ── Category config ─────────────────────────────────────────────── */
const CATEGORY_META = {
  actor:      { icon: '🧍', color: '#3b82f6', bg: '#dbeafe', label: 'Actors',           jointType: 'uml.Actor' },
  use_case:   { icon: '🔵', color: '#7c3aed', bg: '#ede9fe', label: 'Use Cases',         jointType: 'uml.UseCase' },
  process:    { icon: '🟩', color: '#16a34a', bg: '#dcfce7', label: 'Processes',         jointType: 'uml.ActionState' },
  data_store: { icon: '🗄️', color: '#ea580c', bg: '#ffedd5', label: 'Data Stores',      jointType: 'dfd.DataStore' },
  system:     { icon: '🔲', color: '#0284c7', bg: '#e0f2fe', label: 'System Boundary',   jointType: 'uml.SystemBoundary' },
  external:   { icon: '📦', color: '#64748b', bg: '#f1f5f9', label: 'External Entities', jointType: 'dfd.ExternalEntity' },
  decision:   { icon: '🔶', color: '#d97706', bg: '#fef3c7', label: 'Decisions',         jointType: 'uml.DecisionNode' },
  note:       { icon: '📝', color: '#ca8a04', bg: '#fefce8', label: 'Notes',             jointType: 'uml.Note' },
  constraint: { icon: '📐', color: '#2563eb', bg: '#eff6ff', label: 'Constraints',       jointType: 'uml.Constraint' },
  start:      { icon: '⚫', color: '#1e293b', bg: '#e2e8f0', label: 'Start Point',      jointType: 'uml.StartNode' },
  end:        { icon: '🔴', color: '#dc2626', bg: '#fee2e2', label: 'End State',        jointType: 'uml.EndState' },
};

const DEFAULT_META = { icon: '📦', color: '#6366f1', bg: '#e0e7ff', label: 'Nodes', jointType: 'uml.UseCase' };

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
  onConnectInstruction, 
  onDropAll,          
  isDark = false,
  T = {}
}) {
  const containerRef = useRef(null);
  const [colBWidth, setColBWidth] = useState(200); // Increased default width
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e) => {
    if (isResizing && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      if (newWidth > 60 && newWidth < containerRect.width - 60) {
        setColBWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

    useEffect(() => {
        const styleId = 'nodepanel-animations';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes pulse-ready {
                    0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
                    70% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
                }
                .instr-card-ready {
                    animation: pulse-ready 2s infinite;
                    transform: scale(1.02);
                }
            `;
            document.head.appendChild(style);
        }
    }, []);

    /* Group nodes by category */
    const grouped = useMemo(() => {
        const map = {};
        const order = ['actor', 'use_case', 'process', 'data_store', 'decision', 'note', 'constraint', 'start', 'end'];
        order.forEach(cat => map[cat] = []);

        nodes.forEach(n => {
            const cat = n.category || 'use_case';
            if (!map[cat]) map[cat] = [];
            map[cat].push(n);
        });
        return map;
    }, [nodes]);

    const unplacedCount = nodes.filter(n => !placedNodeIds.has(n.id)).length;
    const connectedCount = instructions.filter(i => connectedEdgeIds.has(i.id)).length;

    const handleDragStart = (e, node) => {
        // Priority: use node.jointType from AI engine (standards-compliant)
        // Fallback: use meta.jointType from CATEGORY_META
        const meta = getMeta(node.category);
        const resolvedJointType = node.jointType || meta.jointType;
        e.dataTransfer.setData('application/intellispec-node', JSON.stringify({
            ...node,
            jointType: resolvedJointType,  // Always pass the resolved type
        }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    const colStyle = {
        background: isDark ? '#1e293b' : '#ffffff',
        padding: '12px 10px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flexShrink: 0,
    };

    return (
        <div ref={containerRef} style={{ display: 'flex', height: '100%', fontFamily: 'Inter, sans-serif', position: 'relative' }}>

            {/* ── Column B: Semantic Entities ───────────────────────────── */}
            <div style={{ ...colStyle, width: colBWidth, borderRight: `1px solid ${isDark ? '#334155' : '#e2e8f0'}` }}>
                <div style={{ 
                    fontSize: '10px', fontWeight: '800', color: isDark ? '#64748b' : '#94a3b8', 
                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px',
                    display: 'flex', justifyContent: 'space-between'
                }}>
                    <span>Detected Entities</span>
                    {unplacedCount > 0 && <span style={{ color: T.accent }}>{unplacedCount} pending</span>}
                </div>

                {nodes.length === 0 ? (
                    <div style={{ fontSize: '11px', color: isDark ? '#475569' : '#94a3b8', textAlign: 'center', marginTop: '40px', padding: '0 10px' }}>
                        No entities detected. Try a different requirement prompt.
                    </div>
                ) : (
                    Object.entries(grouped).map(([cat, catNodes], i) => {
                        if (catNodes.length === 0) return null;
                        const meta = getMeta(cat);
                        return (
                            <div key={cat} style={{ marginBottom: '24px', borderTop: i > 0 ? `1px solid ${isDark ? '#334155' : '#f1f5f9'}` : 'none', paddingTop: i > 0 ? '16px' : '0' }}>
                                <div style={{ 
                                    fontSize: '10px', fontWeight: '900', color: meta.color, 
                                    textTransform: 'uppercase', marginBottom: '10px', 
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    letterSpacing: '0.05em'
                                }}>
                                    <span style={{ fontSize: '12px' }}>{meta.icon}</span>
                                    {meta.label}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {catNodes.map(node => {
                                        const placed = placedNodeIds.has(node.id);
                                        return (
                                            <div
                                                key={node.id}
                                                draggable={!placed}
                                                onDragStart={e => handleDragStart(e, node)}
                                                style={{
                                                    display: 'flex', flexDirection: 'column',
                                                    padding: '8px 12px', borderRadius: '10px',
                                                    background: placed ? (isDark ? '#0f172a' : '#f8fafc') : meta.bg,
                                                    border: `1px solid ${placed ? (isDark ? '#1e293b' : '#f1f5f9') : meta.color}44`,
                                                    borderLeft: `3px solid ${placed ? (isDark ? '#1e293b' : '#cbd5e1') : meta.color}`,
                                                    cursor: placed ? 'default' : 'grab',
                                                    opacity: placed ? 0.6 : 1,
                                                    transition: 'all 0.2s',
                                                    boxShadow: placed ? 'none' : '0 2px 5px rgba(0,0,0,0.04)'
                                                }}
                                            >
                                                <div style={{ fontSize: '11px', fontWeight: '700', color: placed ? T.textSubtle : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {node.label}
                                                </div>
                                                <div style={{ fontSize: '8px', color: meta.color, fontWeight: '700', textTransform: 'uppercase', marginTop: '2px', opacity: 0.8 }}>
                                                    {cat} {placed && '✓'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })
                )}

                {unplacedCount > 0 && (
                    <button
                        onClick={onDropAll}
                        style={{
                            marginTop: 'auto', padding: '10px', borderRadius: '10px',
                            background: T.accent, color: '#fff', border: 'none',
                            fontSize: '11px', fontWeight: '800', cursor: 'pointer',
                            boxShadow: '0 4px 12px ' + T.accent + '44'
                        }}
                    >
                        ⚡ Place All ({unplacedCount})
                    </button>
                )}
            </div>

            {/* ── Internal Resizer ── */}
            <div 
                onMouseDown={startResizing}
                style={{
                    width: '6px', cursor: 'col-resize', 
                    background: isResizing ? '#6366f1' : 'transparent',
                    zIndex: 10, position: 'relative',
                    marginLeft: '-3px', marginRight: '-3px'
                }}
            />

            {/* ── Column C: Instructions ─────────────────────────────── */}
            <div style={{ ...colStyle, flex: 1, minWidth: '100px' }}>
                <div style={{ fontSize: '10px', fontWeight: '800', color: isDark ? '#64748b' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                    Construction Guide
                </div>

                {instructions.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '9px', color: isDark ? '#64748b' : '#94a3b8', marginBottom: '4px', fontWeight: '700' }}>
                            {Math.round((connectedCount/instructions.length)*100)}% Complete
                        </div>
                        <div style={{ height: '6px', borderRadius: '3px', background: isDark ? '#1e293b' : '#e2e8f0', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                                width: `${instructions.length ? (connectedCount / instructions.length) * 100 : 0}%`,
                                transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
                            }} />
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {instructions.map(instr => {
                        const isConnected = connectedEdgeIds.has(instr.id);
                        const state = isConnected ? 'connected' : getCardState(instr, placedNodeIds);

                        const stateConfig = {
                            connected: { dot: '✅', bg: isDark ? '#052e16' : '#f0fdf4', border: '#22c55e', text: isDark ? '#86efac' : '#15803d', cursor: 'default', opacity: 0.8 },
                            ready:     { dot: '🔥', bg: isDark ? '#2a1a05' : '#fffbeb', border: '#f59e0b', text: isDark ? '#fcd34d' : '#92400e', cursor: 'pointer', opacity: 1 },
                            locked:    { dot: '🔒', bg: isDark ? '#0f172a' : '#f8fafc', border: isDark ? '#1e293b' : '#e2e8f0', text: isDark ? '#475569' : '#94a3b8', cursor: 'not-allowed', opacity: 0.5 },
                        };
                        const sc = stateConfig[state];

                        return (
                            <div
                                key={instr.id}
                                onClick={() => state === 'ready' && onConnectInstruction(instr)}
                                className={state === 'ready' ? 'instr-card-ready' : ''}
                                style={{
                                    padding: '12px', borderRadius: '12px',
                                    background: sc.bg, border: `1px solid ${sc.border}`,
                                    cursor: sc.cursor, opacity: sc.opacity,
                                    fontSize: '11px', color: sc.text,
                                    transition: 'all 0.3s ease',
                                    lineHeight: '1.4',
                                    wordBreak: 'break-word',
                                    fontWeight: state === 'ready' ? '700' : '500',
                                    display: 'flex', alignItems: 'center', gap: '8px'
                                }}
                            >
                                <span style={{ fontSize: '14px' }}>{sc.dot}</span>
                                {instr.text}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
