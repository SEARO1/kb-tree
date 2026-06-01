import { useEffect, useCallback, useMemo } from 'react';
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

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds: Edge[]) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes.map(node => ({
          ...node,
          style: highlightedNodeIds.has(node.id)
            ? {
                background: '#fef08a',
                border: '2px solid #eab308',
                borderRadius: '4px',
                zIndex: 10,
              }
            : {},
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
      >
        <Background gap={20} color="#e0e0e0" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            if (node.id === currentSearchNode?.id) return '#eab308';
            switch (node.type) {
              case 'input': return '#61dafb';
              case 'output': return '#ff6b6b';
              default: return highlightedNodeIds.has(node.id) ? '#fef08a' : '#c8e6c9';
            }
          }}
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