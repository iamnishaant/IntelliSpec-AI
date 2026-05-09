/**
 * pureFrontendEngine.js
 * =====================
 * Phase 1 — Document Ingestion  : Fetch text from edituml backend (port 8001)
 * Phase 2 — Semantic Chunking   : Split large docs by headings, max 5000 chars/chunk
 * Phase 3 — Groq AI Extraction  : 3-turn chain (classify → extract → cross-check)
 *
 * UML Standard Entity Types (strictly enforced):
 *   actor          → uml.Actor          (stick figure — human/external system)
 *   use_case       → uml.UseCase        (oval — functional requirement)
 *   process        → uml.ActionState    (pill/rounded rect — internal process)
 *   decision       → uml.DecisionNode   (diamond — branch/condition)
 *   data_store     → dfd.DataStore      (open rectangle — DB/file storage)
 *   system         → uml.SystemBoundary (dashed rect — system scope)
 *   external       → dfd.ExternalEntity (plain rect — external party)
 *   start          → uml.StartNode      (filled circle — activity start)
 *   end            → uml.EndState       (bull's-eye — activity end)
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const BACKEND_URL  = 'http://127.0.0.1:8001'; // edituml parse backend

const getKey = () => (import.meta.env?.VITE_GROQ_API_KEY || '').trim();

/* ════════════════════════════════════════════════════════════════════════════
   UML STANDARD MAPPING TABLE
   Cross-reference table that maps AI category strings to JointJS shape types.
   This is the single source of truth. If the AI returns a category not in
   this table, it gets defaulted to 'uml.UseCase' and flagged in the log.
════════════════════════════════════════════════════════════════════════════ */
export const UML_STANDARD_MAP = {
  // Category             → JointJS Type            UML Standard Symbol
  actor:         'uml.Actor',           // Stick figure
  use_case:      'uml.UseCase',         // Oval
  process:       'uml.ActionState',     // Rounded rectangle
  decision:      'uml.DecisionNode',    // Diamond
  data_store:    'dfd.DataStore',       // Open-ended rectangle
  system:        'uml.SystemBoundary',  // Dashed border rectangle
  external:      'dfd.ExternalEntity',  // Plain rectangle
  start:         'uml.StartNode',       // Filled circle
  end:           'uml.EndState',        // Bull's-eye circle
};

const VALID_CATEGORIES = new Set(Object.keys(UML_STANDARD_MAP));

/**
 * Cross-check and map an AI-returned category to a JointJS type.
 * Falls back gracefully and logs warnings for unknown categories.
 */
export function getJointShapeForCategory(category, diagramType) {
  const cat = (category || '').toLowerCase().trim();
  
  // Handle synonyms the AI commonly returns
  const SYNONYMS = {
    user:        'actor',
    system_user: 'actor',
    role:        'actor',
    usecase:     'use_case',
    'use case':  'use_case',
    function:    'use_case',
    feature:     'use_case',
    action:      'process',
    activity:    'process',
    step:        'process',
    workflow:    'process',
    database:    'data_store',
    db:          'data_store',
    storage:     'data_store',
    datastore:   'data_store',
    entity:      'external',
    component:   'external',
    module:      'system',
    subsystem:   'system',
    branch:      'decision',
    condition:   'decision',
    gateway:     'decision',
  };

  const resolved = SYNONYMS[cat] || cat;
  
  if (!VALID_CATEGORIES.has(resolved)) {
    console.warn(`[UML-XCheck] Unknown category "${category}" — defaulting to use_case`);
    return 'uml.UseCase';
  }

  // DFD-specific overrides
  if (diagramType === 'dfd') {
    if (resolved === 'process')    return 'dfd.Process';
    if (resolved === 'actor')      return 'dfd.ExternalEntity';
  }

  return UML_STANDARD_MAP[resolved];
}

/* ════════════════════════════════════════════════════════════════════════════
   PHASE 1 — DOCUMENT INGESTION
   Uploads file to edituml backend (port 8001) and returns clean text.
════════════════════════════════════════════════════════════════════════════ */
export async function parseDocumentViaBackend(file, onProgress) {
  // Try backend first (port 8001)
  try {
    onProgress('📄 Connecting to parse server (port 8001)...');
    const formData = new FormData();
    formData.append('file', file);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(`${BACKEND_URL}/api/parse`, {
      method: 'POST',
      body:   formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    onProgress(`✅ Backend extracted ${data.word_count} words from document`);
    return data.text;

  } catch (e) {
    // Backend offline or timed out — fall back to browser FileReader
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      onProgress('⚠️ Parse backend offline. For PDFs please start: uvicorn main:app --port 8001');
      throw new Error(
        'PDF parsing requires the edituml backend.\n' +
        'Run: cd backend && uvicorn main:app --port 8001\n' +
        '(Or upload a .md / .txt file to proceed without the backend.)'
      );
    }

    // For .md/.txt files we can read directly in the browser
    onProgress('📄 Reading document directly in browser (backend offline)...');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (evt) => {
        const text = evt.target.result;
        onProgress(`✅ Read ${text.split(' ').length} words locally`);
        resolve(text);
      };
      reader.onerror = () => reject(new Error('Failed to read file in browser.'));
      reader.readAsText(file);
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   PHASE 2 — SEMANTIC CHUNKING
   Splits document by Markdown headings. If no headings exist, falls back
   to paragraph splitting. Each chunk is capped at maxChars.
════════════════════════════════════════════════════════════════════════════ */
export function chunkDocument(text, maxChars = 5000) {
  if (!text) return [];

  // Try heading-based split first
  let sections = text.split(/(?=^#{1,4}\s)/m).filter(s => s.trim().length > 50);
  
  // Fallback: paragraph split if no headings
  if (sections.length <= 1) {
    sections = text.split(/\n{2,}/).filter(s => s.trim().length > 50);
  }

  const chunks = [];
  let current  = '';

  for (const section of sections) {
    if (current.length + section.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += section + '\n';
  }
  if (current.trim()) chunks.push(current.trim());

  console.log(`[Chunker] ${chunks.length} chunks from ${text.length} chars`);
  return chunks;
}

/* ════════════════════════════════════════════════════════════════════════════
   GROQ API CALL HELPER
════════════════════════════════════════════════════════════════════════════ */
async function callGroq(messages, jsonMode = true) {
  const key = getKey();
  if (!key) throw new Error('VITE_GROQ_API_KEY is not set in your .env file.');

  const body = {
    model:       GROQ_MODEL,
    temperature: 0.05,
    messages,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(GROQ_API_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  if (jsonMode) {
    try   { return JSON.parse(content); }
    catch { throw new Error('Groq returned malformed JSON: ' + content.slice(0, 200)); }
  }
  return content;
}

/* ════════════════════════════════════════════════════════════════════════════
   PHASE 3A — DOCUMENT CLASSIFICATION
   Determine diagram type and extract a condensed semantic summary.
════════════════════════════════════════════════════════════════════════════ */
async function classifyDocument(chunks, userPrompt, onProgress) {
  onProgress('🔍 Phase 1/3 — Classifying document and diagram type...');

  const excerpt = chunks.slice(0, 2).join('\n\n---\n\n').slice(0, 6000);

  const result = await callGroq([
    {
      role: 'system',
      content: `You are a UML Diagram Classifier. Analyse the document and return strict JSON.

TASK: Determine the best UML diagram type and extract 3-5 key semantic themes.

RULES:
- Diagram types: "use_case", "activity", "dfd", "class", "sequence", "generic"
- Choose "use_case" if document describes actors, roles, and system features
- Choose "activity" if document describes workflows, processes, and flows
- Choose "dfd" if document describes data flows, stores, and processing
- Extract key actors (human roles, external systems)
- Extract key features (system capabilities, use cases)

OUTPUT (strict JSON):
{
  "diagram_type": "use_case",
  "rationale": "Document describes student-teacher interactions with system",
  "actors": ["Student", "Teacher", "Admin"],
  "key_features": ["Login", "Submit Assignment", "Grade Submission"],
  "system_name": "Learning Management System"
}`
    },
    {
      role: 'user',
      content: `User prompt: "${userPrompt}"\n\nDocument excerpt:\n${excerpt}`,
    }
  ]);

  console.log('[Classifier]', result);
  onProgress(`✅ Classified as "${result.diagram_type}" — ${result.system_name || 'System'}`);
  return result;
}

/* ════════════════════════════════════════════════════════════════════════════
   PHASE 3B — SEMANTIC ENTITY EXTRACTION
   Extract all UML entities per chunk, then merge and deduplicate.
════════════════════════════════════════════════════════════════════════════ */
async function extractEntities(chunks, classification, onProgress) {
  onProgress('🧠 Phase 2/3 — Extracting UML entities from document...');

  const chunkContext = chunks.slice(0, 3).join('\n\n---\n\n').slice(0, 8000);

  const CATEGORY_GUIDE = `
CATEGORIES (use exactly these strings):
  "actor"       → Human user, external system, or role that interacts with the system
  "use_case"    → A specific action/feature/goal the system provides
  "process"     → Internal processing step or business logic
  "decision"    → A branch point or condition in a flow
  "data_store"  → Database, file, or persistent storage
  "system"      → The system boundary or a major subsystem
  "external"    → External service, API, or third-party component`;

  const result = await callGroq([
    {
      role: 'system',
      content: `You are a UML Entity Extractor. Extract ALL relevant entities from the document.

Context from classifier:
- Diagram type: ${classification.diagram_type}
- System name: ${classification.system_name || 'System'}
- Known actors: ${(classification.actors || []).join(', ')}
- Key features: ${(classification.key_features || []).join(', ')}

${CATEGORY_GUIDE}

RULES:
1. Extract 8-25 entities. Do not extract fewer than 8.
2. Every actor identified by the classifier MUST appear as an entity.
3. Every key feature identified MUST appear as a use_case entity.
4. Entities must have SHORT, precise labels (2-4 words max).
5. Do NOT assign x/y positions.
6. id must be unique (e.g., "e1", "e2", ...)

OUTPUT (strict JSON):
{
  "entities": [
    { "id": "e1", "label": "Student", "category": "actor", "description": "Person who uses the system to submit work" },
    { "id": "e2", "label": "Submit Assignment", "category": "use_case", "description": "Student uploads completed work" }
  ]
}`
    },
    {
      role: 'user',
      content: `Document sections:\n${chunkContext}`,
    }
  ]);

  const entities = result.entities || [];
  console.log(`[Extractor] ${entities.length} entities extracted`);
  onProgress(`✅ Extracted ${entities.length} UML entities`);
  return entities;
}

/* ════════════════════════════════════════════════════════════════════════════
   PHASE 3C — RELATIONSHIP EXTRACTION
   Extract connections between entities as human-readable instructions.
════════════════════════════════════════════════════════════════════════════ */
async function extractRelationships(entities, classification, onProgress) {
  onProgress('🔗 Phase 3/3 — Mapping relationships and connections...');

  const entityList = entities
    .map(e => `  ${e.id}: "${e.label}" [${e.category}]`)
    .join('\n');

  const result = await callGroq([
    {
      role: 'system',
      content: `You are a UML Relationship Extractor. Given a list of UML entities, define all meaningful connections.

RULES:
1. Only create connections between existing entity IDs.
2. Actors connect TO use_cases they initiate ("initiates", "performs", "accesses").
3. Use_cases connect to data_stores they read/write.
4. Processes connect to other processes in sequence.
5. Create 5-20 connections. Prefer quality over quantity.
6. "instruction" must be a human-readable sentence: "Actor initiates Use Case"

OUTPUT (strict JSON):
{
  "connections": [
    {
      "id": "c1",
      "from": "e1",
      "to": "e2",
      "label": "initiates",
      "instruction": "Student initiates Submit Assignment"
    }
  ]
}`
    },
    {
      role: 'user',
      content: `Diagram type: ${classification.diagram_type}\n\nEntities:\n${entityList}`,
    }
  ]);

  const connections = result.connections || [];
  console.log(`[Relations] ${connections.length} connections mapped`);
  onProgress(`✅ ${connections.length} relationships mapped`);
  return connections;
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — extractGraphWithGroq
   Orchestrates all 3 phases and returns the final node/instruction graph
   with UML-standard-compliant shape types.
════════════════════════════════════════════════════════════════════════════ */
export async function extractGraphWithGroq(userPrompt, documentText, onProgress) {
  onProgress('🚀 Starting AI semantic analysis pipeline...');

  if (!documentText || documentText.trim().length < 50) {
    throw new Error('Document is too short or empty. Please provide a meaningful SRS document.');
  }

  // Phase 2: Semantic chunking
  const chunks = chunkDocument(documentText);
  onProgress(`📦 Document split into ${chunks.length} semantic chunks`);

  // Phase 3A: Classification
  const classification = await classifyDocument(chunks, userPrompt, onProgress);

  // Phase 3B: Entity extraction
  const rawEntities = await extractEntities(chunks, classification, onProgress);

  // Phase 3C: Relationship extraction
  const rawConnections = await extractRelationships(rawEntities, classification, onProgress);

  // ── UML Standard Cross-Check ──────────────────────────────────────────────
  onProgress('✅ Cross-checking entities against UML standards...');

  const nodes = rawEntities.map((e, i) => {
    const jointType = getJointShapeForCategory(e.category, classification.diagram_type);
    console.log(`[UML-XCheck] "${e.label}" [${e.category}] → ${jointType}`);
    return {
      id:          e.id || `e${i}`,
      label:       e.label || 'Entity',
      category:    e.category || 'use_case',
      description: e.description || '',
      jointType,   // Standards-compliant JointJS shape type
    };
  });

  const nodeIds = new Set(nodes.map(n => n.id));

  const instructions = rawConnections
    .filter(c => nodeIds.has(c.from) && nodeIds.has(c.to)) // validate IDs exist
    .map((c, i) => {
      const fromNode = nodes.find(n => n.id === c.from);
      const toNode   = nodes.find(n => n.id === c.to);
      return {
        id:          c.id || `c${i}`,
        from:        c.from,
        to:          c.to,
        label:       c.label || 'relates to',
        text:        c.instruction || `${fromNode?.label || c.from} → ${toNode?.label || c.to}`,
        instruction: c.instruction || `${fromNode?.label || c.from} ${c.label || 'relates to'} ${toNode?.label || c.to}`,
      };
    });

  console.log(`[Pipeline] Complete — ${nodes.length} nodes, ${instructions.length} instructions`);
  onProgress(`🎉 Pipeline complete — ${nodes.length} entities, ${instructions.length} connections`);

  return {
    diagram_type: classification.diagram_type,
    system_name:  classification.system_name || 'System',
    nodes,
    instructions,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   SHAPE MAPPING (backwards compat export)
════════════════════════════════════════════════════════════════════════════ */
export const SHAPE_MAPPING = UML_STANDARD_MAP;
