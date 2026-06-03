import React, { useState, useCallback, useEffect } from 'react';
import JsonUploader from './components/JsonUploader';
import Canvas from './components/Canvas';
import { parseKBToGraph, splitHubNodes, checkAllIntentsAdded, IntentCheckResult, FlowNode, FlowEdge } from './components/parseKB';
import './App.css';

function App() {
  // Raw parsed graph (pre-split) — source of truth for intent check + search
  const [rawNodes, setRawNodes] = useState<FlowNode[]>([]);
  const [rawEdges, setRawEdges] = useState<FlowEdge[]>([]);
  // Rendered graph (post-split when toggle is on)
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);

  const [showUploader, setShowUploader] = useState(false);
  const [checkResult, setCheckResult] = useState<IntentCheckResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FlowNode[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Splitter toggle — defaults to ON
  const [splittersEnabled, setSplittersEnabled] = useState(true);

  // Re-derive the rendered graph whenever raw data or toggle changes
  useEffect(() => {
    if (rawNodes.length === 0) return;
    if (splittersEnabled) {
      const { nodes: sn, edges: se } = splitHubNodes(rawNodes, rawEdges, { threshold: 5, maxFanout: 3 });
      setNodes(sn);
      setEdges(se);
    } else {
      setNodes(rawNodes);
      setEdges(rawEdges);
    }
  }, [rawNodes, rawEdges, splittersEnabled]);

  const handleJsonLoaded = (data: any) => {
    try {
      const { nodes: newNodes, edges: newEdges } = parseKBToGraph(data);
      setRawNodes(newNodes);
      setRawEdges(newEdges);
      const result = checkAllIntentsAdded(data, newNodes);
      setCheckResult(result);
      setShowUploader(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      console.error(error);
      alert("Invalid JSON format");
    }
  };

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase();
    // Search only real intent nodes (not virtual splitters)
    const results = rawNodes.filter((node) => {
      const label = node.data.label?.toLowerCase() || '';
      const id = node.id?.toLowerCase() || '';
      return id.includes(query) || label.includes(query);
    });

    setSearchResults(results);
    setCurrentResultIndex(0);
  }, [searchQuery, rawNodes]);

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

        {checkResult && (
          <div className={`intent-check ${checkResult.allAdded ? 'all-added' : 'missing'}`}>
            {checkResult.allAdded ? (
              <span className="check-icon">✅</span>
            ) : (
              <span className="check-icon">⚠️</span>
            )}
            <span className="check-text">
              {checkResult.addedIntents}/{checkResult.totalIntents} intents added
              {!checkResult.allAdded && ` · ${checkResult.missingIntents.length} missing`}
            </span>
            {!checkResult.allAdded && (
              <span className="missing-ids" title={checkResult.missingIntents.join(', ')}>
                {checkResult.missingIntents.join(', ')}
              </span>
            )}
          </div>
        )}

        {rawNodes.length > 0 && (
          <button
            className={`splitter-toggle ${splittersEnabled ? 'on' : 'off'}`}
            onClick={() => setSplittersEnabled((v) => !v)}
            title="Split high-fanout hub nodes to reduce edge crossings"
          >
            Hub Split: {splittersEnabled ? 'On' : 'Off'}
          </button>
        )}

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
      </div>

      <div className="main-content">
        {rawNodes.length > 0 ? (
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