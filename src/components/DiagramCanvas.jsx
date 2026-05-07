/**
 * DiagramCanvas.jsx
 *
 * Professional canvas engine with:
 *  - Mouse-wheel zoom (toward cursor)
 *  - Blank-drag pan
 *  - JointJS CommandManager (undo / redo)
 *  - Dark mode (paper background + grid color)
 *  - Snap-to-grid toggle
 *  - Fit-content + zoom-in/out via ref
 *  - Connect handles, Remove button, double-click label edit, keyboard delete
 */

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as joint from 'jointjs';
import 'jointjs/dist/joint.css';
import { SHAPE_MAP, DEFAULT_SIZES } from '../joint-logic/customShapes';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const getLabel = (cell) => {
    const attrs = cell.attrs;
    if (!attrs) return '';
    if (attrs.label && attrs.label.text != null) return attrs.label.text;
    if (attrs.body  && attrs.body.text  != null) return attrs.body.text;
    return '';
};

const isLinkType = (type) => type ? type.toLowerCase().includes('link') : false;

/* ── Dark / Light theme color maps ────────────────────────────────────── */
const THEME = {
    dark: {
        'uml.Actor':          { 'head/fill':'#1e293b','head/stroke':'#94a3b8','torso/stroke':'#94a3b8','arms/stroke':'#94a3b8','leftLeg/stroke':'#94a3b8','rightLeg/stroke':'#94a3b8','label/fill':'#cbd5e1' },
        'uml.UseCase':        { 'body/fill':'#1e3a5f','body/stroke':'#60a5fa','label/fill':'#e2e8f0' },
        'uml.SystemBoundary': { 'body/fill':'rgba(59,130,246,0.06)','body/stroke':'#3b82f6','label/fill':'#60a5fa' },
        'uml.StartNode':      { 'body/fill':'#e2e8f0','body/stroke':'#e2e8f0' },
        'uml.EndState':       { 'outer/fill':'#1e1e2e','outer/stroke':'#e2e8f0','inner/fill':'#e2e8f0' },
        'uml.ActionState':    { 'body/fill':'#064e3b','body/stroke':'#34d399','label/fill':'#d1fae5' },
        'uml.DecisionNode':   { 'body/fill':'#78350f','body/stroke':'#fbbf24','label/fill':'#fef3c7' },
        'dfd.Process':        { 'body/fill':'#713f12','body/stroke':'#fbbf24','label/fill':'#fef3c7' },
        'dfd.DataStore':      { 'body/fill':'#1f2937','topLine/fill':'#6b7280','bottomLine/fill':'#6b7280','label/fill':'#e2e8f0' },
        'dfd.ExternalEntity': { 'body/fill':'#1e293b','body/stroke':'#64748b','label/fill':'#e2e8f0' },
        'standard.Rectangle': { 'body/fill':'#1e3a5f','body/stroke':'#60a5fa','label/fill':'#e2e8f0' },
    },
    light: {
        'uml.Actor':          { 'head/fill':'white','head/stroke':'#1e293b','torso/stroke':'#1e293b','arms/stroke':'#1e293b','leftLeg/stroke':'#1e293b','rightLeg/stroke':'#1e293b','label/fill':'#1e293b' },
        'uml.UseCase':        { 'body/fill':'#e8f4fd','body/stroke':'#2563eb','label/fill':'#1e3a5f' },
        'uml.SystemBoundary': { 'body/fill':'rgba(219,234,254,0.12)','body/stroke':'#1d4ed8','label/fill':'#1d4ed8' },
        'uml.StartNode':      { 'body/fill':'#111827','body/stroke':'#111827' },
        'uml.EndState':       { 'outer/fill':'white','outer/stroke':'#111827','inner/fill':'#111827' },
        'uml.ActionState':    { 'body/fill':'#f0fdf4','body/stroke':'#16a34a','label/fill':'#14532d' },
        'uml.DecisionNode':   { 'body/fill':'#fffbeb','body/stroke':'#d97706','label/fill':'#92400e' },
        'dfd.Process':        { 'body/fill':'#fefce8','body/stroke':'#ca8a04','label/fill':'#713f12' },
        'dfd.DataStore':      { 'body/fill':'#f9fafb','topLine/fill':'#374151','bottomLine/fill':'#374151','label/fill':'#1f2937' },
        'dfd.ExternalEntity': { 'body/fill':'#f1f5f9','body/stroke':'#475569','label/fill':'#1e293b' },
        'standard.Rectangle': { 'body/fill':'#dbeafe','body/stroke':'#2563eb','label/fill':'#1e3a5f' },
    },
};

const applyTheme = function(cell, isDark) {
    var type = cell.get('type');
    var colors = isDark ? THEME.dark[type] : THEME.light[type];
    if (!colors) return;
    Object.keys(colors).forEach(function(path) { cell.attr(path, colors[path]); });
};

/* ── Shape factory ────────────────────────────────────────────────────────── */

const buildElement = (cell) => {
    const label   = getLabel(cell);
    const pos     = cell.position || { x: 80, y: 80 };
    const defSize = DEFAULT_SIZES[cell.type] || { width: 160, height: 60 };
    var size    = JSON.parse(JSON.stringify(cell.size || defSize));
    
    // Dynamically expand ovals and boxes if label is long
    var textLen = (label || '').length;
    if (textLen > 0) {
        var charW = 8.5;
        var pad = cell.type === 'uml.UseCase' ? 70 : 30;
        var estimatedWidth = Math.max(size.width, textLen * charW + pad);
        size.width = Math.round(estimatedWidth);
    }

    const base    = { id: cell.id, position: pos, size };

    const ShapeClass = SHAPE_MAP[cell.type];

    if (!ShapeClass) {
        console.warn('[DiagramCanvas] Unknown type "' + cell.type + '" — using fallback');
        return new joint.shapes.standard.Rectangle({
            ...base,
            attrs: {
                body:  { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2, rx: 8, ry: 8 },
                label: { text: label || cell.type, fill: '#1e3a5f', fontSize: 13, fontWeight: 'bold' },
            },
        });
    }

    try {
        const noLabel = cell.type === 'uml.StartNode' || cell.type === 'uml.EndState';
        return new ShapeClass({
            ...base,
            ...(noLabel ? {} : { attrs: { label: { text: label || cell.type.split('.')[1] } } }),
        });
    } catch (err) {
        console.warn('[DiagramCanvas] Error building "' + cell.type + '": ' + err.message);
        return new joint.shapes.standard.Rectangle({
            ...base,
            attrs: {
                body:  { fill: '#fee2e2', stroke: '#ef4444', strokeWidth: 2, rx: 4, ry: 4 },
                label: { text: label || cell.type, fill: '#7f1d1d', fontSize: 12 },
            },
        });
    }
};

/* ── Link factory ─────────────────────────────────────────────────────────── */

const buildLink = (cell) => {
    const linkLabel = cell.attrs && cell.attrs.label ? cell.attrs.label.text : null;
    return new joint.shapes.standard.Link({
        id:     cell.id,
        source: cell.source,
        target: cell.target,
        attrs:  { line: { stroke: '#6b7280', strokeWidth: 1.5, targetMarker: { type: 'arrow', size: 8 } } },
        labels: linkLabel
            ? [{ position: 0.5, attrs: { text: { text: linkLabel, fontSize: 11 } } }]
            : [],
    });
};

/* ── Tool builders ────────────────────────────────────────────────────────── */

const ResizeTool = joint.elementTools.Control.extend({
    getPosition: function(view) {
        var model = view.model;
        var size = model.get('size') || { width: 100, height: 100 };
        return { x: size.width, y: size.height };
    },
    setPosition: function(view, coordinates) {
        var model = view.model;
        var minWidth = 30;
        var minHeight = 20;
        var newWidth = Math.max(minWidth, Math.round(coordinates.x / 10) * 10);
        var newHeight = Math.max(minHeight, Math.round(coordinates.y / 10) * 10);
        model.resize(newWidth, newHeight, { ui: true });
    }
});

const makeElementTools = (elementView) => {
    const type      = elementView.model.get('type');
    const isBound   = type === 'uml.SystemBoundary';
    const isSmall   = type === 'uml.StartNode' || type === 'uml.EndState';

    const tools = [
        new joint.elementTools.Boundary({
            padding: 5, useModelGeometry: true, rotate: true,
            attributes: {
                stroke: '#3b82f6', 'stroke-width': 1.5,
                fill: 'rgba(59,130,246,0.04)', 'stroke-dasharray': '5,4',
            },
        }),
        new joint.elementTools.Remove({ x: '100%', y: '0%', offset: { x: 6, y: -6 }, rotate: true }),
        new ResizeTool({
            handleAttributes: {
                'r': 6,
                'fill': '#2563eb',
                'stroke': '#ffffff',
                'stroke-width': 1.5,
                'cursor': 'nwse-resize'
            }
        }),
    ];

    if (!isBound && joint.elementTools.Connect) {
        if (isSmall) {
            tools.push(new joint.elementTools.Connect({ x: '100%', y: '50%', offset: { x: 14, y: 0 }, rotate: false }));
        } else {
            var pts = [
                { x: '50%',  y: '0%',   offset: { x: 0,   y: -16 } },
                { x: '100%', y: '50%',  offset: { x: 16,  y: 0   } },
                { x: '50%',  y: '100%', offset: { x: 0,   y: 16  } },
                { x: '0%',   y: '50%',  offset: { x: -16, y: 0   } },
            ];
            for (var i = 0; i < pts.length; i++) {
                tools.push(new joint.elementTools.Connect({ x: pts[i].x, y: pts[i].y, offset: pts[i].offset, rotate: false }));
            }
        }
    }

    return new joint.dia.ToolsView({ name: 'hover-tools', tools: tools });
};

const makeLinkTools = () =>
    new joint.dia.ToolsView({
        name: 'link-tools',
        tools: [
            new joint.linkTools.Vertices({ snapRadius: 20 }),
            new joint.linkTools.SourceArrowhead(),
            new joint.linkTools.TargetArrowhead(),
            new joint.linkTools.Remove({ distance: '50%' }),
        ],
    });

/* ═══════════════════════════════════════════════════════════════════════════
   DiagramCanvas component
═══════════════════════════════════════════════════════════════════════════ */
const DiagramCanvas = forwardRef(function DiagramCanvas({ data, darkMode, snapGrid, onZoomChange, onSelectionChange }, ref) {
    const wrapperRef  = useRef(null);
    const paperRef    = useRef(null);
    const graphRef    = useRef(null);
    const cmdMgrRef   = useRef(null);
    const selectedRef = useRef(null);
    const panningRef  = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const panTransRef = useRef({ tx: 0, ty: 0 });

    /* ── 1. Mount: create Paper + Graph ──────────────────────────────────── */
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const mountEl = document.createElement('div');
        mountEl.style.width  = '100%';
        mountEl.style.height = '100%';
        wrapper.appendChild(mountEl);

        const W = wrapper.offsetWidth  || 900;
        const H = wrapper.offsetHeight || 600;

        const graph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });

        /* ── Snapshot-based undo / redo history ─────────────────────────── */
        var history     = [];      // array of JSON snapshots
        var historyIdx  = -1;      // pointer into history
        var ignoreChange = false;  // prevent recursive saves during restore

        var saveSnapshot = function() {
            if (ignoreChange) return;
            // Discard any "future" states beyond current pointer
            history.splice(historyIdx + 1);
            history.push(graph.toJSON());
            if (history.length > 60) { history.shift(); } // cap at 60 states
            historyIdx = history.length - 1;
        };

        // Save initial empty state
        history.push(graph.toJSON());
        historyIdx = 0;

        const paper = new joint.dia.Paper({
            el:                mountEl,
            model:             graph,
            width:             W,
            height:            H,
            gridSize:          10,
            drawGrid:          { name: 'mesh', args: { color: '#d1d5db' } },
            background:        { color: '#f9fafb' },
            interactive:       true,
            cellViewNamespace: joint.shapes,
            defaultRouter:     { name: 'normal' },
            defaultConnector:  { name: 'normal' },
            defaultLink: function() {
                return new joint.shapes.standard.Link({
                    attrs: { line: { stroke: '#6b7280', strokeWidth: 1.5, targetMarker: { type: 'arrow', size: 8 } } },
                });
            },
            defaultConnectionPoint: { name: 'boundary' },
            snapLinks:              { radius: 100 },
            linkPinning:            true,
            validateMagnet: function(_cv, magnet) {
                // Allow links to start from any element (body, hitArea, etc.)
                var tag = magnet.tagName.toLowerCase();
                return tag !== 'text';
            },
            validateConnection: function(vS, _mS, vT) {
                return !!vT && vS !== vT;
            },
        });

        /* ── Mouse-wheel zoom toward cursor ─────────────────────────────── */
        var onWheel = function(evt) {
            evt.preventDefault();
            var delta       = evt.deltaY > 0 ? -1 : 1;
            var currentScale = paper.scale().sx;
            var factor      = delta > 0 ? 1.12 : (1 / 1.12);
            var newScale    = Math.max(0.05, Math.min(5, currentScale * factor));

            // Convert mouse position to paper coords
            var t    = paper.translate();
            var rect = mountEl.getBoundingClientRect();
            var mx   = evt.clientX - rect.left;
            var my   = evt.clientY - rect.top;
            var px   = (mx - t.tx) / currentScale;
            var py   = (my - t.ty) / currentScale;

            // Translate so the point under the mouse stays fixed
            var newTx = mx - px * newScale;
            var newTy = my - py * newScale;

            paper.translate(newTx, newTy);
            paper.scale(newScale);

            if (onZoomChange) onZoomChange(Math.round(newScale * 100));
        };
        mountEl.addEventListener('wheel', onWheel, { passive: false });

        /* ── Pan: drag on blank canvas ──────────────────────────────────── */
        paper.on('blank:pointerdown', function(evt) {
            panningRef.current = true;
            var origEvt = evt.originalEvent || evt;
            panStartRef.current = { x: origEvt.clientX, y: origEvt.clientY };
            panTransRef.current = paper.translate();
            mountEl.style.cursor = 'grabbing';
        });

        /* Track history after element/link moves or attribute changes */
        graph.on('change:position change:size change:attrs add remove', function() {
            saveSnapshot();
        });

        var onMouseMove = function(evt) {
            if (!panningRef.current) return;
            var dx = evt.clientX - panStartRef.current.x;
            var dy = evt.clientY - panStartRef.current.y;
            paper.translate(panTransRef.current.tx + dx, panTransRef.current.ty + dy);
        };

        var onMouseUp = function() {
            if (panningRef.current) {
                panningRef.current = false;
                mountEl.style.cursor = '';
            }
        };

        wrapper.addEventListener('mousemove', onMouseMove);
        wrapper.addEventListener('mouseup',   onMouseUp);
        wrapper.addEventListener('mouseleave', onMouseUp);

        /* ── Hover tools ────────────────────────────────────────────────── */
        paper.on('element:mouseenter', function(elementView) {
            elementView.addTools(makeElementTools(elementView));
        });
        paper.on('element:mouseleave', function(elementView) {
            elementView.removeTools();
        });
        paper.on('link:mouseenter', function(linkView) {
            linkView.addTools(makeLinkTools());
        });
        paper.on('link:mouseleave', function(linkView) {
            linkView.removeTools();
        });

        /* ── Selection tracking ─────────────────────────────────────────── */
        paper.on('element:pointerdown', function(cv) {
            selectedRef.current = cv.model;
            if (onSelectionChange) {
                var sz = cv.model.get('size');
                var ps = cv.model.get('position');
                var lbl = cv.model.attr('label/text') || cv.model.get('type').split('.')[1] || '';
                onSelectionChange({ id: cv.model.id, type: cv.model.get('type'), width: sz.width, height: sz.height, x: ps.x, y: ps.y, label: lbl });
            }
        });
        paper.on('link:pointerdown', function(lv) {
            selectedRef.current = lv.model;
            if (onSelectionChange) onSelectionChange(null);
        });
        paper.on('blank:pointerdown', function() {
            selectedRef.current = null;
            if (onSelectionChange) onSelectionChange(null);
        });

        /* ── Double-click: edit label ────────────────────────────────────── */
        paper.on('cell:pointerdblclick', function(cv) {
            var model = cv.model;
            if (model.isLink()) {
                var lbl0 = model.label(0);
                var cur  = lbl0 && lbl0.attrs && lbl0.attrs.text ? (lbl0.attrs.text.text || '') : '';
                var next = window.prompt('Edit link label:', cur);
                if (next !== null) {
                    model.labels([{ position: 0.5, attrs: { text: { text: next, fontSize: 11 } } }]);
                }
                return;
            }
            if (model.attr('label/text') === undefined) return;
            var curLabel  = model.attr('label/text') || '';
            var nextLabel = window.prompt('Edit label:', curLabel);
            if (nextLabel !== null) model.attr('label/text', nextLabel);
        });

        /* ── Keyboard: Delete / Backspace ────────────────────────────────── */
        var onKeyDown = function(e) {
            var tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
                e.preventDefault();
                selectedRef.current.remove();
                selectedRef.current = null;
            }
            /* Ctrl+Z / Ctrl+Y shortcuts */
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (historyIdx > 0) {
                    historyIdx--;
                    ignoreChange = true;
                    graph.fromJSON(history[historyIdx]);
                    ignoreChange = false;
                }
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                if (historyIdx < history.length - 1) {
                    historyIdx++;
                    ignoreChange = true;
                    graph.fromJSON(history[historyIdx]);
                    ignoreChange = false;
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);

        /* ── Responsive resize ──────────────────────────────────────────── */
        var resizeObs = new ResizeObserver(function(entries) {
            var entry = entries[0];
            if (!entry) return;
            var cr = entry.contentRect;
            paper.setDimensions(cr.width, cr.height);
        });
        resizeObs.observe(wrapper);

        graphRef.current  = graph;
        paperRef.current  = paper;
        cmdMgrRef.current = {
            undo: function() {
                if (historyIdx <= 0) return;
                historyIdx--;
                ignoreChange = true;
                graph.fromJSON(history[historyIdx]);
                ignoreChange = false;
            },
            redo: function() {
                if (historyIdx >= history.length - 1) return;
                historyIdx++;
                ignoreChange = true;
                graph.fromJSON(history[historyIdx]);
                ignoreChange = false;
            },
            clear: function() {
                // Reset history to just the current state
                history = [graph.toJSON()];
                historyIdx = 0;
            },
        };

        return function() {
            resizeObs.disconnect();
            paper.remove();
            document.removeEventListener('keydown', onKeyDown);
            mountEl.removeEventListener('wheel', onWheel);
            wrapper.removeEventListener('mousemove',  onMouseMove);
            wrapper.removeEventListener('mouseup',    onMouseUp);
            wrapper.removeEventListener('mouseleave', onMouseUp);
            if (wrapper.contains(mountEl)) wrapper.removeChild(mountEl);
            graphRef.current  = null;
            paperRef.current  = null;
            cmdMgrRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── 2. Dark mode updates (paper + all shapes + links) ────────────────── */
    useEffect(() => {
        var paper = paperRef.current;
        var graph = graphRef.current;
        if (!paper || !graph) return;
        paper.drawBackground({ color: darkMode ? '#0f172a' : '#f9fafb' });
        paper.drawGrid({ name: 'mesh', args: { color: darkMode ? '#1e293b' : '#d1d5db' } });
        graph.getElements().forEach(function(el) { applyTheme(el, darkMode); });
        graph.getLinks().forEach(function(lk) {
            lk.attr('line/stroke', darkMode ? '#94a3b8' : '#6b7280');
        });
    }, [darkMode]);

    /* ── 3. Snap-to-grid toggle ──────────────────────────────────────────── */
    useEffect(() => {
        var paper = paperRef.current;
        if (!paper) return;
        paper.options.gridSize = snapGrid ? 10 : 1;
    }, [snapGrid]);

    /* ── 4. Render AI data ───────────────────────────────────────────────── */
    useEffect(() => {
        var graph = graphRef.current;
        var paper = paperRef.current;
        var cmd   = cmdMgrRef.current;
        if (!graph) return;

        graph.clear();
        selectedRef.current = null;

        if (!data || !Array.isArray(data.cells) || data.cells.length === 0) return;

        var shapes = data.cells.filter(function(c) { return !isLinkType(c.type); });
        var links  = data.cells.filter(function(c) { return  isLinkType(c.type); });

        var sorted = shapes.filter(function(c) { return c.type === 'uml.SystemBoundary'; })
                           .concat(shapes.filter(function(c) { return c.type !== 'uml.SystemBoundary'; }));

        // Deterministic client-side auto-layout engine
        var hasActor = sorted.some(function(s) { return s.type === 'uml.Actor'; });
        var hasDFD   = sorted.some(function(s) { return s.type.startsWith('dfd.'); });

        if (hasActor) {
            var actors    = sorted.filter(function(s) { return s.type === 'uml.Actor'; });
            var usecases  = sorted.filter(function(s) { return s.type === 'uml.UseCase'; });
            var boundary  = sorted.find(function(s) { return s.type === 'uml.SystemBoundary'; });

            // Find usecases that are targets of include/extend links
            var includeExtTargets = [];
            links.forEach(function(l) {
                var src = l.source.id;
                var tgt = l.target.id;
                var srcIsUc = usecases.some(function(u) { return u.id === src; });
                var tgtIsUc = usecases.some(function(u) { return u.id === tgt; });
                if (srcIsUc && tgtIsUc) {
                    if (!includeExtTargets.includes(tgt)) {
                        includeExtTargets.push(tgt);
                    }
                }
            });

            var ucY = 80;
            usecases.forEach(function(uc) {
                // Assign each Use Case its own distinct row
                if (includeExtTargets.includes(uc.id)) {
                    // Slide target use cases to the right in their assigned row
                    uc.position = { x: 540, y: ucY };
                } else {
                    // Position standard use cases in the primary column
                    uc.position = { x: 260, y: ucY };
                }
                ucY += 120; // Advance to the next row sequentially
            });

            // Stack actors vertically on the left periphery
            var actY = 100;
            actors.forEach(function(actor) {
                actor.position = { x: 50, y: actY };
                actY += 240;
            });

            // Fit boundary dimensions to horizontal/vertical contents
            if (boundary) {
                var maxX = 400;
                usecases.forEach(function(u) {
                    if (u.position && u.position.x + 200 > maxX) maxX = u.position.x + 200;
                });
                boundary.position = { x: 180, y: 40 };
                boundary.size = { 
                    width: Math.max(460, maxX - 160), 
                    height: Math.max(400, ucY + 40) 
                };
            }


        } else if (hasDFD) {
            var entities  = sorted.filter(function(s) { return s.type === 'dfd.ExternalEntity'; });
            var processes = sorted.filter(function(s) { return s.type === 'dfd.Process'; });
            var stores    = sorted.filter(function(s) { return s.type === 'dfd.DataStore'; });

            // Sort processes sequentially by label 
            processes.sort(function(a, b) {
                var lA = a.attrs && a.attrs.label ? a.attrs.label.text : '';
                var lB = b.attrs && b.attrs.label ? b.attrs.label.text : '';
                return lA.localeCompare(lB);
            });

            var procY = 80;
            var unassignedStores = JSON.parse(JSON.stringify(stores));
            
            processes.forEach(function(proc) {
                proc.position = { x: 300, y: procY };
                
                // Place adjacent stores
                var currentStoreX = 560;
                links.forEach(function(l) {
                    if (l.source.id === proc.id || l.target.id === proc.id) {
                        var storeId = l.source.id === proc.id ? l.target.id : l.source.id;
                        var storeIndex = unassignedStores.findIndex(function(s) { return s.id === storeId; });
                        if (storeIndex > -1) {
                            var store = unassignedStores[storeIndex];
                            store.position = { x: currentStoreX, y: procY + 15 };
                            unassignedStores.splice(storeIndex, 1);
                            currentStoreX += 220;
                        }
                    }
                });
                procY += 160;
            });

            // Place remaining stores
            var storeY = procY + 40;
            unassignedStores.forEach(function(s) {
                s.position = { x: 300, y: storeY };
                storeY += 100;
            });

            // Place entities on left column
            var entY = 80;
            entities.forEach(function(e) {
                e.position = { x: 40, y: entY };
                entY += 200;
            });
        }

        var shapeTypeMap = {};
        var processedShapes = sorted.map(function(c) {
            var newCell = JSON.parse(JSON.stringify(c));
            shapeTypeMap[newCell.id] = newCell.type;
            return buildElement(newCell);
        });

        var builtLinks = links.map(function(l) {
            var linkLabel = l.attrs && l.attrs.label ? l.attrs.label.text : null;
            var jointLink = new joint.shapes.standard.Link({
                id:     l.id,
                source: l.source,
                target: l.target,
                attrs:  { line: { stroke: '#6b7280', strokeWidth: 1.5, targetMarker: { type: 'arrow', size: 8 } } },
                labels: linkLabel
                    ? [{ position: 0.5, attrs: { text: { text: linkLabel, fontSize: 11 } } }]
                    : [],
            });

            var srcType = shapeTypeMap[l.source.id];
            var tgtType = shapeTypeMap[l.target.id];

            // Apply presentable router logic per diagram domain
            if (srcType === 'uml.UseCase' && tgtType === 'uml.UseCase') {
                jointLink.router('manhattan', { padding: 20 });
                jointLink.connector('rounded');
            } else if (srcType === 'uml.Actor' || tgtType === 'uml.Actor') {
                jointLink.router('normal');
                jointLink.connector('normal');
            } else if (srcType && (srcType.startsWith('uml.Action') || srcType.startsWith('uml.Decision') || srcType.startsWith('uml.Start') || srcType.startsWith('uml.End'))) {
                jointLink.router('manhattan', { padding: 20 });
                jointLink.connector('rounded');
            } else if (srcType && srcType.startsWith('dfd.')) {
                jointLink.router('manhattan', { padding: 20 });
                jointLink.connector('rounded');
            } else {
                jointLink.router('normal');
                jointLink.connector('normal');
            }
            return jointLink;
        });

        graph.addCells(processedShapes.concat(builtLinks));

        // Send all system boundaries to the backmost layer
        graph.getElements().forEach(function(el) {
            if (el.get('type') === 'uml.SystemBoundary') {
                el.toBack();
            }
        });

        /* Clear undo history so "Undo" doesn't wipe the AI-generated diagram */
        if (cmd) cmd.clear();

        console.log('[CANVAS] rendered', sorted.length, 'shapes +', links.length, 'links');

        requestAnimationFrame(function() {
            if (paper) {
                var w = wrapperRef.current ? wrapperRef.current.offsetWidth : 900;
                var h = wrapperRef.current ? wrapperRef.current.offsetHeight : 600;
                var pad = Math.min(w, h) * 0.08;
                paper.scaleContentToFit({ padding: Math.max(40, pad), maxScale: 1.4, minScale: 0.1 });
                var s = paper.scale().sx;
                if (onZoomChange) onZoomChange(Math.round(s * 100));
            }
        });
    }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── 5. Expose imperative API to Dashboard ───────────────────────────── */
    useImperativeHandle(ref, function() {
        return {
            addShape: function(type) {
                var graph = graphRef.current;
                var paper = paperRef.current;
                if (!graph) return;
                var id = type.replace('.', '-') + '-' + Date.now();
                /* Centre new shape in current viewport */
                var cx = 200, cy = 200;
                if (paper && wrapperRef.current) {
                    var t = paper.translate(), sc = paper.scale().sx;
                    cx = (wrapperRef.current.offsetWidth / 2 - t.tx) / sc;
                    cy = (wrapperRef.current.offsetHeight / 2 - t.ty) / sc;
                }
                if (type === 'standard.Link') {
                    graph.addCell(new joint.shapes.standard.Link({
                        id,
                        source: { x: cx - 80, y: cy },
                        target: { x: cx + 80, y: cy },
                        attrs:  { line: { stroke: darkMode ? '#94a3b8' : '#6b7280', strokeWidth: 1.5, targetMarker: { type: 'arrow', size: 8 } } },
                    }));
                    return;
                }
                if (type === 'curved.Link') {
                    var clk = new joint.shapes.standard.Link({
                        id,
                        source: { x: cx - 80, y: cy },
                        target: { x: cx + 80, y: cy },
                        attrs:  { line: { stroke: darkMode ? '#94a3b8' : '#6b7280', strokeWidth: 1.5, targetMarker: { type: 'arrow', size: 8 } } },
                    });
                    clk.router('manhattan', { padding: 20 });
                    clk.connector('rounded');
                    graph.addCell(clk);
                    return;
                }
                var defSize = DEFAULT_SIZES[type] || { width: 160, height: 60 };
                var pos = { x: cx - defSize.width / 2, y: cy - defSize.height / 2 };
                var defLabel = type.split('.')[1] || type;
                var el = buildElement({ id, type, position: pos, attrs: { label: { text: defLabel } } });
                applyTheme(el, darkMode);
                graph.addCell(el);
                if (type === 'uml.SystemBoundary') {
                    el.toBack();
                }
            },
            undo: function() {
                if (cmdMgrRef.current) cmdMgrRef.current.undo();
            },
            redo: function() {
                if (cmdMgrRef.current) cmdMgrRef.current.redo();
            },
            resizeShape: function(cellId, w, h) {
                var graph = graphRef.current;
                if (!graph) return;
                var cell = graph.getCell(cellId);
                if (cell && !cell.isLink()) cell.resize(Math.max(20, w), Math.max(20, h));
            },
            fitContent: function() {
                var p = paperRef.current;
                if (!p) return;
                var wrapper = wrapperRef.current;
                var pad = wrapper ? Math.min(wrapper.offsetWidth, wrapper.offsetHeight) * 0.08 : 60;
                p.scaleContentToFit({ padding: Math.max(40, pad), maxScale: 2, minScale: 0.1 });
                var s = p.scale().sx;
                if (onZoomChange) onZoomChange(Math.round(s * 100));
            },
            zoomIn: function() {
                var p = paperRef.current;
                if (!p) return;
                var newScale = Math.min(p.scale().sx * 1.2, 5);
                p.scale(newScale);
                if (onZoomChange) onZoomChange(Math.round(newScale * 100));
            },
            zoomOut: function() {
                var p = paperRef.current;
                if (!p) return;
                var newScale = Math.max(p.scale().sx / 1.2, 0.05);
                p.scale(newScale);
                if (onZoomChange) onZoomChange(Math.round(newScale * 100));
            },
            resetZoom: function() {
                var p = paperRef.current;
                if (!p) return;
                p.scale(1);
                p.translate(0, 0);
                if (onZoomChange) onZoomChange(100);
            },
            exportPNG: function() {
                var p = paperRef.current;
                if (!p) return;
                p.hideTools();
                var svg = p.svg;
                var bbox = p.getContentBBox();
                var PAD = 40;
                var cloned = svg.cloneNode(true);
                cloned.setAttribute('width', bbox.width + PAD * 2);
                cloned.setAttribute('height', bbox.height + PAD * 2);
                cloned.setAttribute('viewBox', (bbox.x - PAD) + ' ' + (bbox.y - PAD) + ' ' + (bbox.width + PAD * 2) + ' ' + (bbox.height + PAD * 2));
                var serializer = new XMLSerializer();
                var svgStr = serializer.serializeToString(cloned);
                var canvas = document.createElement('canvas');
                var scale = 2;
                canvas.width  = (bbox.width + PAD * 2) * scale;
                canvas.height = (bbox.height + PAD * 2) * scale;
                var ctx = canvas.getContext('2d');
                ctx.fillStyle = darkMode ? '#0f172a' : '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                var img = new Image();
                var blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                var url = URL.createObjectURL(blob);
                img.onload = function() {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    URL.revokeObjectURL(url);
                    var link = document.createElement('a');
                    link.download = 'diagram.png';
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                };
                img.src = url;
                p.showTools();
            },
            exportSVG: function() {
                var p = paperRef.current;
                if (!p) return;
                p.hideTools();
                var svg = p.svg;
                var bbox = p.getContentBBox();
                var PAD = 40;
                var cloned = svg.cloneNode(true);
                cloned.setAttribute('width', bbox.width + PAD * 2);
                cloned.setAttribute('height', bbox.height + PAD * 2);
                cloned.setAttribute('viewBox', (bbox.x - PAD) + ' ' + (bbox.y - PAD) + ' ' + (bbox.width + PAD * 2) + ' ' + (bbox.height + PAD * 2));
                // Add white/dark background rect
                var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                bgRect.setAttribute('width', '100%');
                bgRect.setAttribute('height', '100%');
                bgRect.setAttribute('fill', darkMode ? '#0f172a' : '#ffffff');
                cloned.insertBefore(bgRect, cloned.firstChild);
                var serializer = new XMLSerializer();
                var svgStr = serializer.serializeToString(cloned);
                var blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
                var link = document.createElement('a');
                link.download = 'diagram.svg';
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
                p.showTools();
            },
            exportJSON: function() {
                var g = graphRef.current;
                if (!g) return;
                var json = JSON.stringify(g.toJSON(), null, 2);
                var blob = new Blob([json], { type: 'application/json' });
                var link = document.createElement('a');
                link.download = 'diagram.json';
                link.href = URL.createObjectURL(blob);
                link.click();
                URL.revokeObjectURL(link.href);
            },
            renameShape: function(cellId, newLabel) {
                var graph = graphRef.current;
                if (!graph) return;
                var cell = graph.getCell(cellId);
                if (cell && !cell.isLink()) {
                    cell.attr('label/text', newLabel);
                }
            },
            moveShape: function(cellId, x, y) {
                var graph = graphRef.current;
                if (!graph) return;
                var cell = graph.getCell(cellId);
                if (cell && !cell.isLink()) {
                    cell.position(x, y);
                }
            },
            deleteSelected: function() {
                if (selectedRef.current) {
                    selectedRef.current.remove();
                    selectedRef.current = null;
                    if (onSelectionChange) onSelectionChange(null);
                }
            },
            clearAll: function() {
                var g = graphRef.current;
                if (!g) return;
                g.clear();
                selectedRef.current = null;
                if (onSelectionChange) onSelectionChange(null);
            },
        };
    });

    return (
        <div
            ref={wrapperRef}
            style={{
                position:   'absolute',
                inset:      0,
                overflow:   'hidden',
                background: darkMode ? '#0f172a' : '#f3f4f6',
                cursor:     'default',
            }}
        />
    );
});

export default DiagramCanvas;