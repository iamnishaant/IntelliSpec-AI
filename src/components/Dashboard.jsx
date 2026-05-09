import React, { useState, useRef, useCallback } from 'react';
import DiagramCanvas from './DiagramCanvas';
import Toolbox from './Toolbox';
import NodePanel from './NodePanel';
import { UploadCloud, Cpu, Send, Loader2, Download, Trash2, Edit3, XCircle, Image, FileJson, FileText } from 'lucide-react';


import logbookSrs from '../srs_data/1_Logbook_User_Stories_intelligence.json';
import bhavikaSrs from '../srs_data/2_SRS Doc_BHAVIKA GONDI_intelligence.json';
import sreeramSrs from '../srs_data/3_SRS_Grp6_SREERAM R_intelligence.json';
import medicoreSrs from '../srs_data/4_MediCore_HMS_SRS_intelligence.json';
import seGrpSrs from '../srs_data/5_SE_grp__intelligence.json';
import { generateDiagram } from '../joint-logic/promptEngine.js';
import { extractGraphWithGroq, getJointShapeForCategory, parseDocumentViaBackend } from '../joint-logic/pureFrontendEngine.js';


/* ═══════════════════════════════════════════════════════════════════════════
   JSON helpers
═══════════════════════════════════════════════════════════════════════════ */

/** Strip markdown fences and parse JSON from Gemini's response. */
const parseGeminiJson = (rawText) => {
    console.log('[STEP 4] Raw text from Gemini:', rawText);

    const stripped = rawText
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .trim();

    console.log('[STEP 5] Stripped text:', stripped);

    let parsed;
    try {
        parsed = JSON.parse(stripped);
    } catch (e) {
        console.error('[STEP 5 FAIL] JSON.parse error:', e.message);
        throw new Error('AI returned text that could not be parsed as JSON: ' + e.message);
    }

    console.log('[STEP 6] Parsed object:', parsed);

    if (Array.isArray(parsed)) return { cells: parsed };
    if (parsed && parsed.cells && Array.isArray(parsed.cells)) return parsed;

    const nested = Object.values(parsed).find(v => v && v.cells && Array.isArray(v.cells));
    if (nested) return nested;

    throw new Error('AI returned JSON but it has no recognisable "cells" array.');
};

/** Validate every cell has the required fields. */
const validateCells = (cells) => {
    console.log('[STEP 7] Validating', cells.length, 'cells…');
    for (const cell of cells) {
        if (!cell.id || !cell.type)
            throw new Error('Cell missing id or type: ' + JSON.stringify(cell));
        if (!cell.type.toLowerCase().includes('link')) {
            if (!cell.position || !cell.size)
                throw new Error('Shape "' + cell.id + '" missing position or size.');
        }
    }
    console.log('[STEP 7] All cells valid ✓');
};

/* ═══════════════════════════════════════════════════════════════════════════
   AI Prompt Engine
═══════════════════════════════════════════════════════════════════════════ */

const detectDiagramType = (req) => {
    const l = req.toLowerCase();
    if (l.includes('use case') || l.includes('usecase') || l.includes('actor')) return 'usecase';
    if (l.includes('activity') || l.includes('workflow') || l.includes('flowchart') || l.includes('flow diagram')) return 'activity';
    if (l.includes('dfd') || l.includes('data flow') || l.includes('dataflow') || l.includes('data-flow')) return 'dfd';
    return 'generic';
};

/* Per-diagram-type rules injected into the AI system prompt */
const DIAGRAM_RULES = {

    usecase: `DIAGRAM TYPE: UML Use Case Diagram

SHAPES TO USE — use ONLY these exact "type" values:
  "uml.SystemBoundary"  — ONE large dashed rectangle enclosing all use cases
                          default size: {"width":650,"height":450}
  "uml.Actor"           — stick figure for each actor, placed OUTSIDE the boundary
                          default size: {"width":60,"height":100}
  "uml.UseCase"         — oval for each use case, placed INSIDE the boundary
                          default size: {"width":180,"height":60}
  "standard.Link"       — arrow from Actor→UseCase or UseCase→UseCase (<<include>>/<<extend>>)

LAYOUT:
  • Place actors on the LEFT side of the SystemBoundary (x ≈ 20)
  • Place use cases inside the boundary starting at x ≈ boundary.x + 120
  • Space actors 200 px apart vertically; use cases 130 px apart vertically
  • AVOID use case overlapping. Distribute use cases horizontally into multiple columns if there are more than 4.
  • SystemBoundary must start at approximately {"x":140,"y":40}

EXAMPLE (library):
{"cells":[
  {"id":"sb","type":"uml.SystemBoundary","position":{"x":120,"y":40},"size":{"width":650,"height":450},"attrs":{"label":{"text":"Library System"}}},
  {"id":"a1","type":"uml.Actor","position":{"x":20,"y":100},"size":{"width":60,"height":100},"attrs":{"label":{"text":"Student"}}},
  {"id":"a2","type":"uml.Actor","position":{"x":20,"y":300},"size":{"width":60,"height":100},"attrs":{"label":{"text":"Librarian"}}},
  {"id":"uc1","type":"uml.UseCase","position":{"x":220,"y":80},"size":{"width":180,"height":60},"attrs":{"label":{"text":"Borrow Book"}}},
  {"id":"uc2","type":"uml.UseCase","position":{"x":220,"y":200},"size":{"width":180,"height":60},"attrs":{"label":{"text":"Return Book"}}},
  {"id":"uc3","type":"uml.UseCase","position":{"x":220,"y":320},"size":{"width":180,"height":60},"attrs":{"label":{"text":"Manage Catalog"}}},
  {"id":"l1","type":"standard.Link","source":{"id":"a1"},"target":{"id":"uc1"},"attrs":{"label":{"text":""}}},
  {"id":"l2","type":"standard.Link","source":{"id":"a1"},"target":{"id":"uc2"},"attrs":{"label":{"text":""}}},
  {"id":"l3","type":"standard.Link","source":{"id":"a2"},"target":{"id":"uc3"},"attrs":{"label":{"text":""}}}
]}`,

    activity: `DIAGRAM TYPE: UML Activity Diagram

SHAPES TO USE — use ONLY these exact "type" values:
  "uml.StartNode"    — solid black circle at the very TOP (one only)
                       size: {"width":30,"height":30}
  "uml.ActionState"  — rounded rectangle for each action
                       default size: {"width":180,"height":55}
  "uml.DecisionNode" — diamond for branching
                       default size: {"width":110,"height":70}
  "uml.EndState"     — outlined circle with inner dot at the BOTTOM (one only)
                       size: {"width":36,"height":36}
  "standard.Link"    — arrow between nodes; use attrs.label.text for guard conditions

LAYOUT:
  • Flow top-to-bottom; space nodes VERY generously to prevent overlapping.
  • StartNode at top (y ≈ 40); EndState at bottom.
  • Space consecutive nodes ≈ 160–200 px apart vertically.
  • If a DecisionNode branches out, shift parallel branch actions horizontally by 250 px or more to build clean tracks.

EXAMPLE (user login):
{"cells":[
  {"id":"s","type":"uml.StartNode","position":{"x":185,"y":40},"size":{"width":30,"height":30},"attrs":{"label":{"text":""}}},
  {"id":"a1","type":"uml.ActionState","position":{"x":110,"y":140},"size":{"width":180,"height":55},"attrs":{"label":{"text":"Enter Credentials"}}},
  {"id":"d1","type":"uml.DecisionNode","position":{"x":145,"y":260},"size":{"width":110,"height":70},"attrs":{"label":{"text":"Valid?"}}},
  {"id":"a2","type":"uml.ActionState","position":{"x":110,"y":420},"size":{"width":180,"height":55},"attrs":{"label":{"text":"Grant Access"}}},
  {"id":"a3","type":"uml.ActionState","position":{"x":380,"y":320},"size":{"width":180,"height":55},"attrs":{"label":{"text":"Show Error"}}},
  {"id":"e","type":"uml.EndState","position":{"x":182,"y":560},"size":{"width":36,"height":36},"attrs":{"label":{"text":""}}},
  {"id":"l1","type":"standard.Link","source":{"id":"s"},"target":{"id":"a1"},"attrs":{"label":{"text":""}}},
  {"id":"l2","type":"standard.Link","source":{"id":"a1"},"target":{"id":"d1"},"attrs":{"label":{"text":""}}},
  {"id":"l3","type":"standard.Link","source":{"id":"d1"},"target":{"id":"a2"},"attrs":{"label":{"text":"[yes]"}}},
  {"id":"l4","type":"standard.Link","source":{"id":"d1"},"target":{"id":"a3"},"attrs":{"label":{"text":"[no]"}}},
  {"id":"l5","type":"standard.Link","source":{"id":"a2"},"target":{"id":"e"},"attrs":{"label":{"text":""}}}
]}`,

    dfd: `DIAGRAM TYPE: Data Flow Diagram (DFD)

SHAPES TO USE — use ONLY these exact "type" values:
  "dfd.ExternalEntity" — rectangle for external actors outside the system
                         default size: {"width":130,"height":65}
  "dfd.Process"        — oval for processes that transform data
                         default size: {"width":140,"height":85}
  "dfd.DataStore"      — open-ended rectangle (two parallel lines) for stored data
                         default size: {"width":180,"height":50}
  "standard.Link"      — arrow showing data flow; use attrs.label.text = data item name

LAYOUT:
  • External entities on the left/right edges.
  • Processes arranged top-to-bottom in the centre (x ≈ 280).
  • Data stores placed neatly to the right or below the processes.
  • Space consecutive processes ≈ 180 px apart vertically.
  • Leave 180 px minimum distance between interacting shapes.

EXAMPLE (online store):
{"cells":[
  {"id":"ee1","type":"dfd.ExternalEntity","position":{"x":30,"y":160},"size":{"width":130,"height":65},"attrs":{"label":{"text":"Customer"}}},
  {"id":"p1","type":"dfd.Process","position":{"x":220,"y":140},"size":{"width":140,"height":85},"attrs":{"label":{"text":"1.0 Process Order"}}},
  {"id":"p2","type":"dfd.Process","position":{"x":220,"y":360},"size":{"width":140,"height":85},"attrs":{"label":{"text":"2.0 Manage Inventory"}}},
  {"id":"ds1","type":"dfd.DataStore","position":{"x":460,"y":160},"size":{"width":180,"height":50},"attrs":{"label":{"text":"D1: Orders"}}},
  {"id":"ds2","type":"dfd.DataStore","position":{"x":460,"y":380},"size":{"width":180,"height":50},"attrs":{"label":{"text":"D2: Products"}}},
  {"id":"l1","type":"standard.Link","source":{"id":"ee1"},"target":{"id":"p1"},"attrs":{"label":{"text":"Order Request"}}},
  {"id":"l2","type":"standard.Link","source":{"id":"p1"},"target":{"id":"ds1"},"attrs":{"label":{"text":"Order Data"}}},
  {"id":"l3","type":"standard.Link","source":{"id":"p1"},"target":{"id":"p2"},"attrs":{"label":{"text":"Item Info"}}},
  {"id":"l4","type":"standard.Link","source":{"id":"p2"},"target":{"id":"ds2"},"attrs":{"label":{"text":"Stock Update"}}}
]}`,

    generic: `DIAGRAM TYPE: Generic / Class / Entity Diagram

SHAPES TO USE:
  "standard.Rectangle" — for any box, class, or entity
                         default size: {"width":160,"height":60}
  "standard.Link"      — for relationships, arrows

LAYOUT:
  • Spread out entities generously. Minimum 180 px gap.

EXAMPLE:
{"cells":[
  {"id":"a","type":"standard.Rectangle","position":{"x":80,"y":80},"size":{"width":160,"height":60},"attrs":{"label":{"text":"Entity A"}}},
  {"id":"b","type":"standard.Rectangle","position":{"x":340,"y":80},"size":{"width":160,"height":60},"attrs":{"label":{"text":"Entity B"}}},
  {"id":"l1","type":"standard.Link","source":{"id":"a"},"target":{"id":"b"},"attrs":{"label":{"text":"relates to"}}}
]}`,
};

const buildPrompt = (req, srsContext = '') => {
    const diagType = detectDiagramType(req);
    const rules = DIAGRAM_RULES[diagType];

    const RICHNESS = {
        usecase: 'Generate a COMPREHENSIVE use case diagram. Even if the prompt is short, infer ALL relevant actors (at least 3) and use cases (at least 5-6). Think about what a real-world system would need — authentication, administration, reporting, notifications, etc. Add <<include>> and <<extend>> relationships where appropriate.',
        activity: 'Generate a DETAILED activity diagram. Even if the prompt is short, infer ALL logical steps (at least 6-8 actions), include decision points with guard conditions, parallel branches where appropriate, and proper error/exception paths. Model the complete workflow, not just the happy path.',
        dfd: 'Generate a COMPREHENSIVE data flow diagram. Even if the prompt is short, infer ALL relevant external entities (at least 2), processes (at least 3-4), and data stores (at least 2-3). Show all data flows with meaningful labels. Think about what data a real system would process.',
        generic: 'Generate a DETAILED diagram with at least 4-5 entities and meaningful relationships between them. Think about what a complete system architecture would look like.',
    };

    return 'You are a JointJS UML diagram expert. Output ONLY raw JSON — no markdown, no explanation, no code fences.\n\n' +
        'Generate a diagram for: "' + req + '"\n\n' +
        (srsContext ? srsContext + '\n\n' : '') +
        (RICHNESS[diagType] || '') + '\n\n' +
        rules + '\n\n' +
        'STRICT RULES (apply to ALL diagram types):\n' +
        '1. Top-level key MUST be "cells" (array).\n' +
        '2. Every non-link cell MUST have: "id" (unique string), "type" (exact string from the list above), "position" {"x":N,"y":N}, "size" {"width":N,"height":N}.\n' +
        '3. Every link MUST have: "id", "type":"standard.Link", "source":{"id":"<id>"}, "target":{"id":"<id>"}.\n' +
        '4. Do NOT use any type string not listed above.\n' +
        '5. Space shapes so they NEVER overlap — minimum 100 px gap between bounding boxes.\n' +
        '6. Output ONLY the JSON object. No extra text whatsoever.';
};

/* ═══════════════════════════════════════════════════════════════════════════
   API config — Groq (primary) + Gemini (fallback)
═══════════════════════════════════════════════════════════════════════════ */
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

const GROQ_MODELS = ['llama-3.1-405b-reasoning', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_MODELS = ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

/** Call Groq (OpenAI-compatible). */
const callGroq = async (prompt) => {
    if (!GROQ_API_KEY) throw new Error('No Groq API key configured');
    let lastMsg = 'Unknown error';
    for (const model of GROQ_MODELS) {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
            try {
                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + GROQ_API_KEY,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: 'You are a JointJS UML diagram expert. Output ONLY raw JSON — no markdown, no explanation, no code fences.' },
                            { role: 'user', content: prompt },
                        ],
                        temperature: 0.1,
                        max_tokens: 4096,
                    }),
                });
                console.log('[Groq] model=' + model + ' attempt=' + attempt + ' status=' + resp.status);
                if (resp.ok) {
                    const data = await resp.json();
                    const text = data.choices?.[0]?.message?.content || '';
                    return { text, provider: 'Groq (' + model + ')' };
                }
                const errBody = await resp.json().catch(() => ({}));
                lastMsg = errBody?.error?.message || ('HTTP ' + resp.status);
                if (resp.status === 400) throw new Error(lastMsg);
                if (resp.status === 429 || resp.status === 503) continue;
                break;
            } catch (e) {
                if (e.message.includes('400')) throw e;
                lastMsg = e.message;
            }
        }
        console.warn('[Groq] skipping ' + model + ': ' + lastMsg);
    }
    throw new Error('Groq unavailable: ' + lastMsg);
};

/** Call Gemini (fallback). */
const callGemini = async (prompt) => {
    if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured');
    let lastMsg = 'Unknown error';
    for (const model of GEMINI_MODELS) {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1 },
                }),
            });
            console.log('[Gemini] model=' + model + ' attempt=' + attempt + ' status=' + resp.status);
            if (resp.ok) {
                const data = await resp.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (!text) {
                    const reason = data?.candidates?.[0]?.finishReason || 'unknown';
                    throw new Error('Gemini empty response (finishReason: ' + reason + ')');
                }
                return { text, provider: 'Gemini (' + model + ')' };
            }
            const errBody = await resp.json().catch(() => ({}));
            lastMsg = errBody?.error?.message || ('HTTP ' + resp.status);
            if (resp.status === 400) throw new Error(lastMsg);
            if (resp.status === 429 || resp.status === 503) continue;
            break;
        }
        console.warn('[Gemini] skipping ' + model + ': ' + lastMsg);
    }
    throw new Error('Gemini unavailable: ' + lastMsg);
};

/** Multi-provider call: Groq → Gemini. */
const callAI = async (prompt) => {
    // Try Groq first
    if (GROQ_API_KEY) {
        let lastGroqErr = '';
        try { 
            return await callGroq(prompt); 
        } catch (e) {
            console.warn('[Fallback] Groq failed:', e.message, '→ trying Gemini');
            lastGroqErr = e.message;
        }
        
        if (GEMINI_API_KEY) {
            try { 
                return await callGemini(prompt); 
            } catch (e) {
                console.error('[Fallback] Gemini failed:', e.message);
                throw new Error(`AI generation failed. Groq: ${lastGroqErr} | Gemini: ${e.message}`);
            }
        }
    }
    
    if (GEMINI_API_KEY) {
        try { return await callGemini(prompt); } catch (e) {
            throw e;
        }
    }
    throw new Error('No API keys configured. Add VITE_GROQ_API_KEY or VITE_GEMINI_API_KEY to your .env file.');
};

/* ═══════════════════════════════════════════════════════════════════════════
   Dashboard component
═══════════════════════════════════════════════════════════════════════════ */
const Dashboard = () => {
    const [jsonResult, setJsonResult]   = useState(null);
    const [prompt, setPrompt]           = useState('');
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [debugInfo, setDebugInfo]     = useState(null);
    const [activeProvider, setActiveProvider] = useState('—');
    const [isDark, setIsDark]           = useState(false);
    const [snapGrid, setSnapGrid]       = useState(true);
    const [zoom, setZoom]               = useState(100);
    const [generationProgress, setGenerationProgress] = useState(''); // Phase-by-phase status


    const [selectedSrs, setSelectedSrs] = useState('None');
    const [customSrs, setCustomSrs]     = useState(null);
    const [liveDocs, setLiveDocs]       = useState([]);
    const [parsingStatus, setParsingStatus] = useState(null);
    const [activeDocId, setActiveDocId]     = useState(null);
    const [rawDocumentText, setRawDocumentText] = useState(''); // raw text from parsed doc
    const fileInputRef                  = useRef(null);

    const SRS_SAMPLES = {
        "None": null,
        "Logbook Stories": logbookSrs,
        "Bhavika Gondi SRS": bhavikaSrs,
        "Sreeram R SRS": sreeramSrs,
        "MediCore HMS": medicoreSrs,
        "SE Group SRS": seGrpSrs,
        "Custom SRS": customSrs
    };

    React.useEffect(() => {
        fetchLiveDocs();
        
        // Restore canvas state from local storage on boot
        setTimeout(() => {
            if (canvasRef.current && canvasRef.current.loadGraph) {
                try {
                    const savedState = localStorage.getItem('uml_canvas_state');
                    if (savedState) {
                        const parsed = JSON.parse(savedState);
                        canvasRef.current.loadGraph(parsed);
                        console.log('[Dashboard] Restored canvas from localStorage');
                    }
                } catch(e) {
                    console.error('Failed to restore canvas state', e);
                }
            }
        }, 500); // Wait for canvas to mount
    }, []);

    const fetchLiveDocs = async () => {
        try {
            const resp = await fetch('http://127.0.0.1:8000/api/documents');
            if (resp.ok) {
                const data = await resp.json();
                setLiveDocs(data.documents || []);
            }
        } catch (e) {
            console.warn('SRS backend offline');
        }
    };

    const pollParsingStatus = (docId) => {
        let failCount = 0;
        const MAX_FAILS = 5;
        const interval = setInterval(async () => {
            try {
                const resp = await fetch(`http://127.0.0.1:8000/api/document/${docId}/status`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                failCount = 0; // reset on success

                if (data.status === 'processing') {
                    setParsingStatus(`Parsing: ${data.stage || 'Analyzing'} (${data.percent || 0}%)`);
                } else if (data.status === 'done') {
                    clearInterval(interval);
                    setParsingStatus('Fetching model graph...');
                    const intelResp = await fetch(`http://127.0.0.1:8000/api/document/${docId}/intelligence`);
                    if (intelResp.ok) {
                        const intelData = await intelResp.json();
                        setCustomSrs(intelData);
                        setActiveDocId(docId);
                        setSelectedSrs('Custom SRS');
                        setParsingStatus(null);
                        setLoading(false);
                        fetchLiveDocs();
                    }
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    setParsingStatus(null);
                    setLoading(false);
                    setError('SRS Clarity pipeline error: ' + data.message);
                }
            } catch (err) {
                failCount++;
                if (failCount >= MAX_FAILS) {
                    clearInterval(interval);
                    setParsingStatus(null);
                    setLoading(false);
                    setError('Cannot reach the backend (port 8000). Make sure the SRS-Clarity server is running.');
                } else {
                    setParsingStatus(`Retrying connection... (${failCount}/${MAX_FAILS})`);
                }
            }
        }, 2500);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isMdOrTxt = file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.txt');
        const isJson = file.name.toLowerCase().endsWith('.json');

        if (isPdf) {
            setLoading(true);
            setParsingStatus('Uploading PDF document...');
            try {
                const formData = new FormData();
                formData.append('file', file);

                const resp = await fetch('http://127.0.0.1:8000/api/upload', {
                    method: 'POST',
                    body: formData
                });
                if (!resp.ok) throw new Error('PDF Upload failed');

                const data = await resp.json();
                pollParsingStatus(data.doc_id);
            } catch (err) {
                setLoading(false);
                setParsingStatus(null);
                setError('Error initializing pipeline: ' + err.message);
            }
        } else if (isMdOrTxt) {
            setLoading(true);
            setParsingStatus('Uploading Markdown document...');
            try {
                const formData = new FormData();
                formData.append('file', file);

                const resp = await fetch('http://127.0.0.1:8000/api/upload-readme', {
                    method: 'POST',
                    body: formData
                });
                if (!resp.ok) throw new Error('Markdown Upload failed');

                const data = await resp.json();
                
                // For markdown, we can skip polling the long pipeline and just set the doc ID
                setActiveDocId(data.doc_id);
                setCustomSrs({ actors: ['System'], user_stories: [] });
                setSelectedSrs('Custom SRS');
                setParsingStatus(null);
                setLoading(false);
                setDebugInfo(`✅ Markdown document loaded successfully. Ready for semantic extraction.`);
                fetchLiveDocs();
            } catch (err) {
                setLoading(false);
                setParsingStatus(null);
                setError('Error processing Markdown: ' + err.message);
            }
        } else if (isJson) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const parsed = JSON.parse(evt.target.result);
                    if (parsed.user_stories && parsed.actors) {
                        setCustomSrs(parsed);
                        setSelectedSrs('Custom SRS');
                        setDebugInfo('Custom context mapped successfully.');
                    } else {
                        setError('Malformed payload.');
                    }
                } catch(err) {
                    setError('Error processing JSON document.');
                }
            };
            reader.readAsText(file);
        }
    };
    const [selectedShape, setSelectedShape] = useState(null);
    const [editLabel, setEditLabel] = useState('');
    const [history, setHistory] = useState(() => {
        const saved = localStorage.getItem('uml_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [reasoningSteps, setReasoningSteps] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [showInsights, setShowInsights] = useState(true);
    // Chunk Inspector panel state
    const [activeInsightTab, setActiveInsightTab] = useState('SRS Audit');
    const [chunkPreview, setChunkPreview]         = useState(null);
    const [rawSrsPreview, setRawSrsPreview]       = useState(null);
    const canvasRef = useRef(null);


    /* ── Human-in-the-Loop state ──────────────────────────────────────────── */
    const [aiNodes, setAiNodes]               = useState(() => {
        try { const saved = localStorage.getItem('uml_hiloop_nodes'); return saved ? JSON.parse(saved) : []; } catch(e) { return []; }
    });
    const [aiInstructions, setAiInstructions] = useState(() => {
        try { const saved = localStorage.getItem('uml_hiloop_instr'); return saved ? JSON.parse(saved) : []; } catch(e) { return []; }
    });
    const [placedNodeIds, setPlacedNodeIds]   = useState(new Set());  // IDs on canvas
    const [connectedEdgeIds, setConnectedEdgeIds] = useState(new Set()); // edge IDs drawn
    const positionStoreRef = useRef({});  // mirrors canvas positions

    /* Offline SRS → nodes/instructions extractor (runs in < 100ms, no API) */
    const extractNodesFromSrs = useCallback((srsData) => {
        if (!srsData) return { nodes: [], instructions: [] };
        const stories = srsData.user_stories || [];
        const actors  = srsData.actors || [];
        const nodeMap = {};

        // 1. Actors → nodes (Semantic Entities)
        const actorNodes = actors.map((a, i) => ({ 
            id: `actor-${i}`, 
            label: a.split(' ')[0], // Just the primary name
            fullDescription: `Role: ${a}`, 
            category: 'actor' 
        }));
        actors.forEach((a, i) => { nodeMap[a] = `actor-${i}`; });

        // 2. User Stories → Use Case / Process Nodes
        const useCaseNodes = [];
        stories.slice(0, 25).forEach((s, i) => {
            let raw = (s.goal || s.raw_text || '').replace(/^[\s\-\*\d\.)]+/, '').trim();
            
            // Generate Semantic Label (Entity-based)
            // Strategy: Take first 3-4 words, remove "The user should be able to" etc.
            let semantic = raw
                .replace(/^(the|a|an|system|user) (should be able to|can|must|will)/i, '')
                .trim()
                .split(/[,.;]/)[0] // split at punctuation
                .split(' ')
                .slice(0, 4)
                .join(' ');
            
            if (semantic.length < 3) semantic = raw.split(' ').slice(0, 3).join(' ');

            const id = `uc-${i}`;
            useCaseNodes.push({ 
                id, 
                label: semantic, 
                fullDescription: raw, 
                category: raw.toLowerCase().includes('database') || raw.toLowerCase().includes('system') ? 'process' : 'use_case'
            });
        });

        // 3. Instructions: actor → node (Semantic Progress)
        const instructions = stories.slice(0, 25).map((s, i) => {
            const actorId = actorNodes.find(a => s.role && a.fullDescription.includes(s.role))?.id || actorNodes[0]?.id;
            const targetId = `uc-${i}`;
            return {
                id:    `instr-${i}`,
                text:  `${actorNodes.find(a => a.id === actorId)?.label || 'User'} ➜ ${useCaseNodes[i]?.label}`,
                from:  actorId,
                to:    targetId,
                label: 'performs'
            };
        }).filter(e => e.from && e.to);

        return { nodes: [...actorNodes, ...useCaseNodes], instructions };
    }, []);


    /* When SRS is selected, auto-populate the node panel */
    React.useEffect(() => {
        const srs = SRS_SAMPLES?.[selectedSrs];
        if (srs) {
            const extracted = extractNodesFromSrs(srs);
            setAiNodes(extracted.nodes);
            setAiInstructions(extracted.instructions);
            setPlacedNodeIds(new Set());
            setConnectedEdgeIds(new Set());
            positionStoreRef.current = {};
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSrs, extractNodesFromSrs]);

    /* Position update from canvas */
    const handlePositionUpdate = useCallback((positions) => {
        positionStoreRef.current = positions;
        setPlacedNodeIds(new Set(Object.keys(positions)));
        
        // Phase 3: State Persistence
        // Automatically save the canvas graph state whenever positions change
        if (canvasRef.current && canvasRef.current.getGraphJSON) {
            const graphJSON = canvasRef.current.getGraphJSON();
            localStorage.setItem('uml_canvas_state', JSON.stringify(graphJSON));
        }
    }, []);

    /* Instruction card clicked — draw the connection */
    const handleConnectInstruction = useCallback((instr) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ok = canvas.drawConnection(instr.from, instr.to, instr.label, instr.id);
        if (ok) {
            setConnectedEdgeIds(prev => {
                const next = new Set(prev);
                next.add(instr.id);
                return next;
            });
        }
    }, []);

    /* Drop All — spawn all unplaced nodes in a column on the left */
    const handleDropAll = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let y = 60;
        aiNodes.forEach(node => {
            if (!placedNodeIds.has(node.id)) {
                canvas.spawnNode(node, 40, y);
                y += 120;
            }
        });
    }, [aiNodes, placedNodeIds]);

    /* ── Panel Resizing (Global) ─────────────────────────────────────────── */
    const [panelWidth, setPanelWidth] = useState(380);
    const [isResizingPanel, setIsResizingPanel] = useState(false);

    const startResizingPanel = useCallback(() => setIsResizingPanel(true), []);
    const stopResizingPanel  = useCallback(() => setIsResizingPanel(false), []);

    const resizePanel = useCallback((e) => {
        if (isResizingPanel) {
            // 40px is approximately the Toolbox width
            const newWidth = e.clientX - 45;
            if (newWidth > 200 && newWidth < 1000) {
                setPanelWidth(newWidth);
            }
        }
    }, [isResizingPanel]);

    React.useEffect(() => {
        window.addEventListener('mousemove', resizePanel);
        window.addEventListener('mouseup', stopResizingPanel);
        return () => {
            window.removeEventListener('mousemove', resizePanel);
            window.removeEventListener('mouseup', stopResizingPanel);
        };
    }, [resizePanel, stopResizingPanel]);

    /* ── Hover / Detail Tracking ───────────────────────────────────────── */
    const [hoveredNodeInfo, setHoveredNodeInfo] = useState(null); // {id, desc}
    const handleHoverNode = useCallback((id, desc) => {
        setHoveredNodeInfo(id ? { id, desc } : null);
    }, []);




    const saveToHistory = (diagram, promptText, type) => {
        const newItem = {
            id: Date.now(),
            timestamp: new Date().toLocaleString(),
            prompt: promptText,
            type: type,
            data: diagram
        };
        const updated = [newItem, ...history].slice(0, 10);
        setHistory(updated);
        localStorage.setItem('uml_history', JSON.stringify(updated));
    };

    /* ── AI generate (Multi-Pass Prompt Engine) ─────────────────────────── */
    const handleGenerate = async () => {
        if (!prompt.trim()) { setError('Please enter a requirement first.'); return; }

        setLoading(true);
        setError(null);
        setDebugInfo(null);
        setReasoningSteps([]);
        setGenerationProgress('');

        // Determine the active doc_id for chunk retrieval
        // Live docs are matched by document_name; samples use a fixed prefix map
        const DOC_ID_MAP = {
            'Logbook Stories':  '1_Logbook_User_Stories',
            'Bhavika Gondi SRS': '2_SRS Doc_BHAVIKA GONDI',
            'Sreeram R SRS':    '3_SRS_Grp6_SREERAM R',
            'MediCore HMS':     '4_MediCore_HMS_SRS',
            'SE Group SRS':     '5_SE_grp_',
        };
        const docIdForChunks = DOC_ID_MAP[selectedSrs] || null;
        const activeIntelligence = SRS_SAMPLES[selectedSrs] || null;

        const steps = [
            '🔍 Classifying diagram type...',
            '📦 Retrieving relevant SRS chunks...',
            '🧠 Injecting context into LLM prompt...',
            '✍️  Generating semantic entities & connections...',
            '✅ Validating JointJS schema...',
        ];

        let currentStep = 0;
        const stepInterval = setInterval(() => {
            if (currentStep < steps.length) {
                setReasoningSteps(prev => [...prev, steps[currentStep]]);
                currentStep++;
            } else {
                clearInterval(stepInterval);
            }
        }, 700);

        try {
            // Prefer parsed raw document text; fallback to intelligence JSON as string
            const activeIntelText = rawDocumentText ||
                (activeIntelligence?.user_stories?.[0]?.raw_text) ||
                (activeIntelligence ? JSON.stringify(activeIntelligence) : '');

            const graph = await generateDiagram(prompt, activeDocId || docIdForChunks, activeIntelligence || { raw_text: activeIntelText }, (msg) => {
                if (msg) setGenerationProgress(msg);
            });

            // Populate Human-in-the-Loop state instead of auto-rendering cells
            if (graph.entities && graph.entities.length > 0) {
                // Ensure instructions have text for the UI cards
                const processedInstr = (graph.connections || []).map(instr => ({
                    ...instr,
                    text: instr.text || `${graph.entities.find(e => e.id === instr.from)?.label || 'Node'} ➜ ${instr.label} ➜ ${graph.entities.find(e => e.id === instr.to)?.label || 'Node'}`
                }));

                setAiNodes(graph.entities);
                setAiInstructions(processedInstr);
                
                // Clear existing canvas state for a fresh semantic session
                setPlacedNodeIds(new Set());
                setConnectedEdgeIds(new Set());
                
                // Save JSON state to local storage
                localStorage.setItem('uml_hiloop_nodes', JSON.stringify(mappedNodes));
                localStorage.setItem('uml_hiloop_instr', JSON.stringify(processedInstr));
                
                setReasoningSteps(prev => [...prev, `✓ Extracted ${mappedNodes.length} semantic entities.`]);
            } else {
                throw new Error("No semantic entities could be extracted from the requirements.");
            }

            setActiveProvider('Groq (Semantic Engine)');
            setGenerationProgress('');

        } catch (err) {
            setError(err.message);
            clearInterval(stepInterval);
            setGenerationProgress('');
        } finally {
            setTimeout(() => setLoading(false), 800);
        }
    };

    /* ── Theme tokens ────────────────────────────────────────────────────── */
    const T = isDark ? {
        bg:          '#0a0e1a',
        surface:     '#111827',
        surfaceAlt:  '#1e293b',
        border:      '#334155',
        text:        '#f1f5f9',
        textMuted:   '#94a3b8',
        textSubtle:  '#64748b',
        inputBg:     '#0f172a',
        accent:      '#60a5fa',
        badgeBg:     '#064e3b',
        badgeText:   '#34d399',
        badgeBorder: '#065f46',
        errBg:       '#450a0a',
        errBorder:   '#991b1b',
        errText:     '#fca5a5',
        okBg:        '#052e16',
        okBorder:    '#065f46',
        okText:      '#6ee7b7',
    } : {
        bg:          '#f8fafc',
        surface:     '#ffffff',
        surfaceAlt:  '#f1f5f9',
        border:      '#e2e8f0',
        text:        '#1e293b',
        textMuted:   '#94a3b8',
        textSubtle:  '#64748b',
        inputBg:     '#f8fafc',
        accent:      '#2563eb',
        badgeBg:     '#f0fdf4',
        badgeText:   '#15803d',
        badgeBorder: '#bbf7d0',
        errBg:       '#fef2f2',
        errBorder:   '#fecaca',
        errText:     '#b91c1c',
        okBg:        '#f0fdf4',
        okBorder:    '#bbf7d0',
        okText:      '#15803d',
    };

    /* ── Toolbox → Canvas bridge ────────────────────────────────────────── */
    const handleAddShape = (type) => {
        if (canvasRef.current) { canvasRef.current.addShape(type); }
    };

    const handleSelectionChange = (info) => {
        setSelectedShape(info);
        if (info) {
            // Get current label from the info type
            setEditLabel(info.label || info.type?.split('.')[1] || '');
        } else {
            setEditLabel('');
        }
    };

    const handleResizeProp = (field, value) => {
        if (!selectedShape || !canvasRef.current) return;
        var v = parseInt(value, 10);
        if (isNaN(v) || v < 20) return;
        var w = field === 'width'  ? v : selectedShape.width;
        var h = field === 'height' ? v : selectedShape.height;
        canvasRef.current.resizeShape(selectedShape.id, w, h);
        setSelectedShape(function(prev) { return prev ? { ...prev, width: w, height: h } : null; });
    };

    /* ── Inline toolbar button ───────────────────────────────────────────── */
    const TBtn = ({ onClick, title, active, children }) => (
        <button
            onClick={onClick}
            title={title}
            style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                gap: '3px', padding: '5px 9px', borderRadius: '7px', cursor: 'pointer',
                fontSize: '11px', fontWeight: '600', fontFamily: 'Inter, sans-serif',
                border: active
                    ? '1.5px solid ' + T.accent
                    : '1.5px solid ' + T.border,
                background: active
                    ? (isDark ? '#1e3a5f' : '#eff6ff')
                    : (isDark ? '#1e293b' : T.surface),
                color: active ? T.accent : T.text,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
            }}
        >
            {children}
        </button>
    );

    const Sep = () => (
        <div style={{ width: '1px', height: '20px', background: T.border, margin: '0 2px', flexShrink: 0 }} />
    );

    /* ── Render ──────────────────────────────────────────────────────────── */
    return (
        <div style={{
            display: 'flex', height: '100vh',
            background: T.bg, overflow: 'hidden',
            fontFamily: 'Inter, sans-serif',
            transition: 'background 0.2s',
        }}>



            {/* ── Toolbox ────────────────────────────────────────────────── */}
            <Toolbox onAddShape={handleAddShape} darkMode={isDark} />

            {/* ── Node Panel (Col B + C) ─────────────────────────────────── */}
            {aiNodes.length > 0 && (
                <>
                    <div style={{
                        display: 'flex', flexShrink: 0,
                        width: panelWidth,
                        borderRight: `1px solid ${T.border}`,
                        background: T.surface,
                        flexDirection: 'column',
                        overflow: 'hidden',
                        transition: isResizingPanel ? 'none' : 'width 0.1s ease',
                    }}>
                        <div style={{
                            padding: '7px 12px',
                            borderBottom: `1px solid ${T.border}`,
                            fontSize: '11px', fontWeight: '800',
                            color: T.textSubtle,
                            background: T.surface,
                            letterSpacing: '0.06em', textTransform: 'uppercase'
                        }}>
                            🧠 AI Workspace — drag nodes, click connections
                        </div>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <NodePanel
                                nodes={aiNodes}
                                instructions={aiInstructions}
                                placedNodeIds={placedNodeIds}
                                connectedEdgeIds={connectedEdgeIds}
                                onConnectInstruction={handleConnectInstruction}
                                onDropAll={handleDropAll}
                                isDark={isDark}
                                T={T}
                            />
                        </div>
                    </div>

                    {/* ── Vertical Resizer (Panel-wide) ── */}
                    <div 
                        onMouseDown={startResizingPanel}
                        style={{
                            width: '4px', cursor: 'col-resize',
                            background: isResizingPanel ? T.accent : 'transparent',
                            zIndex: 100, transition: 'background 0.2s',
                            marginLeft: '-2px', marginRight: '-2px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = T.accent + '66'}
                        onMouseLeave={e => !isResizingPanel && (e.currentTarget.style.background = 'transparent')}
                    />
                </>
            )}



            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                {/* ── Toolbar header ────────────────────────────────────── */}
                <header style={{
                    padding: '7px 14px',
                    background: T.surface,
                    borderBottom: '1px solid ' + T.border,
                    display: 'flex', alignItems: 'center', gap: '6px',
                    flexWrap: 'wrap', minHeight: '46px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    transition: 'background 0.2s, border-color 0.2s',
                }}>
                    {/* Brand */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '12px' }}>
                        <Cpu size={18} color="#2563eb" />
                        <span style={{ fontWeight: '800', fontSize: '13px', letterSpacing: '-0.02em', color: T.text }}>
                            IntelliSpec AI
                        </span>
                    </div>

                    <Sep />

                    {/* Undo / Redo */}
                    <TBtn title="Undo (Ctrl+Z)" onClick={() => canvasRef.current && canvasRef.current.undo()}>↩ Undo</TBtn>
                    <TBtn title="Redo (Ctrl+Y)" onClick={() => canvasRef.current && canvasRef.current.redo()}>↪ Redo</TBtn>

                    <Sep />

                    {/* Zoom */}
                    <TBtn title="Zoom Out" onClick={() => canvasRef.current && canvasRef.current.zoomOut()}>−</TBtn>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: T.text, minWidth: '42px', textAlign: 'center' }}>
                        {zoom}%
                    </span>
                    <TBtn title="Zoom In" onClick={() => canvasRef.current && canvasRef.current.zoomIn()}>+</TBtn>
                    <TBtn title="Fit diagram to viewport" onClick={() => canvasRef.current && canvasRef.current.fitContent()}>⊡ Fit</TBtn>
                    <TBtn title="Reset zoom to 100%" onClick={() => canvasRef.current && canvasRef.current.resetZoom()}>1:1</TBtn>

                    <Sep />
                    
                    <TBtn title="Auto-align nodes to prevent overlap" onClick={() => canvasRef.current && canvasRef.current.autoLayout()}>
                        ✨ Auto-Align
                    </TBtn>

                    <Sep />

                    {/* History Toggle */}
                    <TBtn title="View Previous Diagrams" active={showHistory} onClick={() => setShowHistory(!showHistory)}>
                        🕰 History
                    </TBtn>

                    {/* Insights Toggle */}
                    <TBtn title="View SRS Insights" active={showInsights} onClick={() => setShowInsights(!showInsights)}>
                        💡 Insights
                    </TBtn>

                    <Sep />

                    {/* Dark mode */}
                    <TBtn title="Toggle Dark Mode" active={isDark} onClick={() => setIsDark(!isDark)}>
                        {isDark ? '☀ Light' : '◐ Dark'}
                    </TBtn>

                    <Sep />

                    {/* Download options */}
                    <TBtn title="Download as PNG" onClick={() => canvasRef.current && canvasRef.current.exportPNG()}>
                        <Image size={13} /> PNG
                    </TBtn>
                    <TBtn title="Download as SVG" onClick={() => canvasRef.current && canvasRef.current.exportSVG()}>
                        <FileText size={13} /> SVG
                    </TBtn>
                    <TBtn title="Download as JSON" onClick={() => canvasRef.current && canvasRef.current.exportJSON()}>
                        <FileJson size={13} /> JSON
                    </TBtn>

                    <Sep />

                    {/* Delete / Clear */}
                    <TBtn title="Delete selected shape" onClick={() => canvasRef.current && canvasRef.current.deleteSelected()}>
                        <Trash2 size={13} /> Delete
                    </TBtn>
                    <TBtn title="Clear all shapes" onClick={() => {
                        if (window.confirm('Clear the entire canvas?')) {
                            canvasRef.current && canvasRef.current.clearAll();
                        }
                    }}>
                        <XCircle size={13} /> Clear
                    </TBtn>

                    {/* Spacer */}
                    <div style={{ flex: 1 }} />



                </header>

                {/* ── Canvas ─────────────────────────────────────────────── */}
                <div style={{
                    flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0,
                    background: isDark ? '#0f172a' : '#e5e7eb',
                }}>
                    <DiagramCanvas
                        ref={canvasRef}
                        data={jsonResult}
                        darkMode={isDark}
                        snapGrid={snapGrid}
                        onZoomChange={setZoom}
                        onSelectionChange={handleSelectionChange}
                        onPositionUpdate={handlePositionUpdate}
                        onHoverNode={handleHoverNode}
                    />

                    {/* ── Semantic Requirement Inspector (Hover Overlay) ── */}
                    {hoveredNodeInfo && (
                        <div style={{
                            position: 'absolute', bottom: '20px', left: '20px', right: '20px',
                            background: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
                            backdropFilter: 'blur(8px)',
                            border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                            borderRadius: '12px', padding: '12px 16px',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                            zIndex: 1000, pointerEvents: 'none',
                            maxWidth: '600px', margin: '0 auto',
                            animation: 'fadeInUp 0.2s ease-out'
                        }}>
                            <div style={{ fontSize: '10px', color: '#6366f1', fontWeight: '800', textTransform: 'uppercase', marginBottom: '4px' }}>
                                📖 Source Requirement
                            </div>
                            <div style={{ fontSize: '12px', color: T.text, lineHeight: '1.5', fontStyle: 'italic' }}>
                                "{hoveredNodeInfo.desc}"
                            </div>
                        </div>
                    )}



                    {/* ── History Sidebar ── */}
                    {showHistory && (
                        <div style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0, width: '280px',
                            background: T.surface, borderRight: '1px solid ' + T.border, zIndex: 60,
                            padding: '20px', boxShadow: '4px 0 20px rgba(0,0,0,0.1)',
                            display: 'flex', flexDirection: 'column'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                <h3 style={{ margin: 0, fontSize: '15px', color: T.text }}>Project History</h3>
                                <XCircle size={18} style={{ cursor: 'pointer', color: T.textMuted }} onClick={() => setShowHistory(false)} />
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                {history.length === 0 ? (
                                    <p style={{ fontSize: '12px', color: T.textSubtle }}>No diagrams saved yet.</p>
                                ) : (
                                    history.map(item => (
                                        <div 
                                            key={item.id} 
                                            onClick={() => setJsonResult(item.data)}
                                            style={{
                                                padding: '12px', borderRadius: '10px', background: T.surfaceAlt,
                                                marginBottom: '10px', cursor: 'pointer', border: '1px solid transparent',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
                                            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                        >
                                            <div style={{ fontSize: '10px', color: T.accent, fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>{item.type}</div>
                                            <div style={{ fontSize: '12px', color: T.text, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</div>
                                            <div style={{ fontSize: '10px', color: T.textSubtle, marginTop: '4px' }}>{item.timestamp}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <button 
                                onClick={() => { setHistory([]); localStorage.removeItem('uml_history'); }}
                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid ' + T.border, background: 'none', color: T.errText, cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                            >
                                Clear History
                            </button>
                        </div>
                    )}

                    {/* ── Insights + Chunk Inspector Sidebar (Right) ── */}
                    {showInsights && selectedSrs && selectedSrs !== 'None' && (
                        <div style={{
                            position: 'absolute', top: '14px', right: selectedShape ? '290px' : '14px',
                            width: '300px', maxHeight: 'calc(100% - 28px)',
                            background: T.surface, border: '1px solid ' + T.border, borderRadius: '16px',
                            zIndex: 40, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                            display: 'flex', flexDirection: 'column', overflow: 'hidden'
                        }}>
                            {/* ── Tab Bar ── */}
                            <div style={{ display: 'flex', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
                                {['SRS Audit', 'Chunk Inspector', 'Raw SRS'].map(tab => (
                                    <button key={tab} onClick={() => setActiveInsightTab(tab)} style={{
                                        flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                                        background: activeInsightTab === tab ? (isDark ? '#1e293b' : '#f1f5f9') : 'transparent',
                                        color: activeInsightTab === tab ? T.accent : T.textMuted,
                                        fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        borderBottom: activeInsightTab === tab ? `2px solid ${T.accent}` : '2px solid transparent',
                                        transition: 'all 0.15s'
                                    }}>
                                        {tab}
                                    </button>
                                ))}
                            </div>

                            <div style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>

                                {/* ── TAB 1: SRS Audit ── */}
                                {activeInsightTab === 'SRS Audit' && SRS_SAMPLES[selectedSrs] && (() => {
                                    const srs = SRS_SAMPLES[selectedSrs];
                                    const stories = srs.user_stories || [];
                                    const actors = srs.actors || [];
                                    const systemGaps = [];
                                    const ambiguities = [];
                                    const commonActors = ['admin', 'system', 'database', 'user'];
                                    const missingCommon = commonActors.filter(ca => !actors.some(a => a.toLowerCase().includes(ca)));
                                    if (missingCommon.length > 0 && actors.length > 0) {
                                        systemGaps.push(`Consider defining roles for: ${missingCommon.join(', ')}.`);
                                    }
                                    const vagueTerms = ['manage', 'handle', 'process', 'do'];
                                    stories.forEach(st => {
                                        if (st.goal) {
                                            const foundVague = vagueTerms.find(vt => st.goal.toLowerCase().includes(vt));
                                            if (foundVague) ambiguities.push({ requirement: `${st.id}: ${st.role}`, issue: `Vague term "${foundVague}" — specify exactly what data is modified.` });
                                        }
                                        if (!st.acceptance_criteria || st.acceptance_criteria.length === 0) {
                                            ambiguities.push({ requirement: `${st.id}: ${st.role}`, issue: 'Missing acceptance criteria.' });
                                        }
                                    });
                                    if (ambiguities.length === 0) ambiguities.push({ requirement: 'Overall SRS', issue: 'Requirements seem well-defined.' });
                                    if (systemGaps.length === 0) systemGaps.push('All core actors seem to be represented.');
                                    return (
                                        <>
                                            <div style={{ fontSize: '11px', fontWeight: '800', color: T.textSubtle, marginBottom: '8px', textTransform: 'uppercase' }}>Ambiguities ({ambiguities.length})</div>
                                            {ambiguities.slice(0, 4).map((a, i) => (
                                                <div key={i} style={{ padding: '8px', borderRadius: '8px', background: T.surfaceAlt, marginBottom: '6px', fontSize: '11px', borderLeft: '3px solid ' + T.accent }}>
                                                    <div style={{ fontWeight: '700', color: T.text }}>{a.requirement}</div>
                                                    <div style={{ color: T.textSubtle, marginTop: '2px' }}>{a.issue}</div>
                                                </div>
                                            ))}
                                            <div style={{ fontSize: '11px', fontWeight: '800', color: T.textSubtle, marginBottom: '8px', marginTop: '14px', textTransform: 'uppercase' }}>System Gaps</div>
                                            {systemGaps.slice(0, 2).map((g, i) => (
                                                <div key={i} style={{ padding: '10px', borderRadius: '8px', background: T.okBg, border: '1px solid ' + T.okBorder, fontSize: '11px', color: T.okText, marginBottom: '6px' }}>
                                                    {g}
                                                </div>
                                            ))}
                                        </>
                                    );
                                })()}

                                {/* ── TAB 2: Chunk Inspector ── */}
                                {activeInsightTab === 'Chunk Inspector' && (
                                    <div>
                                        <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '10px', lineHeight: '1.5' }}>
                                            Chunks parsed from <code style={{ color: T.accent }}>_clean.md</code> for <strong>{selectedSrs}</strong>.
                                            Open DevTools → Console to see retrieval logs per generation.
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const DOC_ID_MAP = {
                                                    'Logbook Stories':  '1_Logbook_User_Stories',
                                                    'Bhavika Gondi SRS': '2_SRS Doc_BHAVIKA GONDI',
                                                    'Sreeram R SRS':    '3_SRS_Grp6_SREERAM R',
                                                    'MediCore HMS':     '4_MediCore_HMS_SRS',
                                                    'SE Group SRS':     '5_SE_grp_',
                                                };
                                                const docId = DOC_ID_MAP[selectedSrs];
                                                if (!docId) { setChunkPreview({ error: 'No doc_id mapping for this SRS. Use a live-uploaded PDF.' }); return; }
                                                try {
                                                    const res = await fetch(`http://localhost:8000/api/document/${encodeURIComponent(docId)}/chunks`);
                                                    const data = await res.json();
                                                    setChunkPreview(data);
                                                } catch (e) {
                                                    setChunkPreview({ error: 'Backend offline or doc not found: ' + e.message });
                                                }
                                            }}
                                            style={{
                                                width: '100%', padding: '8px', borderRadius: '8px',
                                                background: T.accent, color: '#fff', border: 'none',
                                                fontSize: '11px', fontWeight: '700', cursor: 'pointer', marginBottom: '10px'
                                            }}
                                        >
                                            🔍 Load Chunks from Backend
                                        </button>

                                        {chunkPreview?.error && (
                                            <div style={{ padding: '10px', borderRadius: '8px', background: T.errBg, border: '1px solid ' + T.errBorder, fontSize: '11px', color: T.errText }}>
                                                ⚠ {chunkPreview.error}
                                            </div>
                                        )}

                                        {chunkPreview?.chunks && (
                                            <>
                                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '8px' }}>
                                                    ✅ {chunkPreview.total_chunks} chunks found
                                                </div>
                                                {chunkPreview.chunks.map((c, i) => (
                                                    <div key={i} style={{
                                                        padding: '10px', borderRadius: '8px', marginBottom: '6px',
                                                        background: T.surfaceAlt, border: '1px solid ' + T.border,
                                                        fontSize: '11px'
                                                    }}>
                                                        <div style={{ fontWeight: '800', color: T.text, marginBottom: '3px' }}>
                                                            <span style={{ color: T.accent }}>[{c.category}]</span> {c.heading}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '8px', color: T.textMuted, fontSize: '10px' }}>
                                                            {c.math?.length > 0 && <span>📐 {c.math.length} math</span>}
                                                            {c.figures?.length > 0 && <span>🖼 {c.figures.length} figures</span>}
                                                            {c.story_ids?.length > 0 && <span>📋 {c.story_ids.join(', ')}</span>}
                                                        </div>
                                                        <div style={{ color: T.textSubtle, fontSize: '10px', marginTop: '4px', lineHeight: '1.4',
                                                            maxHeight: '40px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {c.body?.substring(0, 100)}…
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* ── TAB 3: Raw SRS Paste ── */}
                                {activeInsightTab === 'Raw SRS' && (
                                    <div>
                                        <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '8px', lineHeight: '1.5' }}>
                                            Paste raw markdown here to preview how it will be chunked by the semantic engine.
                                            This is a <strong>client-side preview only</strong> — upload a PDF to process it fully through the pipeline.
                                        </div>
                                        <textarea
                                            placeholder="Paste _clean.md content here to preview chunking..."
                                            rows={12}
                                            style={{
                                                width: '100%', resize: 'vertical', padding: '10px',
                                                borderRadius: '8px', border: '1px solid ' + T.border,
                                                background: T.inputBg, color: T.text,
                                                fontSize: '11px', fontFamily: 'monospace',
                                                boxSizing: 'border-box'
                                            }}
                                            onChange={e => {
                                                const text = e.target.value;
                                                const sections = text.split(/^#{1,3}\s+/m).filter(Boolean);
                                                setRawSrsPreview(sections.length > 0 ? sections : null);
                                            }}
                                        />
                                        {rawSrsPreview && (
                                            <div style={{ marginTop: '10px' }}>
                                                <div style={{ fontSize: '10px', color: T.textMuted, marginBottom: '6px' }}>
                                                    Preview: {rawSrsPreview.length} chunks detected
                                                </div>
                                                {rawSrsPreview.slice(0, 5).map((s, i) => (
                                                    <div key={i} style={{
                                                        padding: '8px', borderRadius: '8px', marginBottom: '4px',
                                                        background: T.surfaceAlt, fontSize: '10px', color: T.textSubtle,
                                                        borderLeft: `3px solid ${T.accent}`
                                                    }}>
                                                        {s.split('\n')[0].trim().substring(0, 60)}…
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                        </div>
                    )}


                    {/* ── Reasoning Terminal (Loading state) ── */}
                    {loading && (
                        <div style={{
                            position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.85)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
                            backdropFilter: 'blur(4px)'
                        }}>
                            <div style={{
                                width: '400px', background: '#1e293b', borderRadius: '12px',
                                border: '1px solid #334155', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                                overflow: 'hidden'
                            }}>
                                <div style={{ background: '#0f172a', padding: '10px 15px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #334155' }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#fbbf24' }} />
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} />
                                    <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '10px', fontFamily: 'monospace' }}>intellispec-v4.bin --analyze</span>
                                </div>
                                <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px', color: '#34d399', minHeight: '150px' }}>
                                    {reasoningSteps.map((step, i) => (
                                        <div key={i} style={{ marginBottom: '6px' }}>
                                            <span style={{ color: '#64748b' }}>[{i}]</span> {step}
                                        </div>
                                    ))}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>Synthesizing vector geometry...</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Properties Panel (appears when shape selected) ── */}
                    {selectedShape && (
                        <div style={{
                            position: 'absolute', top: '14px', right: '14px',
                            width: '260px', zIndex: 50,
                            background: T.surface,
                            border: '1px solid ' + T.border,
                            borderRadius: '14px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                            padding: '16px',
                            fontFamily: 'Inter, sans-serif',
                            transition: 'all 0.2s',
                        }}>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                                <span style={{ fontWeight: '700', fontSize: '13px', color: T.accent, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Edit3 size={14} /> Properties
                                </span>
                                <button onClick={() => setSelectedShape(null)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, padding: '2px',
                                }}>
                                    <XCircle size={16} />
                                </button>
                            </div>

                            {/* Type badge */}
                            <div style={{
                                fontSize: '11px', fontWeight: '600', color: T.badgeText,
                                background: T.badgeBg, border: '1px solid ' + T.badgeBorder,
                                padding: '3px 8px', borderRadius: '6px', display: 'inline-block', marginBottom: '12px',
                            }}>
                                {selectedShape.type}
                            </div>

                            {/* Label */}
                            <div style={{ marginBottom: '10px' }}>
                                <label style={{ fontSize: '11px', fontWeight: '600', color: T.textMuted, display: 'block', marginBottom: '4px' }}>Label</label>
                                <input
                                    id="prop-label-input"
                                    type="text"
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                    onBlur={() => {
                                        if (canvasRef.current && selectedShape) {
                                            canvasRef.current.renameShape(selectedShape.id, editLabel);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.target.blur();
                                        }
                                    }}
                                    style={{
                                        width: '100%', boxSizing: 'border-box',
                                        padding: '7px 10px', borderRadius: '8px',
                                        border: '1.5px solid ' + T.border,
                                        background: T.inputBg, color: T.text,
                                        fontSize: '12px', fontFamily: 'Inter, sans-serif',
                                        outline: 'none',
                                    }}
                                />
                            </div>

                            {/* Position */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '10px', fontWeight: '600', color: T.textMuted, display: 'block', marginBottom: '3px' }}>X</label>
                                    <input type="number" value={Math.round(selectedShape.x)} onChange={(e) => {
                                        var v = parseInt(e.target.value, 10);
                                        if (!isNaN(v) && canvasRef.current) {
                                            canvasRef.current.moveShape(selectedShape.id, v, selectedShape.y);
                                            setSelectedShape(prev => prev ? { ...prev, x: v } : null);
                                        }
                                    }} style={{
                                        width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '7px',
                                        border: '1px solid ' + T.border, background: T.inputBg, color: T.text,
                                        fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                                    }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '10px', fontWeight: '600', color: T.textMuted, display: 'block', marginBottom: '3px' }}>Y</label>
                                    <input type="number" value={Math.round(selectedShape.y)} onChange={(e) => {
                                        var v = parseInt(e.target.value, 10);
                                        if (!isNaN(v) && canvasRef.current) {
                                            canvasRef.current.moveShape(selectedShape.id, selectedShape.x, v);
                                            setSelectedShape(prev => prev ? { ...prev, y: v } : null);
                                        }
                                    }} style={{
                                        width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '7px',
                                        border: '1px solid ' + T.border, background: T.inputBg, color: T.text,
                                        fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                                    }} />
                                </div>
                            </div>

                            {/* Size */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '10px', fontWeight: '600', color: T.textMuted, display: 'block', marginBottom: '3px' }}>Width</label>
                                    <input type="number" value={selectedShape.width} onChange={(e) => handleResizeProp('width', e.target.value)} style={{
                                        width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '7px',
                                        border: '1px solid ' + T.border, background: T.inputBg, color: T.text,
                                        fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                                    }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '10px', fontWeight: '600', color: T.textMuted, display: 'block', marginBottom: '3px' }}>Height</label>
                                    <input type="number" value={selectedShape.height} onChange={(e) => handleResizeProp('height', e.target.value)} style={{
                                        width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '7px',
                                        border: '1px solid ' + T.border, background: T.inputBg, color: T.text,
                                        fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none',
                                    }} />
                                </div>
                            </div>

                            {/* Delete button */}
                            <button onClick={() => {
                                if (canvasRef.current) {
                                    canvasRef.current.deleteSelected();
                                    setSelectedShape(null);
                                }
                            }} style={{
                                width: '100%', padding: '8px', borderRadius: '8px',
                                background: isDark ? '#450a0a' : '#fef2f2',
                                border: '1px solid ' + (isDark ? '#991b1b' : '#fecaca'),
                                color: isDark ? '#fca5a5' : '#b91c1c',
                                fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                fontFamily: 'Inter, sans-serif',
                            }}>
                                <Trash2 size={14} /> Delete Shape
                            </button>
                        </div>
                    )}

                </div>

                {/* ── Prompt footer ──────────────────────────────────────── */}
                <footer style={{
                    padding: '14px 18px',
                    background: T.surface,
                    borderTop: '1px solid ' + T.border,
                    transition: 'background 0.2s, border-color 0.2s',
                }}>
                    {/* Messages Area */}
                    <div style={{ maxWidth: '1000px', margin: '0 auto 10px' }}>
                        {error && (
                            <div style={{
                                padding: '8px 12px', borderRadius: '8px',
                                background: T.errBg, border: '1px solid ' + T.errBorder,
                                color: T.errText, fontSize: '11px', lineHeight: '1.5',
                                marginBottom: '6px',
                            }}>
                                <strong>Error:</strong> {error}
                            </div>
                        )}

                        {prompt.trim() && (
                            <div style={{
                                padding: '4px 8px', borderRadius: '6px',
                                background: T.surfaceAlt, border: '1px solid ' + T.border,
                                fontSize: '10px', color: T.textSubtle, display: 'inline-block',
                            }}>
                                Detected: <strong style={{ color: T.accent }}>{detectDiagramType(prompt).toUpperCase()}</strong>
                            </div>
                        )}
                        
                        {parsingStatus && (
                            <div style={{
                                padding: '4px 8px', borderRadius: '6px', marginLeft: '8px',
                                background: T.okBg, border: '1px solid ' + T.okBorder,
                                fontSize: '10px', color: T.okText, display: 'inline-block',
                            }}>
                                <strong>Pipeline:</strong> {parsingStatus}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', maxWidth: '1000px', margin: '0 auto', alignItems: 'center' }}>
                        {/* SRS Drop zone */}
                        <div 
                            onClick={() => fileInputRef.current && fileInputRef.current.click()}
                            style={{
                                border: '1.5px dashed ' + T.border, borderRadius: '12px',
                                padding: '0 14px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: T.surfaceAlt, cursor: 'pointer', flexShrink: 0, minWidth: '110px',
                                transition: 'all 0.2s'
                            }}
                            title="Upload a pre-processed SRS Clarity JSON or a requirements text file"
                        >
                            <span style={{ fontSize: '11px', color: T.textMuted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <UploadCloud size={14} />
                                {selectedSrs === 'Custom SRS' ? 'Custom Loaded' : 'Upload SRS'}
                            </span>
                        </div>
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            onChange={handleFileUpload} 
                            accept=".json,.txt,.md"
                        />

                        {/* SRS Sample Selection Dropdown */}
                        <select
                            value={selectedSrs}
                            onChange={async (e) => {
                                const val = e.target.value;
                                setSelectedSrs(val);
                                if (val !== 'None' && val !== 'Custom SRS' && !SRS_SAMPLES[val]) {
                                    try {
                                        const resp = await fetch(`http://127.0.0.1:8000/api/document/${val}/intelligence`);
                                        if (resp.ok) {
                                            const data = await resp.json();
                                            setCustomSrs(data);
                                            setSelectedSrs('Custom SRS');
                                            setDebugInfo(`Fetched logic map for: ${val}`);
                                        }
                                    } catch (err) {
                                        console.warn('Failed to fetch pipeline intelligence maps dynamically.');
                                    }
                                }
                            }}
                            style={{
                                border: '1.5px solid ' + T.border,
                                background: T.inputBg,
                                color: T.text,
                                padding: '0 12px', height: '42px', borderRadius: '12px', outline: 'none',
                                fontSize: '12px', fontFamily: 'Inter, sans-serif', cursor: 'pointer',
                                minWidth: '150px',
                                transition: 'border-color 0.2s',
                            }}
                        >
                            <option value="None">No SRS Context</option>
                            <option value="Logbook Stories">Context: Logbook</option>
                            <option value="Bhavika Gondi SRS">Context: Bhavika Gondi</option>
                            <option value="Sreeram R SRS">Context: Sreeram R</option>
                            <option value="MediCore HMS">Context: MediCore HMS</option>
                            <option value="SE Group SRS">Context: SE Group</option>
                            {liveDocs.map(d => (
                                <option key={d.doc_id} value={d.doc_id}>Live: {d.doc_id}</option>
                            ))}
                            {customSrs && <option value="Custom SRS">Context: Uploaded</option>}
                        </select>

                        <input
                            id="diagram-prompt-input"
                            style={{
                                flex: 1,
                                border: '1.5px solid ' + T.border,
                                background: T.inputBg,
                                color: T.text,
                                padding: '11px 15px', borderRadius: '12px', outline: 'none',
                                fontSize: '13px', fontFamily: 'Inter, sans-serif',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                            }}
                            placeholder="e.g. 'Create a use case diagram for a library system'…"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !loading && handleGenerate()}
                            onFocus={e => {
                                e.target.style.borderColor = '#2563eb';
                                e.target.style.boxShadow  = '0 0 0 3px rgba(37,99,235,0.12)';
                            }}
                            onBlur={e => {
                                e.target.style.borderColor = T.border;
                                e.target.style.boxShadow  = 'none';
                            }}
                        />
                        <button
                            id="diagram-generate-btn"
                            onClick={handleGenerate}
                            disabled={loading || !prompt.trim()}
                            style={{
                                background: (loading || !prompt.trim())
                                    ? (isDark ? '#1e293b' : '#e2e8f0')
                                    : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                                color: (loading || !prompt.trim())
                                    ? (isDark ? '#4a5568' : '#94a3b8')
                                    : 'white',
                                border: 'none', padding: '11px 14px', borderRadius: '12px',
                                cursor: (loading || !prompt.trim()) ? 'not-allowed' : 'pointer',
                                boxShadow: (loading || !prompt.trim()) ? 'none' : '0 4px 12px rgba(37,99,235,0.35)',
                                transition: 'all 0.2s', flexShrink: 0,
                            }}
                        >
                            {loading
                                ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                                : <Send size={20} />
                            }
                        </button>
                    </div>
                </footer>
            </main>
        </div>
    );
};

export default Dashboard;
