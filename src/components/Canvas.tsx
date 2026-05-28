import React, { useEffect, useCallback } from "react";
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
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

import { FlowNode, FlowEdge } from "./parseKB";

interface CanvasProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
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

export default function Canvas({ initialNodes, initialEdges }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[]);

  useEffect(() => {
    const applyLayout = () => {
      // Changed from TB to LR (Left to Right) to match n8n
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(initialNodes, initialEdges, "LR");

      setNodes(layoutedNodes as Node[]);
      setEdges(layoutedEdges as Edge[]);
    };

    applyLayout();
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        // Adding dot background common in node editors
        minZoom={0.2}
      >
        <Background color="#ccc" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case "input":
                return "#61dafb";
              case "output":
                return "#ff6b6b";
              default:
                return "#c8e6c9";
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ background: "#f5f5f5" }}
        />
      </ReactFlow>
    </div>
  );
}
