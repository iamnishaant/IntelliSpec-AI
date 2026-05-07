import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   Shape catalogue grouped by diagram type.
   Each entry has: type (JointJS type string), label, icon (inline SVG).
═══════════════════════════════════════════════════════════════════════════ */
const SHAPE_GROUPS = [
    {
        id: 'usecase', label: 'Use Case',
        color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe',
        darkColor: '#60a5fa', darkBg: '#1e3a5f', darkBorder: '#2563eb',
        shapes: [
            {
                type: 'uml.Actor', label: 'Actor',
                icon: (
                    <svg viewBox="0 0 40 60" fill="none" style={{ width: 28, height: 40 }}>
                        <circle cx="20" cy="9"  r="8"  stroke="#1a1a2e" strokeWidth="2" fill="white" />
                        <line x1="20" y1="17" x2="20" y2="38" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" />
                        <line x1="5"  y1="27" x2="35" y2="27" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" />
                        <line x1="20" y1="38" x2="7"  y2="53" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" />
                        <line x1="20" y1="38" x2="33" y2="53" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                ),
            },
            {
                type: 'uml.UseCase', label: 'Use Case',
                icon: (
                    <svg viewBox="0 0 80 36" fill="none" style={{ width: 64, height: 28 }}>
                        <ellipse cx="40" cy="18" rx="38" ry="16" fill="#e8f4fd" stroke="#2563eb" strokeWidth="2" />
                        <text x="40" y="22" textAnchor="middle" fontSize="8" fill="#1e3a5f" fontFamily="sans-serif">Use Case</text>
                    </svg>
                ),
            },
            {
                type: 'uml.SystemBoundary', label: 'System Boundary',
                icon: (
                    <svg viewBox="0 0 64 44" fill="none" style={{ width: 52, height: 36 }}>
                        <rect x="2" y="2" width="60" height="40" rx="3"
                            fill="rgba(219,234,254,0.25)" stroke="#1d4ed8"
                            strokeWidth="2" strokeDasharray="6 3" />
                        <text x="32" y="14" textAnchor="middle" fontSize="8" fill="#1d4ed8" fontFamily="sans-serif">System</text>
                    </svg>
                ),
            },
        ],
    },
    {
        id: 'activity', label: 'Activity',
        color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0',
        darkColor: '#4ade80', darkBg: '#064e3b', darkBorder: '#16a34a',
        shapes: [
            {
                type: 'uml.StartNode', label: 'Start Node',
                icon: (
                    <svg viewBox="0 0 30 30" fill="none" style={{ width: 26, height: 26 }}>
                        <circle cx="15" cy="15" r="13" fill="#111827" />
                    </svg>
                ),
            },
            {
                type: 'uml.EndState', label: 'End State',
                icon: (
                    <svg viewBox="0 0 36 36" fill="none" style={{ width: 30, height: 30 }}>
                        <circle cx="18" cy="18" r="16" fill="white" stroke="#111827" strokeWidth="2" />
                        <circle cx="18" cy="18" r="10" fill="#111827" />
                    </svg>
                ),
            },
            {
                type: 'uml.ActionState', label: 'Action State',
                icon: (
                    <svg viewBox="0 0 80 36" fill="none" style={{ width: 60, height: 28 }}>
                        <rect x="2" y="2" width="76" height="32" rx="14"
                            fill="#f0fdf4" stroke="#16a34a" strokeWidth="2" />
                        <text x="40" y="22" textAnchor="middle" fontSize="8" fill="#14532d" fontFamily="sans-serif">Action</text>
                    </svg>
                ),
            },
            {
                type: 'uml.DecisionNode', label: 'Decision',
                icon: (
                    <svg viewBox="0 0 60 40" fill="none" style={{ width: 48, height: 32 }}>
                        <polygon points="30,2 58,20 30,38 2,20"
                            fill="#fffbeb" stroke="#d97706" strokeWidth="2" />
                        <text x="30" y="24" textAnchor="middle" fontSize="10" fill="#92400e" fontFamily="sans-serif">?</text>
                    </svg>
                ),
            },
        ],
    },
    {
        id: 'dfd', label: 'DFD',
        color: '#d97706', bg: '#fffbeb', border: '#fde68a',
        darkColor: '#fbbf24', darkBg: '#78350f', darkBorder: '#d97706',
        shapes: [
            {
                type: 'dfd.Process', label: 'Process',
                icon: (
                    <svg viewBox="0 0 80 50" fill="none" style={{ width: 60, height: 38 }}>
                        <ellipse cx="40" cy="25" rx="37" ry="22"
                            fill="#fefce8" stroke="#ca8a04" strokeWidth="2" />
                        <text x="40" y="29" textAnchor="middle" fontSize="8" fill="#713f12" fontFamily="sans-serif">Process</text>
                    </svg>
                ),
            },
            {
                type: 'dfd.DataStore', label: 'Data Store',
                icon: (
                    <svg viewBox="0 0 80 30" fill="none" style={{ width: 60, height: 24 }}>
                        <rect x="0" y="0" width="80" height="30" fill="#f9fafb" />
                        <line x1="2" y1="3"  x2="78" y2="3"  stroke="#374151" strokeWidth="2.5" />
                        <line x1="2" y1="27" x2="78" y2="27" stroke="#374151" strokeWidth="2.5" />
                        <text x="40" y="19" textAnchor="middle" fontSize="7" fill="#1f2937" fontFamily="sans-serif">Data Store</text>
                    </svg>
                ),
            },
            {
                type: 'dfd.ExternalEntity', label: 'External Entity',
                icon: (
                    <svg viewBox="0 0 64 40" fill="none" style={{ width: 52, height: 32 }}>
                        <rect x="2" y="2" width="60" height="36" rx="2"
                            fill="#f1f5f9" stroke="#475569" strokeWidth="2" />
                        <text x="32" y="23" textAnchor="middle" fontSize="7.5" fill="#1e293b" fontFamily="sans-serif">Entity</text>
                    </svg>
                ),
            },
        ],
    },
    {
        id: 'general', label: 'General',
        color: '#4b5563', bg: '#f9fafb', border: '#e5e7eb',
        darkColor: '#94a3b8', darkBg: '#1e293b', darkBorder: '#475569',
        shapes: [
            {
                type: 'standard.Rectangle', label: 'Rectangle',
                icon: (
                    <svg viewBox="0 0 80 36" fill="none" style={{ width: 60, height: 28 }}>
                        <rect x="2" y="2" width="76" height="32" rx="6"
                            fill="#dbeafe" stroke="#2563eb" strokeWidth="2" />
                        <text x="40" y="22" textAnchor="middle" fontSize="8" fill="#1e3a5f" fontFamily="sans-serif">Rectangle</text>
                    </svg>
                ),
            },
            {
                type: 'standard.Link', label: 'Straight Arrow',
                icon: (
                    <svg viewBox="0 0 80 20" fill="none" style={{ width: 60, height: 18 }}>
                        <line x1="4"  y1="10" x2="64" y2="10" stroke="#6b7280" strokeWidth="2" />
                        <polygon points="64,5 78,10 64,15" fill="#6b7280" />
                    </svg>
                ),
            },
            {
                type: 'curved.Link', label: 'Curved Arrow',
                icon: (
                    <svg viewBox="0 0 80 20" fill="none" style={{ width: 60, height: 18 }}>
                        <path d="M4,15 C30,0 40,25 64,10" stroke="#6b7280" strokeWidth="2" fill="none" />
                        <polygon points="64,5 78,10 64,15" fill="#6b7280" />
                    </svg>
                ),
            },
        ],
    },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Toolbox Component
═══════════════════════════════════════════════════════════════════════════ */
const Toolbox = ({ onAddShape, darkMode }) => {
    const [openGroups, setOpenGroups] = useState(
        Object.fromEntries(SHAPE_GROUPS.map(g => [g.id, true]))
    );

    const toggle = (id) =>
        setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }));

    return (
        <aside style={{
            width: '184px', minWidth: '184px',
            background: darkMode ? '#111827' : '#ffffff',
            borderRight: darkMode ? '1px solid #334155' : '1px solid #e5e7eb',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
            boxShadow: darkMode ? '2px 0 12px rgba(0,0,0,0.3)' : '2px 0 8px rgba(0,0,0,0.08)',
            transition: 'background 0.2s, border-color 0.2s',
        }}>

            {/* Header */}
            <div style={{
                padding: '10px 12px 8px',
                borderBottom: darkMode ? '1px solid #334155' : '1px solid #f3f4f6',
                background: darkMode
                    ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
                    : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            }}>
                <p style={{
                    margin: 0, fontSize: '9px', letterSpacing: '0.1em',
                    textTransform: 'uppercase', fontWeight: '800',
                    color: darkMode ? '#94a3b8' : '#94a3b8',
                    fontFamily: 'Inter, sans-serif',
                }}>
                    🧰 Toolbox
                </p>
                <p style={{
                    margin: '2px 0 0', fontSize: '10px',
                    color: darkMode ? '#64748b' : '#cbd5e1',
                    fontFamily: 'Inter, sans-serif',
                }}>
                    Click to add shape
                </p>
            </div>

            {/* Shape groups */}
            {SHAPE_GROUPS.map(function(group) {
                var gc  = darkMode ? group.darkColor  : group.color;
                var gbg = darkMode ? group.darkBg     : group.bg;
                var gbd = darkMode ? group.darkBorder : group.border;
                return (
                <div key={group.id}>
                    {/* Group header / toggle */}
                    <button
                        onClick={() => toggle(group.id)}
                        style={{
                            width: '100%', display: 'flex',
                            alignItems: 'center', justifyContent: 'space-between',
                            padding: '7px 12px',
                            background: gbg,
                            border: 'none',
                            borderBottom: '1px solid ' + gbd,
                            borderTop: '1px solid ' + gbd,
                            cursor: 'pointer',
                            color: gc,
                            fontSize: '10px', fontWeight: '800',
                            letterSpacing: '0.07em',
                            fontFamily: 'Inter, sans-serif',
                        }}
                    >
                        <span>{group.label.toUpperCase()}</span>
                        {openGroups[group.id]
                            ? <ChevronDown size={11} />
                            : <ChevronRight size={11} />
                        }
                    </button>

                    {/* Shape buttons */}
                    {openGroups[group.id] && (
                        <div style={{
                            padding: '6px 8px',
                            display: 'flex', flexDirection: 'column', gap: '3px',
                            borderBottom: '1px solid ' + gbd,
                        }}>
                            {group.shapes.map(shape => (
                                <button
                                    key={shape.type}
                                    id={'toolbox-' + shape.type.replace('.', '-')}
                                    title={'Add ' + shape.label + ' to canvas'}
                                    onClick={() => onAddShape(shape.type)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '6px 8px', borderRadius: '8px',
                                        border: '1px solid transparent',
                                        background: 'transparent',
                                        cursor: 'pointer', textAlign: 'left',
                                        transition: 'all 0.15s ease', width: '100%',
                                    }}
                                    onMouseEnter={function(e) {
                                        e.currentTarget.style.background  = gbg;
                                        e.currentTarget.style.borderColor = gbd;
                                        e.currentTarget.style.transform   = 'translateX(2px)';
                                    }}
                                    onMouseLeave={function(e) {
                                        e.currentTarget.style.background  = 'transparent';
                                        e.currentTarget.style.borderColor = 'transparent';
                                        e.currentTarget.style.transform   = 'translateX(0)';
                                    }}
                                    onMouseDown={function(e) {
                                        e.currentTarget.style.transform = 'scale(0.96)';
                                    }}
                                    onMouseUp={function(e) {
                                        e.currentTarget.style.transform = 'translateX(2px)';
                                    }}
                                >
                                    {/* Icon */}
                                    <div style={{
                                        flexShrink: 0, width: '44px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        {shape.icon}
                                    </div>
                                    {/* Label */}
                                    <span style={{
                                        fontSize: '11px',
                                        color: darkMode ? '#e2e8f0' : '#374151',
                                        lineHeight: 1.3, fontFamily: 'Inter, sans-serif',
                                    }}>
                                        {shape.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ); })}
        </aside>
    );
};

export default Toolbox;
