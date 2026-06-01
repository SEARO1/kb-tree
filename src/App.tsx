import React, { useState, useCallback, useMemo } from 'react';
import JsonUploader from './components/JsonUploader';
import Canvas from './components/Canvas';
import { parseKBToGraph, checkAllIntentsAdded, FlowNode, FlowEdge } from './components/parseKB';
import './App.css';

function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [rawJson, setRawJson] = useState<any>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FlowNode[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  const handleJsonLoaded = (data: any) => {
    try {
      const { nodes: newNodes, edges: newEdges } = parseKBToGraph(data);
      setNodes(newNodes);
      setEdges(newEdges);
      setRawJson(data);
      setShowUploader(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      console.error(error);
      alert("Invalid JSON format");
    }
  };

  const intentCheckResult = useMemo(() => {
    if (!rawJson || nodes.length === 0) return null;
    return checkAllIntentsAdded(rawJson, nodes);
  }, [rawJson, nodes]);

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results = nodes.filter((node) => {
      const label = node.data.label?.toLowerCase() || '';
      const id = node.id?.toLowerCase() || '';
      return id.includes(query) || label.includes(query);
    });

    setSearchResults(results);
    setCurrentResultIndex(0);
  }, [searchQuery, nodes]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    } else if (e.key === 'F3' || (e.key === 'f' && e.ctrlKey)) {
      e.preventDefault();
      navigateResults('next');
    }
  };

  const navigateResults = (direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;

    if (direction === 'next') {
      setCurrentResultIndex((prev) =>
        prev < searchResults.length - 1 ? prev + 1 : 0
      );
    } else {
      setCurrentResultIndex((prev) =>
        prev > 0 ? prev - 1 : searchResults.length - 1
      );
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setCurrentResultIndex(0);
  };

  return (
    <div className="App">
      <div className="top-bar">
        <div className="app-header">
          <h1>Knowledge Base Visualizer</h1>
        </div>

        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder="Search by intent name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="search-btn" onClick={handleSearch}>Search</button>
          {searchResults.length > 0 && (
            <div className="search-results-nav">
              <button className="nav-btn" onClick={() => navigateResults('prev')}>▲</button>
              <span className="result-counter">
                {currentResultIndex + 1} / {searchResults.length}
              </span>
              <button className="nav-btn" onClick={() => navigateResults('next')}>▼</button>
            </div>
          )}
          {searchQuery && (
            <button className="clear-btn" onClick={clearSearch}>✕</button>
          )}
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

        {intentCheckResult && !intentCheckResult.allAdded && (
          <div className="missing-intents-bar">
            <span className="missing-intents-title">
              ⚠ Missing ({intentCheckResult.addedIntents}/{intentCheckResult.totalIntents}):
            </span>
            <div className="missing-intents-list">
              {intentCheckResult.missingIntents.slice(0, 20).map((id) => (
                <span key={id} className="missing-intent-tag">{id}</span>
              ))}
              {intentCheckResult.missingIntents.length > 20 && (
                <span className="missing-intent-more">
                  +{intentCheckResult.missingIntents.length - 20} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="main-content">
        {nodes.length > 0 ? (
          <div className="canvas-container">
            <Canvas
              initialNodes={nodes}
              initialEdges={edges}
              searchResults={searchResults}
              currentResultIndex={currentResultIndex}
            />
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