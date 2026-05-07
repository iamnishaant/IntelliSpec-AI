import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import { initShapes } from './joint-logic/customShapes';


import 'jointjs/dist/joint.css';

function App() {
  const [diagramData, setDiagramData] = useState(null);

  useEffect(() => {
    initShapes();
  }, []);

  const handleUpdateDiagram = (newJson) => {
    setDiagramData(newJson);
  };

  return (
    // min-h-screen ensures it fills the window using Tailwind
    <div className="min-h-screen w-full bg-gray-50">
      <Dashboard 
        diagramData={diagramData} 
        onUpdateDiagram={handleUpdateDiagram} 
      />
    </div>
  );
}

export default App;