/**
 * promptEngine.js — IntelliSpec AI Semantic Diagram Engine
 *
 * 3-Pass Pipeline:
 *   Pass 1: Classify diagram type + retrieve relevant SRS chunks from backend
 *   Pass 2: Build a standards-compliant system prompt + call Groq LLM
 *   Pass 3: Parse, validate, and post-process the LLM's semantic graph JSON
 *
 * UML Standards Enforced:
 *   - Use Case:  uml.Actor, uml.UseCase, uml.SystemBoundary
 *   - Activity:  uml.StartNode, uml.ActionState, uml.DecisionNode, uml.EndState
 *   - DFD:       dfd.ExternalEntity, dfd.Process, dfd.DataStore
 *   - Sequence:  standard.Rectangle (lifelines)
 *   - Class:     standard.Rectangle
 */

const BACKEND_URL  = 'http://localhost:8000';
const GROQ_API_KEY = import.meta.env?.VITE_GROQ_API_KEY || '';

// ── Groq model fallback chain ────────────────────────────────────────────────
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',   // Tier 1 — best reasoning + context
    'llama3-70b-8192',           // Tier 2 — stable fallback
    'mixtral-8x7b-32768',        // Tier 3 — good JSON output
    'gemma2-9b-it',              // Tier 4 — lightweight offline
];

// ── UML Standards: diagram type → valid entity categories + JointJS types ────
export const UML_STANDARDS = {
    use_case: {
        categories: ['actor', 'use_case', 'system', 'note', 'constraint'],
        categoryMap: {
            actor:      { jointType: 'uml.Actor',          icon: '🧍', color: '#3b82f6' },
            use_case:   { jointType: 'uml.UseCase',         icon: '🔵', color: '#7c3aed' },
            system:     { jointType: 'uml.SystemBoundary',  icon: '🔲', color: '#0284c7' },
            note:       { jointType: 'uml.Note',            icon: '📝', color: '#ca8a04' },
            constraint: { jointType: 'uml.Constraint',      icon: '📐', color: '#2563eb' },
        },
        guidance: `
## Use Case Diagram Rules (UML 2.5 Standard)
- ACTORS: People or external systems that interact with the system. Category: "actor"
- USE CASES: Specific goals the system fulfills. Category: "use_case"  
- SYSTEM BOUNDARY: The boundary box containing use cases. Category: "system"
- RELATIONSHIPS: "performs" (actor→use_case), "include" (UC→UC), "extend" (UC→UC), "generalize"
- Extract EVERY distinct user goal as a separate use case node.
- Do NOT combine multiple goals into one node.`,
    },
    activity: {
        categories: ['start', 'action', 'decision', 'end', 'note', 'constraint'],
        categoryMap: {
            start:      { jointType: 'uml.StartNode',    icon: '⚫', color: '#111827' },
            action:     { jointType: 'uml.ActionState',  icon: '🟩', color: '#16a34a' },
            decision:   { jointType: 'uml.DecisionNode', icon: '🔶', color: '#d97706' },
            end:        { jointType: 'uml.EndState',     icon: '🔴', color: '#dc2626' },
            note:       { jointType: 'uml.Note',         icon: '📝', color: '#ca8a04' },
            constraint: { jointType: 'uml.Constraint',   icon: '📐', color: '#2563eb' },
        },
        guidance: `
## Activity Diagram Rules (UML 2.5 Standard)
- START NODE: Exactly one filled circle node. Category: "start", label: "Start"
- ACTION STATES: Rounded rectangles for each process step. Category: "action"
- DECISION NODES: Diamond shapes for branching. Category: "decision", label as a question
- END STATE: Exactly one bull's-eye circle. Category: "end", label: "End"
- GUARD CONDITIONS: Edge labels use [condition] format e.g. "[valid]", "[attendance < 75%]"
- Math formulas from SRS → create "constraint" nodes attached to the relevant decision.
- Extract flow must be linear top-to-bottom unless branching is needed.`,
    },
    dfd: {
        categories: ['external', 'process', 'data_store', 'note'],
        categoryMap: {
            external:   { jointType: 'dfd.ExternalEntity', icon: '📦', color: '#64748b' },
            process:    { jointType: 'dfd.Process',         icon: '🟩', color: '#16a34a' },
            data_store: { jointType: 'dfd.DataStore',       icon: '🗄️', color: '#ea580c' },
            note:       { jointType: 'uml.Note',            icon: '📝', color: '#ca8a04' },
        },
        guidance: `
## Data Flow Diagram Rules (Gane-Sarson Standard)
- EXTERNAL ENTITIES: Actors/systems outside the system boundary. Category: "external"
- PROCESSES: Circles/ovals that transform or act on data. Category: "process"
- DATA STORES: Open-ended rectangles for stored data. Category: "data_store"
- DATA FLOWS: Every connection label MUST be the specific data item being transferred (e.g. "Login Request", "User Record"). NOT generic labels like "sends" or "flows".
- There must be at least one process in any DFD.`,
    },
    sequence: {
        categories: ['lifeline', 'note'],
        categoryMap: {
            lifeline:   { jointType: 'standard.Rectangle', icon: '📋', color: '#6366f1' },
            note:       { jointType: 'uml.Note',           icon: '📝', color: '#ca8a04' },
        },
        guidance: `
## Sequence Diagram Rules (UML 2.5 Standard)
- LIFELINES: Vertical objects (actors and systems). Category: "lifeline"
- MESSAGES: Horizontal arrows between lifelines. Numbered in order (1.0, 1.1, 2.0...)
- Connection labels format: "1. requestName(params)" or "return value"
- List all participating objects in the scenario as separate lifeline nodes.`,
    },
    class: {
        categories: ['class', 'interface', 'note'],
        categoryMap: {
            class:     { jointType: 'standard.Rectangle', icon: '📋', color: '#6366f1' },
            interface: { jointType: 'standard.Rectangle', icon: '🔷', color: '#0ea5e9' },
            note:      { jointType: 'uml.Note',           icon: '📝', color: '#ca8a04' },
        },
        guidance: `
## Class Diagram Rules (UML 2.5 Standard)
- CLASSES: Entities with attributes. Category: "class"
- INTERFACES: Abstract contracts. Category: "interface"
- RELATIONSHIPS: "associates", "depends on", "extends", "implements", "has-a (composition)", "contains (aggregation)"
- Multiplicity goes in the connection label e.g. "1..* has-a"`,
    },
};


// ─────────────────────────────────────────────────────────────
// PASS 0: Retrieve semantic chunks from backend
// ─────────────────────────────────────────────────────────────

async function retrieveRelevantChunks(docId, userPrompt, topK = 6) {
    if (!docId) {
        console.log('[PromptEngine] No docId — skipping chunk retrieval');
        return [];
    }
    try {
        console.log(`[PromptEngine] Fetching chunks for doc="${docId}" query="${userPrompt.slice(0, 60)}"`);
        const res = await fetch(`${BACKEND_URL}/api/document/${docId}/chunks/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userPrompt, top_k: topK })
        });
        if (!res.ok) {
            console.warn(`[PromptEngine] Chunk search returned ${res.status}`);
            return [];
        }
        const data = await res.json();
        const chunks = data.chunks || [];
        console.log(`[PromptEngine] ✓ Retrieved ${chunks.length} chunks`);
        chunks.forEach((c, i) => {
            console.log(`  [Chunk ${i}] "${c.heading}" | category=${c.category} | math=${c.math?.length||0} | figures=${c.figures?.length||0} | body_len=${c.body?.length||0}`);
        });
        return chunks;
    } catch (err) {
        console.warn('[PromptEngine] Chunk retrieval error:', err.message);
        return [];
    }
}


// ─────────────────────────────────────────────────────────────
// PASS 1: Classify diagram type
// ─────────────────────────────────────────────────────────────

export function classifyDiagramType(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes('use case') || p.includes('usecase') || p.includes('actor') || p.includes('user interaction') || p.includes('use-case')) return 'use_case';
    if (p.includes('activity') || p.includes('flow chart') || p.includes('workflow') || p.includes('procedure') || p.includes('algorithm')) return 'activity';
    if (p.includes('sequence') || p.includes('interaction') || p.includes('message flow') || p.includes('timing') || p.includes('protocol')) return 'sequence';
    if (p.includes('class') || p.includes('entity') || p.includes('data model') || p.includes('erd') || p.includes('schema')) return 'class';
    if (p.includes('dfd') || p.includes('data flow') || p.includes('dataflow') || p.includes('level 0') || p.includes('level 1')) return 'dfd';
    if (p.includes('component') || p.includes('deployment') || p.includes('architecture') || p.includes('service') || p.includes('module')) return 'use_case';
    return 'use_case'; // default to most common
}


// ─────────────────────────────────────────────────────────────
// Build chunk context string for LLM prompt
// ─────────────────────────────────────────────────────────────

function buildChunkContext(chunks) {
    if (!chunks || chunks.length === 0) return '';

    const parts = chunks.map((c, i) => {
        let text = `### [Section ${i+1}] "${c.heading}" (type: ${c.category})\n${c.body}`;

        if (c.math && c.math.length > 0) {
            const mathStr = c.math.map(m => `  • [${m.type}] ${m.expression}`).join('\n');
            text += `\n\n⚠️ MATHEMATICAL CONSTRAINTS (extract as "constraint" nodes):\n${mathStr}`;
        }
        if (c.figures && c.figures.length > 0) {
            text += `\n\n📊 FIGURE REFERENCES (extract as "note" nodes): ${c.figures.join(', ')}`;
        }
        if (c.story_ids && c.story_ids.length > 0) {
            text += `\n\n🔖 Story IDs: ${c.story_ids.join(', ')}`;
        }
        return text;
    });

    return `
╔══════════════════════════════════════════════════════╗
║        AUTHORITATIVE SRS DOCUMENTATION CONTEXT       ║
╚══════════════════════════════════════════════════════╝
The following sections are the most relevant parts of the
Software Requirements Specification document.
Use ONLY this content as the ground truth for entity extraction.
Do NOT hallucinate entities not present in this text.

${parts.join('\n\n' + '─'.repeat(60) + '\n\n')}

╔══════════════════════════════════════════════════════╗
║                 END OF SRS CONTEXT                   ║
╚══════════════════════════════════════════════════════╝`.trim();
}


// ─────────────────────────────────────────────────────────────
// PASS 2: Build diagram-specific system prompt
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(diagramType, chunkContext, intelligenceData) {
    const standard = UML_STANDARDS[diagramType] || UML_STANDARDS.use_case;
    const actors = (intelligenceData?.actors || []).join(', ') || 'Not specified';
    const stories = (intelligenceData?.user_stories || []).slice(0, 15).map(s =>
        `  - [${s.role || 'User'}]: ${s.goal || s.raw_text || ''}`
    ).join('\n');

    const categoryDocs = Object.entries(standard.categoryMap).map(([cat, meta]) =>
        `  - "${cat}" → ${meta.jointType} ${meta.icon}`
    ).join('\n');

    return `You are an expert UML Architect implementing the IntelliSpec AI diagram assembly system.

Your task: Extract a SEMANTIC GRAPH from the provided SRS documentation to power a Human-in-the-Loop diagram builder.

${standard.guidance}

## YOUR OUTPUT FORMAT
You MUST return ONLY a valid JSON object. No markdown, no explanation.
{
  "entities": [
    {
      "id": "e1",
      "label": "Short Label (2-5 words max)",
      "category": "one_of_the_valid_categories",
      "desc": "Direct quote or paraphrase from SRS supporting this entity"
    }
  ],
  "connections": [
    {
      "id": "c1",
      "from": "e1",
      "to": "e2",
      "label": "relationship description (2-4 words)",
      "text": "Full instruction: [Source] → [label] → [Target]"
    }
  ]
}

## VALID CATEGORIES FOR THIS DIAGRAM TYPE: ${diagramType.toUpperCase()}
${categoryDocs}

## CRITICAL RULES
1. Every entity "id" must be unique (e1, e2, e3...).
2. Every connection "from" and "to" must reference valid entity IDs.
3. Labels must be SHORT (2-5 words). Descriptions carry the detail.
4. Extract EVERY distinct entity mentioned in the SRS chunks.
5. Create "constraint" entities for ALL mathematical formulas found.
6. Create "note" entities for ALL figure references found.
7. Do NOT invent entities not in the SRS. Quality over quantity.
8. Connections must use UML-standard relationship labels for this diagram type.

## DOCUMENT INTELLIGENCE SUMMARY
Known Actors from SRS: ${actors}

Key User Stories:
${stories || '  (No user stories found — extract from raw SRS chunks)'}

${chunkContext ? chunkContext : '⚠️ No SRS chunks provided — extract entities from intelligence summary only. Be conservative.'}
`;
}


// ─────────────────────────────────────────────────────────────
// PASS 3: Parse and validate LLM output
// ─────────────────────────────────────────────────────────────

function parseSemanticGraph(rawOutput, diagramType) {
    // Strip markdown code fences
    let cleaned = rawOutput
        .replace(/^```(?:json)?\s*/im, '')
        .replace(/```\s*$/im, '')
        .trim();

    // Extract JSON object
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
        throw new Error('LLM did not return a JSON object. Raw output: ' + rawOutput.slice(0, 200));
    }
    cleaned = cleaned.slice(start, end + 1);

    let graph;
    try {
        graph = JSON.parse(cleaned);
    } catch (e) {
        throw new Error(`JSON parse error: ${e.message}. Output fragment: ${cleaned.slice(0, 300)}`);
    }

    // Normalize structure
    if (!Array.isArray(graph.entities))   graph.entities   = [];
    if (!Array.isArray(graph.connections)) graph.connections = [];

    const standard = UML_STANDARDS[diagramType] || UML_STANDARDS.use_case;

    // Post-process entities
    graph.entities = graph.entities.map((e, i) => {
        const cat = e.category?.toLowerCase() || 'use_case';
        const meta = standard.categoryMap[cat] || Object.values(standard.categoryMap)[0];
        return {
            ...e,
            id:        e.id || `e${i+1}`,
            label:     (e.label || 'Unnamed').slice(0, 60),
            category:  cat,
            jointType: meta.jointType,   // Standards-compliant JointJS type
            desc:      e.desc || '',
        };
    });

    // Post-process connections
    graph.connections = graph.connections.map((c, i) => ({
        ...c,
        id:   c.id || `instr-${i+1}`,
        text: c.text || `${graph.entities.find(e => e.id === c.from)?.label || c.from} → ${c.label} → ${graph.entities.find(e => e.id === c.to)?.label || c.to}`,
    }));

    console.log(`[PromptEngine] ✓ Parsed graph: ${graph.entities.length} entities, ${graph.connections.length} connections`);

    // Validate cross-references
    const entityIds = new Set(graph.entities.map(e => e.id));
    const invalidConns = graph.connections.filter(c => !entityIds.has(c.from) || !entityIds.has(c.to));
    if (invalidConns.length > 0) {
        console.warn(`[PromptEngine] ⚠ ${invalidConns.length} connections reference invalid entity IDs. Removing.`);
        graph.connections = graph.connections.filter(c => entityIds.has(c.from) && entityIds.has(c.to));
    }

    return graph;
}


// ─────────────────────────────────────────────────────────────
// Call Groq LLM with model fallback chain
// ─────────────────────────────────────────────────────────────

async function callGroqLLM(systemPrompt, userMessage) {
    if (!GROQ_API_KEY) {
        throw new Error('VITE_GROQ_API_KEY not set. Add it to your .env file:\nVITE_GROQ_API_KEY=gsk_your_key_here');
    }

    let lastError = 'No models tried';

    for (const model of GROQ_MODELS) {
        console.log(`[PromptEngine] → Trying model: ${model}`);
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.2,      // Low temperature = more deterministic JSON
                    max_tokens: 8192,
                    response_format: { type: 'json_object' }, // Force JSON on supported models
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userMessage  },
                    ]
                })
            });

            if (res.ok) {
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || '';
                const usage = data.usage || {};
                console.log(`[PromptEngine] ✅ ${model} OK | tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} | output=${content.length} chars`);
                return content;
            }

            const errText = await res.text();
            console.warn(`[PromptEngine] ✗ ${model} → HTTP ${res.status}: ${errText.slice(0, 200)}`);

            if (res.status === 400) {
                // Bad request from this model (maybe doesn't support json_object) — try without it
                console.log(`[PromptEngine] Retrying ${model} without response_format...`);
                const res2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model,
                        temperature: 0.2,
                        max_tokens: 8192,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user',   content: userMessage  },
                        ]
                    })
                });
                if (res2.ok) {
                    const data2 = await res2.json();
                    const content2 = data2.choices?.[0]?.message?.content || '';
                    console.log(`[PromptEngine] ✅ ${model} (no json_mode) OK | output=${content2.length} chars`);
                    return content2;
                }
            }

            lastError = `${model} HTTP ${res.status}`;

        } catch (err) {
            lastError = err.message;
            console.warn(`[PromptEngine] ✗ ${model} threw: ${err.message}`);
        }
    }

    throw new Error(`All Groq models failed. Last error: ${lastError}`);
}


// ─────────────────────────────────────────────────────────────
// MAIN EXPORT: generateDiagram (3-pass pipeline)
// ─────────────────────────────────────────────────────────────

/**
 * Multi-Pass Diagram Generation
 *
 * @param {string} userPrompt  - e.g. "Create an activity diagram for login flow"
 * @param {string|null} docId  - document ID from backend (or null)
 * @param {object|null} intel  - intelligence.json data (or null)
 * @param {Function} onProgress - progress callback(msg: string)
 * @returns {Promise<{entities, connections, diagramType}>}
 */
export async function generateDiagram(userPrompt, docId, intel, onProgress = () => {}) {

    // ── PASS 1: Classify ─────────────────────────────────────────────
    onProgress('🔍 Classifying diagram type...');
    const diagramType = classifyDiagramType(userPrompt);
    console.log(`[PromptEngine] ═══ PASS 1 ═══ Diagram type: "${diagramType.toUpperCase()}"`);

    // ── PASS 1b: Retrieve SRS chunks ─────────────────────────────────
    onProgress('📦 Retrieving SRS context chunks...');
    const chunks = await retrieveRelevantChunks(docId, userPrompt, 6);

    const chunkContext = buildChunkContext(chunks);
    if (chunkContext) {
        console.log(`[PromptEngine] ✓ Chunk context ready (${chunkContext.length} chars)`);
    } else {
        console.warn('[PromptEngine] ⚠ No chunk context — falling back to intelligence.json only');
    }

    // ── PASS 2: LLM Call ─────────────────────────────────────────────
    onProgress('🧠 Generating semantic entities...');
    const systemPrompt = buildSystemPrompt(diagramType, chunkContext, intel);
    console.log(`[PromptEngine] ═══ PASS 2 ═══ System prompt: ${systemPrompt.length} chars`);

    const rawOutput = await callGroqLLM(systemPrompt, userPrompt);

    // ── PASS 3: Parse & Validate ─────────────────────────────────────
    onProgress('✅ Parsing and validating semantic graph...');
    console.log('[PromptEngine] ═══ PASS 3 ═══ Parsing output...');
    const graph = parseSemanticGraph(rawOutput, diagramType);

    console.log(`[PromptEngine] ═══ DONE ═══ Entities: ${graph.entities.length} | Connections: ${graph.connections.length}`);
    graph.entities.forEach(e => {
        console.log(`  [Entity] ${e.id}: "${e.label}" | cat=${e.category} | joint=${e.jointType}`);
    });

    onProgress('');
    return { ...graph, diagramType };
}


/**
 * Offline fallback — no chunk retrieval, uses intelligence.json only.
 */
export async function generateDiagramOffline(userPrompt, intel, onProgress = () => {}) {
    onProgress('🧠 Generating semantic graph (offline mode)...');
    const diagramType = classifyDiagramType(userPrompt);
    console.log(`[PromptEngine] OFFLINE mode — type: ${diagramType}`);
    const systemPrompt = buildSystemPrompt(diagramType, '', intel);
    const rawOutput = await callGroqLLM(systemPrompt, userPrompt);
    onProgress('✅ Parsing...');
    const graph = parseSemanticGraph(rawOutput, diagramType);
    onProgress('');
    return { ...graph, diagramType };
}


/**
 * Debug helper — preview chunks for a document.
 */
export async function previewChunks(docId) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/document/${docId}/chunks`);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}
