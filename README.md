# 🧠 IntelliSpec AI

IntelliSpec AI (formerly EditUML) is a powerful **Dual-Architecture Workspace** that bridges the gap between natural language Software Requirements Specifications (SRS) and interactive, editable software architecture diagrams. 

Instead of just drawing shapes, IntelliSpec acts as an **Intelligent Engineering Partner**—auditing your requirements for ambiguities and automatically synthesizing complex Use Case, Activity, and Data Flow Diagrams (DFDs) using advanced Large Language Models (LLMs) and Vision-Language Models (VLMs).

![IntelliSpec AI UI Preview](https://via.placeholder.com/1000x500.png?text=IntelliSpec+AI+Workspace)

---

## ✨ Key Features

* 📄 **SRS Auditing & Insights:** The built-in Reasoning Engine scans uploaded SRS PDFs to identify missing actors, vague user stories, and untestable requirements.
* 🤖 **AI-Driven Diagram Generation:** Type natural language prompts (e.g., *"Create a use case diagram for the library system"*) to instantly generate diagrams.
* 🎨 **Advanced JointJS Canvas:** Fully interactive canvas. Drag, drop, resize, zoom, pan, and snap-to-grid. 
* 📝 **Inline Properties Editing:** Click any shape to edit its text label, X/Y coordinates, and dimensions directly from a floating panel.
* 🕰️ **Project History Persistence:** Your previous diagrams are saved locally. Switch between past architectural iterations instantly.
* 🌗 **Dark Mode & Export:** Toggle beautiful UI themes and export your final architecture as high-res PNGs, scalable SVGs, or raw JSON.

---

## 🏗️ Architecture

The project operates on two decoupled environments:

1. **The Reasoning Backend (`/backend`) - Python & FastAPI**
   Uses powerful AI extraction (Marker-PDF/PyMuPDF) and NLP pipelines to ingest raw PDF documents, extract structured Actors and User Stories, and perform vector-based ambiguity detection (FAISS).
2. **The Frontend Workspace (`/src`) - React, Vite & JointJS**
   Provides a highly responsive graphical canvas. It combines user prompts with the backend's extracted context, querying Gemini/Groq APIs to return strict JointJS JSON arrays for rendering.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v18+ recommended)
* **Python** (3.10+ recommended, virtual environment highly advised)
* An active **Gemini API Key** (or Groq API key)

### 1. Setup the Frontend (Vite + React)
Clone the repository and install the frontend dependencies:
```bash
git clone https://github.com/iamnishaant/IntelliSpec-AI.git
cd IntelliSpec-AI

# Install Node dependencies
npm install

# Setup your environment variables
# Create a .env file in the root directory and add:
# VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Setup the Backend (FastAPI + Python)
Open a new terminal window to configure the Python reasoning engine:
```bash
cd backend

# Create and activate a virtual environment
python -m venv uml_venv

# On Windows:
..\uml_venv\Scripts\activate
# On Mac/Linux:
source ../uml_venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Run the System
You need to run both servers simultaneously.

**Terminal 1 (Backend):**
```bash
cd backend
..\uml_venv\Scripts\activate
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 (Frontend):**
```bash
npm run dev
```

Navigate to `http://localhost:5173` in your browser.

---

## 💡 How to Use IntelliSpec AI

1. **Select an SRS Document:** Use the dropdown at the bottom to select a pre-processed SRS file. (The "Insights" panel on the right will automatically audit the document).
2. **Generate Diagram:** In the bottom prompt bar, type a request like *"Generate a detailed Data Flow Diagram"*.
3. **Review AI Logic:** Watch the "Reasoning Terminal" overlay as the AI parses actors and synthesizes geometry.
4. **Edit Manually:** 
   - Drag shapes to rearrange them.
   - Click a shape to open the **Properties Panel** to rename or precisely resize it.
   - Use the **Toolbox** on the left to manually add new actors, use cases, or start/end nodes.
   - Connect shapes by dragging the blue handles.
5. **Export:** Use the top toolbar to download your final architecture as a PNG or SVG.

---

## 🛠️ Tech Stack
* **Frontend:** React, Vite, JointJS, Lucide-React
* **Backend:** FastAPI, Python, PyMuPDF, FAISS, Sentence-Transformers
* **AI Integration:** Google Gemini (v1beta), Groq (Llama 3.3)

---

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

*If you like this project, please consider giving it a ⭐ on GitHub!*
