import React, { useState, useCallback, useEffect } from 'react';
import JsonUploader from './components/JsonUploader';
import Canvas from './components/Canvas';
import { parseKBToGraph, checkAllIntentsAdded, IntentCheckResult, FlowNode, FlowEdge } from './components/parseKB';
import './App.css';

function App() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [rawJson, setRawJson] = useState<any>(null);
  const [checkResult, setCheckResult] = useState<IntentCheckResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FlowNode[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [splitInboundOutbound, setSplitInboundOutbound] = useState(true);
  const [separateMultiNode, setSeparateMultiNode] = useState(true);
  const [makeAcyclic, setMakeAcyclic] = useState(true);

  const runParse = useCallback((data: any) => {
    const { nodes: newNodes, edges: newEdges } = parseKBToGraph(data, {
      splitInboundOutbound,
      separateMultiNode,
      makeAcyclic,
    });
    setNodes(newNodes);
    setEdges(newEdges);
    const result = checkAllIntentsAdded(data, newNodes);
    setCheckResult(result);
  }, [splitInboundOutbound, separateMultiNode, makeAcyclic]);

  const handleJsonLoaded = (data: any) => {
    try {
      setRawJson(data);
      runParse(data);
      setShowUploader(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch (error) {
      console.error(error);
      alert("Invalid JSON format");
    }
  };

  useEffect(() => {
    if (!rawJson) return;
    runParse(rawJson);
    setSearchResults([]);
    setCurrentResultIndex(0);
  }, [rawJson, runParse]);

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

        <div className="parser-options" title="KB parse workflow options">
          <label className="option-item">
            <input
              type="checkbox"
              checked={splitInboundOutbound}
              onChange={(e) => setSplitInboundOutbound(e.target.checked)}
            />
            <span>Split in/outbound node</span>
          </label>
          <label className="option-item">
            <input
              type="checkbox"
              checked={separateMultiNode}
              onChange={(e) => setSeparateMultiNode(e.target.checked)}
            />
            <span>Separate multi node</span>
          </label>
          <label className="option-item">
            <input
              type="checkbox"
              checked={makeAcyclic}
              onChange={(e) => setMakeAcyclic(e.target.checked)}
            />
            <span>Cyclic to acyclic</span>
          </label>
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
