import React, { useState } from 'react';
import JsonUploader from './components/JsonUploader';
import Canvas from './components/Canvas';
import { parseKBToGraph, FlowNode, FlowEdge } from './components/parseKB';
import './App.css';

function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [showUploader, setShowUploader] = useState(false);

  const handleJsonLoaded = (data: any) => {
    try {
      const { nodes: newNodes, edges: newEdges } = parseKBToGraph(data);
      setNodes(newNodes);
      setEdges(newEdges);
      setShowUploader(false);
    } catch (error) {
      console.error(error);
      alert("Invalid JSON format");
    }
  };

  return (
    <div className="App">
      <div className="top-bar">
        <div className="app-header">
          <h1>Knowledge Base Visualizer</h1>
        </div>

        <button
          className="upload-toggle"
          onClick={() => setShowUploader(!showUploader)}
        >
          {showUploader ? '▼ Hide Loader' : '▲ Load JSON'}
        </button>

        {showUploader && (
          <div className="uploader-popup">
            <JsonUploader onJsonLoaded={handleJsonLoaded} />
          </div>
        )}
      </div>

      <div className="main-content">
        {nodes.length > 0 ? (
          <div className="canvas-container">
            <Canvas initialNodes={nodes} initialEdges={edges} />
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📂</div>
            <h3>No Knowledge Base Loaded</h3>
            <p>Click "Load JSON" above to upload a file</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;