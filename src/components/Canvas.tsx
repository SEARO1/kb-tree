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
      'elk.spacing.nodeNode': '100',
      'elk.layered.spacing.nodeNodeBetweenLayers': '150',
      'elk.edgeRouting': 'POLYLINE',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
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
  const { setCenter, getNode } = useReactFlow();

  // Click-to-highlight selection (edge only).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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

  const highlightedNodeIds = useMemo(() => {
    return new Set(searchResults.map(n => n.id));
  }, [searchResults]);

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
  }, []);

  // Whether click-highlight is currently active.
  const clickActive = clickHighlightedNodeIds !== null;

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes
          // When an edge is selected, hide any node that is not part of the
          // selection — show only the two endpoint nodes and the edge.
          .filter(node => !clickActive || clickHighlightedNodeIds!.has(node.id))
          .map(node => {
            const isSearchHit = highlightedNodeIds.has(node.id);

            if (clickActive) {
              // Edge-selection active → cyan highlight on the two endpoints.
              return {
                ...node,
                style: {
                  background: '#cffafe',
                  border: isSearchHit ? '2px solid #0e7490' : '2px solid #06b6d4',
                  borderRadius: '4px',
                  boxShadow: '0 0 0 4px rgba(6, 182, 212, 0.25)',
                  zIndex: 10,
                },
              };
            }

            if (isSearchHit) {
              return {
                ...node,
                style: {
                  background: '#fef08a',
                  border: '2px solid #eab308',
                  borderRadius: '4px',
                  zIndex: 10,
                },
              };
            }

            return node;
          })}
        edges={edges
          // When an edge is selected, hide every edge except the selected one.
          .filter(edge => !clickActive || clickHighlightedEdgeIds!.has(edge.id))
          .map(edge => {
            if (!clickActive) return edge;
            // Keep original method color, bump width, no animation.
            const baseStyle = (edge.style ?? {}) as React.CSSProperties;
            return {
              ...edge,
              style: { ...baseStyle, strokeWidth: 3, opacity: 1 },
              zIndex: 5,
              animated: false,
            } as Edge;
          })}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
      >
        <Background gap={20} color="#e0e0e0" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            if (node.id === currentSearchNode?.id) return '#eab308';
            if (clickActive && clickHighlightedNodeIds!.has(node.id)) return '#06b6d4';
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