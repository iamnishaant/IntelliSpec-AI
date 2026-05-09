# Next-Gen Human-in-the-Loop UML Generator
**Architectural Vision & Implementation Plan**

## 1. The Core Philosophy: Separation of Concerns
The biggest bottleneck in AI-generated diagrams is forcing the LLM to guess spatial coordinates (X, Y). It often results in overlapping, messy, and unreadable diagrams. 

**The New Paradigm:**
1. **AI Handles Semantics**: The model reads the PDF/README and extracts all entities, categories, and relationships into a structured format.
2. **Human Handles Layout**: The user visually constructs the diagram by dragging nodes and clicking "Instruction Blocks" to form connections. The system tracks everything in real-time.

This ensures **100% diagram completeness** (no dropped nodes due to context limits) and **perfect spatial organization** tailored to human preference.

---

## 2. Model Selection & Engine Setup
To achieve state-of-the-art reasoning without prohibitive API costs, we will leverage high-performance open-weight models via free-tier inference APIs.

### Primary Engine
- **Model**: `Llama-3.3-70B-Instruct`
- **Provider**: **Groq** (Provides ultra-fast inference, often 300+ tokens/sec on free tiers, perfect for extracting large documents).
- **Alternative Providers**: Together AI, Hugging Face Inference API.

### Fallback Mechanism
If the primary provider hits rate limits, the system will gracefully degrade:
- **Tier 1**: `Llama-3.3-70B-Instruct` (Groq)
- **Tier 2**: `Mixtral-8x7B` or `Llama-3.1-8B-Instruct` (Together AI / HF)
- **Tier 3 (Offline)**: Regex-based semantic parser (extracts capitalized nouns and verbs from SRS "shall" statements if APIs fail).

### Data Ingestion & Semantic Chunking
- **PDFs**: Processed via client-side libraries (or lightweight proxy) to extract raw text.
- **Chunking Strategy**: A 30-page SRS will not fit cleanly into a single prompt. We will use **Semantic Chunking** (splitting by section boundaries/headers) before passing text to the Llama 70B model. This guarantees zero dropped functional requirements under context pressure.
- **README / Text**: Direct injection if small, chunked if large.

---

## 3. System Architecture & UI/UX Design

### The Workspace Layout
The UI is divided into two primary areas:

#### A. The Left Panel (The Staging Area)
1. **Node Palette**: Categorized lists of extracted nodes (e.g., Actors, Use Cases, Systems, Databases). Nodes have visual icons and labels.
2. **Instruction Ledger**: A vertical list of relationships formatted as clickable blocks.
   - *Format*: `[Source Node] --(Relation)--> [Target Node]`
   - *Example*: `User connects to Withdraw Money`

#### B. The Right Panel (The Canvas)
An infinite, pannable workspace (powered by JointJS or React Flow) where the user drags and drops nodes.

### The "Node Registry" (Real-time State)
The secret sauce is a centralized state manager (e.g., Zustand/Redux) that tracks the canvas.
- When a user drops a node onto the canvas, it is registered: `nodeRegistry['node_id'] = { placed: true, x: 100, y: 200 }`
- **Dynamic Instruction Blocks**: The Instruction Ledger watches the `nodeRegistry`.
  - ⬜ **Gray**: Neither node is placed.
  - 🟨 **Yellow**: One node placed.
  - 🟩 **Green (Ready)**: Both nodes placed.

### The Connection Mechanics (Bendable Lines)
When a user clicks a **Green** instruction block:
1. The backend/state confirms both nodes exist on the canvas.
2. A flexible, bendable link is drawn automatically between the two nodes.
3. We use **Manhattan or Metro routing** algorithms so the line intelligently routes around other nodes.
4. The user can click and drag the line to add "vertices" (bends) to perfect the aesthetics.
5. If a node is moved, the line auto-updates its coordinates smoothly.

---

## 4. Step-by-Step Implementation Plan

### Phase 1: Pure-Frontend AI Extraction Engine & Chunking
1. **Drop the Backend**: To remove deployment complexity, the application will be a pure frontend app. We will call Groq's OpenAI-compatible REST API directly via `fetch()` using an environment variable API key.
2. **Semantic Chunking**: Implement a utility function to split uploaded documents by section headers, ensuring each chunk fits perfectly into the prompt context window.
3. **Prompt Engineering**: Craft a prompt that demands strict JSON output:
   ```json
   {
     "diagram_type": "use_case",
     "nodes": [
       {"id": "n1", "label": "User", "category": "actor"},
       {"id": "n2", "label": "Withdraw Money", "category": "use_case"}
     ],
     "relations": [
       {"id": "r1", "source": "n1", "target": "n2", "label": "connects to", "instruction": "User connects to Withdraw Money"}
     ]
   }
   ```

### Phase 2: Frontend State, Persistence & Staging Area
1. **Build the Node Registry**: Initialize the Zustand store to hold nodes, relations, and canvas status.
2. **Save & Resume (State Persistence)**: Implement `localStorage` serialization. On every significant action, call `graph.toJSON()` and save the state alongside the extracted JSON. This ensures a user's progress is never lost on page refresh.
3. **Render the Left Panel**: 
   - Map `nodes` to draggable UI elements grouped by `category`.
   - Map `relations` to Instruction Blocks.
3. **State Validation**: Add logic to dynamically color Instruction Blocks based on the `placed` status of their source and target nodes.

### Phase 3: Canvas Drag & Drop Integration
1. **Canvas Setup**: Initialize the JointJS/ReactFlow paper.
2. **Drop Handlers**: When a node is dropped from the sidebar:
   - Render the visual SVG/HTML shape on the canvas.
   - **Multi-Diagram Mapping Table**: Use a strict mapping table to determine the JointJS shape based on the active diagram mode and node category (e.g., `actor` → `uml.Actor`, `process` → `standard.Ellipse`, `data_store` → `standard.Cylinder`). This ensures nodes aren't incorrectly rendered as plain rectangles in specialized diagrams.
   - Update the `NodeRegistry` with `{ placed: true, x, y }`.
3. **Movement Tracking**: Bind to the `change:position` event so dragging a node on the canvas continuously updates the registry.

### Phase 4: Smart Instruction Execution & Routing
1. **Instruction Click Handler**:
   - If block is Green: Trigger `drawLine(sourceId, targetId)`.
   - If block is Yellow/Gray: Show Toast Alert (`"Please place both [Node A] and [Node B] on the canvas first."`).
2. **Flexible Links**: Configure the link properties:
   - Allow adding vertices (bend points).
   - Set router to `manhattan` to avoid line overlapping.
3. **Instruction Completion**: Once clicked, mark the instruction as completed (e.g., strikethrough or hide) so the user knows the relationship is established.

---

## 5. Summary of the User Journey
1. User uploads `Dristi Project Srs Document.pdf`.
2. Llama 3.3 parses it and extracts 12 actors and 30 use cases.
3. The left panel populates with these items and 45 instruction blocks.
4. The user drags the "Admin" icon to the right, and "Manage Users" to the center.
5. The instruction block `"Admin connects to Manage Users"` turns **Green**.
6. The user clicks it. A smooth, flexible arrow appears instantly connecting the two.
7. The user repeats this, building a perfect, logically sound diagram without fighting an AI's bad spatial guesses.
