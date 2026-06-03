import { useEffect, useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  getNodesBounds,
} from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import '@xyflow/react/dist/style.css';

import { FlowNode, FlowEdge } from './parseKB';

interface CanvasProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
  searchResults?: FlowNode[];
  currentResultIndex?: number;
}

const elk = new ELK();

const getLayoutedElements = async (nodes: FlowNode[], edges: FlowEdge[], dir = 'TB') => {
  const isHorizontal = dir === 'LR';

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': isHorizontal ? 'RIGHT' : 'DOWN',
      // Increased spacing to reduce visual clutter between nodes
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '200',
      // ORTHOGONAL routing avoids edge overlaps better than POLYLINE
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // Reduce crossings by allowing more aggressive node reordering
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
      // Compact layout horizontally and reduce unnecessary whitespace
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'elk.separateConnectedComponents': 'false',
    },
    children: nodes.map((n) => ({ ...n, width: 250, height: 80 })),
    edges: edges.map((e) => ({ ...e, id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const layoutedGraph = await elk.layout(graph);

    const layoutedNodes = nodes.map((node) => {
      const layoutNode = layoutedGraph.children?.find((n) => n.id === node.id);
      return {
        ...node,
        position: {
          x: layoutNode?.x || 0,
          y: layoutNode?.y || 0,
        },
      };
    });

    return { nodes: layoutedNodes, edges };
  } catch (error) {
    console.error("ELK Layout Error:", error);
    return { nodes, edges };
  }
};

function CanvasInner({ initialNodes, initialEdges, searchResults = [], currentResultIndex = 0 }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { setCenter, getNode, fitBounds } = useReactFlow();

  // Click-to-highlight selection (edge only).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Splitter focus: when user clicks a virtual splitter node, pan/zoom to
  // show all siblings of that hub.
  const [splitterFocusHubId, setSplitterFocusHubId] = useState<string | null>(null);

  const currentSearchNode = searchResults[currentResultIndex];

  useEffect(() => {
    const applyLayout = async () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = await getLayoutedElements(
        initialNodes,
        initialEdges,
        'TB'
      );

      setNodes(layoutedNodes as Node[]);
      setEdges(layoutedEdges as Edge[]);
    };

    applyLayout();
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Center on the current search result node
  useEffect(() => {
    if (currentSearchNode) {
      const node = getNode(currentSearchNode.id);
      if (node) {
        setCenter(node.position.x + 125, node.position.y + 40, { duration: 500, zoom: 1.5 });
      }
    }
  }, [currentSearchNode, setCenter, getNode]);

  // Pan/zoom to fit all splitter siblings when a splitter is clicked.
  useEffect(() => {
    if (!splitterFocusHubId) return;
    const siblingNodes = nodes.filter(
      (n) => (n.data as any)?.parentHubId === splitterFocusHubId || n.id === splitterFocusHubId,
    );
    if (siblingNodes.length === 0) return;
    const bounds = getNodesBounds(siblingNodes as Node[]);
    fitBounds(
      { x: bounds.x - 60, y: bounds.y - 60, width: bounds.width + 120, height: bounds.height + 120 },
      { duration: 400 },
    );
  }, [splitterFocusHubId, nodes, fitBounds]);

  const highlightedNodeIds = useMemo(() => {
    return new Set(searchResults.map(n => n.id));
  }, [searchResults]);

  // The "first intent" (entry point of the flow) — the node that gets
  // the ▶ arrow marker. Used to apply the entry-point visual style and
  // to color it distinctly in the MiniMap.
  const firstIntentNodeId = useMemo(() => {
    return initialNodes.find(n => n.data?.isFirstIntent)?.id ?? null;
  }, [initialNodes]);

  // Compute the highlighted-node set for the current click selection
  // (edge-only: just the two endpoints of the selected edge).
  const clickHighlightedNodeIds = useMemo(() => {
    if (selectedEdgeId) {
      const edge = edges.find((e) => e.id === selectedEdgeId);
      if (edge) return new Set([edge.source, edge.target]);
      return new Set<string>();
    }
    return null; // null = no click selection active
  }, [selectedEdgeId, edges]);

  // Edges to keep visible/emphasized: the single selected edge.
  const clickHighlightedEdgeIds = useMemo(() => {
    if (selectedEdgeId) {
      return new Set([selectedEdgeId]);
    }
    return null;
  }, [selectedEdgeId]);

  // Toggle helper — clicking the same edge twice clears the selection.
  const handleEdgeClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
  }, []);

  const handlePaneClick = useCallback(() => {
    // Clicking on empty canvas clears the selection.
    setSelectedEdgeId(null);
    setSplitterFocusHubId(null);
  }, []);

  // Node-click: when a virtual splitter is clicked, pan to show all its
  // siblings. Clicking the same hub again clears the focus.
  const handleNodeClick = useCallback((_evt: React.MouseEvent, node: Node) => {
    const nodeData = node.data as FlowNode['data'];
    if (nodeData?.isVirtual && nodeData?.parentHubId) {
      setSplitterFocusHubId((prev) => (prev === nodeData.parentHubId ? null : nodeData.parentHubId!));
    } else {
      setSplitterFocusHubId(null);
    }
  }, []);

  // Whether click-highlight is currently active.
  const clickActive = clickHighlightedNodeIds !== null;

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds)),
    [setEdges],
  );

  const handleMiniMapClick = useCallback(
    (_event: React.MouseEvent, position: { x: number; y: number }) => {
      setCenter(position.x, position.y, { duration: 200 });
    },
    [setCenter],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes.map(node => {
            const nodeData = node.data as FlowNode['data'];
            const isSearchHit = highlightedNodeIds.has(node.id);
            const isClickHighlighted = clickActive && clickHighlightedNodeIds!.has(node.id);
            const isFirstIntent = node.id === firstIntentNodeId;
            const isVirtual = nodeData?.isVirtual === true;
            const parentHubId = nodeData?.parentHubId;
            const isFocusedSplitter = splitterFocusHubId !== null && parentHubId === splitterFocusHubId;
            const baseStyle = (node.style ?? {}) as React.CSSProperties;

            if (isClickHighlighted) {
              // Edge-selection active and this node is an endpoint → cyan highlight.
              return {
                ...node,
                style: {
                  ...baseStyle,
                  background: '#cffafe',
                  border: isSearchHit ? '2px solid #0e7490' : '2px solid #06b6d4',
                  borderRadius: '4px',
                  boxShadow: '0 0 0 4px rgba(6, 182, 212, 0.25)',
                  zIndex: 10,
                },
              };
            }

            if (clickActive) {
              // Edge-selection active but this node is NOT part of the selection
              // — make it transparent (keep visible as a ghost).
              return {
                ...node,
                style: { ...baseStyle, opacity: 0.15 },
              };
            }

            if (isSearchHit) {
              return {
                ...node,
                style: {
                  ...baseStyle,
                  background: '#fef08a',
                  border: '2px solid #eab308',
                  borderRadius: '4px',
                  zIndex: 10,
                },
              };
            }

            if (isFirstIntent) {
              // First-intent (entry-point) treatment: gold background, amber
              // border, soft glow, and the ▶ arrow prefix in the label.
              return {
                ...node,
                style: {
                  ...baseStyle,
                  background: '#fef3c7',
                  border: '2px solid #f59e0b',
                  borderRadius: '4px',
                  boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.25)',
                  zIndex: 10,
                },
              };
            }

            if (isVirtual) {
              // Splitter node — dashed border, light gray background.
              // If it's part of the currently-focused hub, use a stronger cyan dashed border.
              const splitterBorder = isFocusedSplitter
                ? '2px dashed #06b6d4'
                : '2px dashed #9ca3af';
              const splitterShadow = isFocusedSplitter
                ? '0 0 0 3px rgba(6, 182, 212, 0.2)'
                : 'none';
              return {
                ...node,
                style: {
                  ...baseStyle,
                  background: isFocusedSplitter ? '#e0f7fa' : '#f3f4f6',
                  border: splitterBorder,
                  borderRadius: '4px',
                  boxShadow: splitterShadow,
                  opacity: 0.85,
                  fontStyle: 'italic',
                  fontSize: '11px',
                  zIndex: isFocusedSplitter ? 10 : 1,
                },
              };
            }

            return node;
          })}
        edges={edges.map(edge => {
            const isBridge = (edge.data as any)?.isSplitterBridge || (edge as any).isSplitterBridge;

            if (!clickActive) {
              // When no click selection: dim bridge edges slightly so real edges stand out
              if (isBridge) {
                const baseStyle = (edge.style ?? {}) as React.CSSProperties;
                return { ...edge, style: { ...baseStyle, opacity: 0.4 } } as Edge;
              }
              return edge;
            }

            const isClickHighlighted = clickHighlightedEdgeIds!.has(edge.id);
            const baseStyle = (edge.style ?? {}) as React.CSSProperties;

            if (isClickHighlighted) {
              // Keep original method color, bump width, no animation.
              return {
                ...edge,
                style: { ...baseStyle, strokeWidth: 3, opacity: 1 },
                zIndex: 5,
                animated: false,
              } as Edge;
            }

            // Selection active but this edge is NOT the selected one —
            // make it transparent.
            return {
              ...edge,
              style: { ...baseStyle, opacity: 0.1 },
            } as Edge;
          })}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={handleEdgeClick}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
      >
        <Background gap={20} color="#e0e0e0" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          onClick={handleMiniMapClick}
          nodeColor={(node) => {
            if (node.id === firstIntentNodeId) return '#f59e0b';
            if (node.id === currentSearchNode?.id) return '#eab308';
            if (clickActive && clickHighlightedNodeIds!.has(node.id)) return '#06b6d4';
            const nd = node.data as FlowNode['data'];
            if (nd?.isVirtual) {
              return nd?.parentHubId === splitterFocusHubId ? '#06b6d4' : '#9ca3af';
            }
            switch (node.type) {
              case 'input': return '#61dafb';
              case 'output': return '#ff6b6b';
              default: return highlightedNodeIds.has(node.id) ? '#fef08a' : '#c8e6c9';
            }
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ background: '#f5f5f5' }}
        />
      </ReactFlow>
    </div>
  );
}

export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}