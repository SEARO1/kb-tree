import React, { useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  MiniMap,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import { FlowNode, FlowEdge } from "./parseKB";

interface CanvasProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
  searchResults?: FlowNode[];
  currentResultIndex?: number;
}

// n8n generally uses a Left-to-Right layout with wider nodes
const nodeWidth = 250;
const nodeHeight = 80;

const getLayoutedElements = (
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction = "LR",
) => {
  const isHorizontal = direction === "LR";
  const localDagreGraph = new dagre.graphlib.Graph();
  localDagreGraph.setDefaultEdgeLabel(() => ({}));
  localDagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 50 });

  nodes.forEach((node) => {
    localDagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    localDagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(localDagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = localDagreGraph.node(node.id);

    // We are shifting the dagre node position (anchor=center center) to the top left
    // so it matches React Flow's node anchor point
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
      // Ensure target and source positions fit the horizontal layout
      targetPosition: isHorizontal ? "left" : "top",
      sourcePosition: isHorizontal ? "right" : "bottom",
    };
  });

  // Apply smoothstep styling for edges
  const layoutedEdges = edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: edge.style?.stroke ?? "#b1b1b7",
    },
  }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
};

export default function Canvas({ initialNodes, initialEdges, searchResults = [], currentResultIndex = 0 }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        searchResults={searchResults}
        currentResultIndex={currentResultIndex}
      />
    </ReactFlowProvider>
  );
}

function CanvasInner({ initialNodes, initialEdges, searchResults = [], currentResultIndex = 0 }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[]);
  const { setCenter, getNode } = useReactFlow();

  const currentSearchNode = searchResults[currentResultIndex];

  const highlightedNodeIds = useMemo(() => {
    return new Set(searchResults.map(n => n.id));
  }, [searchResults]);

  useEffect(() => {
    const applyLayout = () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(initialNodes, initialEdges, "LR");

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

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
          },
          eds,
        ),
      ),
    [setEdges],
  );

  return (
    <div style={{ width: "100%", height: "100vh" }}>
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
        minZoom={0.2}
      >
        <Background color="#ccc" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id === currentSearchNode?.id) return '#eab308';
            switch (node.type) {
              case "input":
                return "#61dafb";
              case "output":
                return "#ff6b6b";
              default:
                return highlightedNodeIds.has(node.id) ? '#fef08a' : "#c8e6c9";
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ background: "#f5f5f5" }}
        />
      </ReactFlow>
    </div>
  );
}
