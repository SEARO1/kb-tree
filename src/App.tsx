import React, { useState } from 'react';
import JsonUploader from './components/JsonUploader';
import Canvas from './components/Canvas'; // Import it here
import { parseKBToGraph, FlowNode, FlowEdge } from './components/parseKB';

function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);

  const handleJsonLoaded = (data: any) => {
    try {
      const { nodes: newNodes, edges: newEdges } = parseKBToGraph(data);
      setNodes(newNodes);
      setEdges(newEdges);
    } catch (error) {
      console.error(error);
      alert("Invalid JSON format");
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', margin: '20px' }}>
      <h1>Knowledge Base Visualizer</h1>
      <JsonUploader onJsonLoaded={handleJsonLoaded} />

      {/* Render the Canvas only when nodes exist */}
      {nodes.length > 0 ? (
        <Canvas initialNodes={nodes} initialEdges={edges} />
      ) : (
        <p>Please upload a JSON file to see the KB Tree.</p>
      )}
    </div>
  );
}

export default App;