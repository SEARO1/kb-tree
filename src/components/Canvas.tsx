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

import { FlowNode, FlowEdge, GraphMetadata } from './parseKB';

type GraphViewMode = 'simplified' | 'detailed';

interface CanvasProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
  metadata?: GraphMetadata;
  viewMode?: GraphViewMode;
  searchResults?: FlowNode[];
  currentResultIndex?: number;
}

const elk = new ELK();

const NODE_WIDTH = 250;
const NODE_HEIGHT = 80;
const CLUSTER_WIDTH = 320;
const CLUSTER_HEIGHT = 110;

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
    children: nodes.map((n) => {
      const style = (n as any).style ?? {};
      const width = Number((n as any).width ?? style.width ?? NODE_WIDTH) || NODE_WIDTH;
      const height = Number((n as any).height ?? style.height ?? NODE_HEIGHT) || NODE_HEIGHT;
      return { ...n, width, height };
    }),
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
    console.error('ELK Layout Error:', error);
    return { nodes, edges };
  }
};

function buildSimplifiedGraph(
  initialNodes: FlowNode[],
  initialEdges: FlowEdge[],
  metadata: GraphMetadata,
  expandedSccIds: Set<string>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const sccMap = new Map(metadata.sccs.map((scc) => [scc.id, scc]));

  const nodesByScc = new Map<string, FlowNode[]>();
  for (const node of initialNodes) {
    const sccId = metadata.nodeToSccId[node.id] ?? node.data.sccId;
    if (!sccId) continue;
    const existing = nodesByScc.get(sccId) ?? [];
    existing.push(node);
    nodesByScc.set(sccId, existing);
  }

  const displayedNodes: FlowNode[] = [];
  const nodeIdMap = new Map<string, string>();

  for (const scc of metadata.sccs) {
    const members = nodesByScc.get(scc.id) ?? [];
    if (members.length === 0) continue;

    const anchor = { x: 0, y: 0 };
    const anchorCenterX = anchor.x + NODE_WIDTH / 2;
    const anchorCenterY = anchor.y + NODE_HEIGHT / 2;

    const isCollapsed = scc.isCyclic && !expandedSccIds.has(scc.id);
    if (isCollapsed) {
      const clusterNodeId = `scc:${scc.id}`;
      displayedNodes.push({
        id: clusterNodeId,
        position: {
          x: anchorCenterX - CLUSTER_WIDTH / 2,
          y: anchorCenterY - CLUSTER_HEIGHT / 2,
        },
        data: {
          label: `Cycle Cluster\n${scc.members.length} intents`,
          isCluster: true,
          sccId: scc.id,
          isCyclicScc: true,
          memberCount: scc.members.length,
        },
        type: 'default',
        style: {
          width: CLUSTER_WIDTH,
          height: CLUSTER_HEIGHT,
        } as any,
      });

      for (const member of members) {
        nodeIdMap.set(member.id, clusterNodeId);
      }
      continue;
    }

    if (members.length === 1) {
      const member = members[0];
      displayedNodes.push({
        ...member,
        position: { x: anchor.x, y: anchor.y },
      });
      nodeIdMap.set(member.id, member.id);
      continue;
    }

    const isCyclic = sccMap.get(scc.id)?.isCyclic ?? false;
    if (isCyclic) {
      const radius = Math.max(110, members.length * 18);
      members.forEach((member, index) => {
        const theta = (2 * Math.PI * index) / members.length;
        const x = anchorCenterX + Math.cos(theta) * radius - NODE_WIDTH / 2;
        const y = anchorCenterY + Math.sin(theta) * (radius * 0.7) - NODE_HEIGHT / 2;
        displayedNodes.push({
          ...member,
          position: { x, y },
        });
        nodeIdMap.set(member.id, member.id);
      });
      continue;
    }

    // Non-cyclic SCCs with multiple nodes (typically split in/out nodes)
    members.forEach((member, index) => {
      const x = anchor.x;
      const y = anchor.y + index * (NODE_HEIGHT + 26);
      displayedNodes.push({
        ...member,
        position: { x, y },
      });
      nodeIdMap.set(member.id, member.id);
    });
  }

  const visibleNodeIds = new Set(displayedNodes.map((node) => node.id));

  type EdgeAgg = {
    id: string;
    source: string;
    target: string;
    labels: Set<string>;
    methods: Set<string>;
    count: number;
    sourceSccId?: string;
    targetSccId?: string;
    edgeClass: 'intra-scc' | 'inter-scc' | 'cluster';
  };

  const clusteredEdgeMap = new Map<string, EdgeAgg>();
  const displayedEdges: FlowEdge[] = [];

  for (const edge of initialEdges) {
    const sourceMapped = nodeIdMap.get(edge.source) ?? edge.source;
    const targetMapped = nodeIdMap.get(edge.target) ?? edge.target;

    if (!visibleNodeIds.has(sourceMapped) || !visibleNodeIds.has(targetMapped)) continue;

    if (sourceMapped === targetMapped && sourceMapped.startsWith('scc:')) {
      continue;
    }

    const hasClusterEndpoint = sourceMapped.startsWith('scc:') || targetMapped.startsWith('scc:');
    if (!hasClusterEndpoint) {
      displayedEdges.push({
        ...edge,
        id: `${edge.id}__${sourceMapped}__${targetMapped}`,
        source: sourceMapped,
        target: targetMapped,
      });
      continue;
    }

    const sourceSccId = metadata.nodeToSccId[edge.source] ?? edge.data?.sourceSccId;
    const targetSccId = metadata.nodeToSccId[edge.target] ?? edge.data?.targetSccId;
    const edgeClass = sourceSccId && targetSccId && sourceSccId === targetSccId ? 'intra-scc' : 'cluster';
    const key = `${sourceMapped}->${targetMapped}|${edgeClass}`;

    let agg = clusteredEdgeMap.get(key);
    if (!agg) {
      agg = {
        id: `agg:${key}`,
        source: sourceMapped,
        target: targetMapped,
        labels: new Set(),
        methods: new Set(),
        count: 0,
        sourceSccId,
        targetSccId,
        edgeClass,
      };
      clusteredEdgeMap.set(key, agg);
    }

    if (edge.label) agg.labels.add(edge.label);
    for (const method of edge.data?.methods ?? []) {
      agg.methods.add(method);
    }
    agg.count += 1;
  }

  for (const agg of clusteredEdgeMap.values()) {
    const labels = [...agg.labels];
    displayedEdges.push({
      id: agg.id,
      source: agg.source,
      target: agg.target,
      type: 'straight',
      animated: false,
      label: labels.length > 0 ? `${Math.min(labels.length, 3)} labels · ${agg.count} links` : `${agg.count} links`,
      style: {
        stroke: '#64748b',
        strokeWidth: 2,
        opacity: 0.8,
        strokeDasharray: '6 4',
      },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      labelStyle: { fill: '#334155', fontWeight: 700 },
      className: agg.edgeClass,
      data: {
        edgeClass: agg.edgeClass,
        methods: [...agg.methods],
        sourceSccId: agg.sourceSccId,
        targetSccId: agg.targetSccId,
      },
    });
  }

  return { nodes: displayedNodes, edges: displayedEdges };
}

async function getClusterLayoutedElements(
  initialNodes: FlowNode[],
  initialEdges: FlowEdge[],
  metadata: GraphMetadata,
  expandedSccIds: Set<string>,
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  const anchorNodes: FlowNode[] = metadata.sccs.map((scc) => {
    const isCollapsed = scc.isCyclic && !expandedSccIds.has(scc.id);
    const width = isCollapsed ? CLUSTER_WIDTH : NODE_WIDTH;
    const height = isCollapsed ? CLUSTER_HEIGHT : NODE_HEIGHT;
    return {
      id: `anchor:${scc.id}`,
      position: { x: 0, y: 0 },
      data: { label: scc.id },
      style: { width, height } as any,
    };
  });

  const anchorEdges: FlowEdge[] = metadata.condensedEdges.map((edge) => ({
    id: `anchor-edge:${edge.id}`,
    source: `anchor:${edge.sourceSccId}`,
    target: `anchor:${edge.targetSccId}`,
    type: 'straight',
  }));

  const { nodes: layoutedAnchors } = await getLayoutedElements(anchorNodes, anchorEdges, 'TB');
  const anchorPositionByScc = new Map<string, { x: number; y: number }>();
  for (const anchor of layoutedAnchors) {
    anchorPositionByScc.set(anchor.id.replace('anchor:', ''), anchor.position);
  }

  const stagedNodes = initialNodes.map((node) => ({
    ...node,
    position: node.position,
  }));

  const metadataWithAnchors: GraphMetadata = {
    ...metadata,
    sccs: metadata.sccs,
  };

  const base = buildSimplifiedGraph(stagedNodes, initialEdges, metadataWithAnchors, expandedSccIds);

  const nodesById = new Map(base.nodes.map((node) => [node.id, node]));

  for (const scc of metadata.sccs) {
    const anchorPos = anchorPositionByScc.get(scc.id);
    if (!anchorPos) continue;

    const clusterNode = nodesById.get(`scc:${scc.id}`);
    if (clusterNode) {
      clusterNode.position = {
        x: anchorPos.x + NODE_WIDTH / 2 - CLUSTER_WIDTH / 2,
        y: anchorPos.y + NODE_HEIGHT / 2 - CLUSTER_HEIGHT / 2,
      };
      continue;
    }

    const sccNodeIds = base.nodes
      .filter((node) => {
        const nodeSccId = metadata.nodeToSccId[node.id] ?? node.data?.sccId;
        return nodeSccId === scc.id;
      })
      .map((node) => node.id);

    if (sccNodeIds.length === 0) continue;

    if (sccNodeIds.length === 1) {
      const node = nodesById.get(sccNodeIds[0]);
      if (!node) continue;
      node.position = { x: anchorPos.x, y: anchorPos.y };
      continue;
    }

    const centerX = anchorPos.x + NODE_WIDTH / 2;
    const centerY = anchorPos.y + NODE_HEIGHT / 2;
    const radius = Math.max(110, sccNodeIds.length * 18);

    sccNodeIds.forEach((nodeId, index) => {
      const node = nodesById.get(nodeId);
      if (!node) return;

      if (!scc.isCyclic) {
        node.position = {
          x: anchorPos.x,
          y: anchorPos.y + index * (NODE_HEIGHT + 26),
        };
        return;
      }

      const theta = (2 * Math.PI * index) / sccNodeIds.length;
      node.position = {
        x: centerX + Math.cos(theta) * radius - NODE_WIDTH / 2,
        y: centerY + Math.sin(theta) * (radius * 0.7) - NODE_HEIGHT / 2,
      };
    });
  }

  return base;
}

function CanvasInner({
  initialNodes,
  initialEdges,
  metadata,
  viewMode = 'simplified',
  searchResults = [],
  currentResultIndex = 0,
}: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { setCenter, getNode } = useReactFlow();

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandedSccIds, setExpandedSccIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedSccIds(new Set());
    setSelectedEdgeId(null);
  }, [initialNodes, initialEdges, viewMode]);

  const resolveVisibleNodeId = useCallback(
    (nodeId: string): string => {
      if (viewMode !== 'simplified' || !metadata) return nodeId;

      const sccId = metadata.nodeToSccId[nodeId] ?? initialNodes.find((node) => node.id === nodeId)?.data?.sccId;
      if (!sccId) return nodeId;
      const scc = metadata.sccs.find((item) => item.id === sccId);
      if (!scc?.isCyclic || expandedSccIds.has(sccId)) return nodeId;
      return `scc:${sccId}`;
    },
    [viewMode, metadata, initialNodes, expandedSccIds],
  );

  const currentSearchNode = searchResults[currentResultIndex];

  useEffect(() => {
    const applyLayout = async () => {
      if (viewMode === 'simplified' && metadata) {
        const { nodes: layoutedNodes, edges: layoutedEdges } = await getClusterLayoutedElements(
          initialNodes,
          initialEdges,
          metadata,
          expandedSccIds,
        );
        setNodes(layoutedNodes as Node[]);
        setEdges(layoutedEdges as Edge[]);
        return;
      }

      const { nodes: layoutedNodes, edges: layoutedEdges } = await getLayoutedElements(initialNodes, initialEdges, 'TB');
      setNodes(layoutedNodes as Node[]);
      setEdges(layoutedEdges as Edge[]);
    };

    applyLayout();
  }, [initialNodes, initialEdges, metadata, viewMode, expandedSccIds, setNodes, setEdges]);

  useEffect(() => {
    if (!currentSearchNode) return;
    const visibleNodeId = resolveVisibleNodeId(currentSearchNode.id);
    const node = getNode(visibleNodeId);
    if (!node) return;
    setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
      duration: 500,
      zoom: 1.45,
    });
  }, [currentSearchNode, resolveVisibleNodeId, setCenter, getNode]);

  const highlightedNodeIds = useMemo(() => {
    return new Set(searchResults.map((node) => resolveVisibleNodeId(node.id)));
  }, [searchResults, resolveVisibleNodeId]);

  const firstIntentNodeId = useMemo(() => {
    const firstRawNode = initialNodes.find((node) => node.data?.isFirstIntent);
    if (!firstRawNode) return null;
    return resolveVisibleNodeId(firstRawNode.id);
  }, [initialNodes, resolveVisibleNodeId]);

  const clickHighlightedNodeIds = useMemo(() => {
    if (selectedEdgeId) {
      const edge = edges.find((item) => item.id === selectedEdgeId);
      if (edge) return new Set([edge.source, edge.target]);
      return new Set<string>();
    }
    return null;
  }, [selectedEdgeId, edges]);

  const clickHighlightedEdgeIds = useMemo(() => {
    if (selectedEdgeId) {
      return new Set([selectedEdgeId]);
    }
    return null;
  }, [selectedEdgeId]);

  const handleEdgeClick = useCallback((_evt: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  const handleNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      const data = node.data as FlowNode['data'] | undefined;

      if (viewMode === 'simplified' && data?.isCluster && data.sccId) {
        setExpandedSccIds((prev) => {
          const next = new Set(prev);
          if (next.has(data.sccId!)) next.delete(data.sccId!);
          else next.add(data.sccId!);
          return next;
        });
        return;
      }

      if (!data?.splitPairId || !data.splitRole) return;
      const counterpartRole = data.splitRole === 'in' ? 'out' : 'in';
      const counterpartId = `${data.splitPairId}__${counterpartRole}`;
      const counterpart = getNode(counterpartId);
      if (!counterpart) return;

      setCenter(counterpart.position.x + NODE_WIDTH / 2, counterpart.position.y + NODE_HEIGHT / 2, {
        duration: 400,
        zoom: 1.4,
      });
    },
    [viewMode, getNode, setCenter],
  );

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
        nodes={nodes.map((node) => {
          const isSearchHit = highlightedNodeIds.has(node.id);
          const isClickHighlighted = clickActive && clickHighlightedNodeIds!.has(node.id);
          const isFirstIntent = node.id === firstIntentNodeId;
          const isClusterNode = Boolean((node.data as FlowNode['data'] | undefined)?.isCluster);
          const baseStyle = (node.style ?? {}) as React.CSSProperties;

          if (isClickHighlighted) {
            return {
              ...node,
              style: {
                ...baseStyle,
                background: '#cffafe',
                border: isSearchHit ? '2px solid #0e7490' : '2px solid #06b6d4',
                borderRadius: '8px',
                boxShadow: '0 0 0 4px rgba(6, 182, 212, 0.25)',
                zIndex: 10,
              },
            };
          }

          if (clickActive) {
            return {
              ...node,
              style: { ...baseStyle, opacity: 0.15 },
            };
          }

          if (isClusterNode) {
            return {
              ...node,
              style: {
                ...baseStyle,
                background: '#ecfeff',
                border: isSearchHit ? '2px solid #0891b2' : '2px solid #06b6d4',
                borderRadius: '12px',
                boxShadow: '0 0 0 4px rgba(6, 182, 212, 0.16)',
                zIndex: isSearchHit ? 11 : 8,
              },
            };
          }

          if (isSearchHit) {
            return {
              ...node,
              style: {
                ...baseStyle,
                background: '#fef08a',
                border: '2px solid #eab308',
                borderRadius: '6px',
                zIndex: 10,
              },
            };
          }

          if (isFirstIntent) {
            return {
              ...node,
              style: {
                ...baseStyle,
                background: '#fef3c7',
                border: '2px solid #f59e0b',
                borderRadius: '6px',
                boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.25)',
                zIndex: 10,
              },
            };
          }

          return node;
        })}
        edges={edges.map((edge) => {
          const baseStyle = (edge.style ?? {}) as React.CSSProperties;
          const edgeClass = (edge.data as FlowEdge['data'] | undefined)?.edgeClass;
          const isIntra = edgeClass === 'intra-scc';

          if (clickActive) {
            const isClickHighlighted = clickHighlightedEdgeIds!.has(edge.id);
            if (isClickHighlighted) {
              return {
                ...edge,
                style: { ...baseStyle, strokeWidth: 3, opacity: 1 },
                zIndex: 5,
                animated: false,
              } as Edge;
            }
            return {
              ...edge,
              style: { ...baseStyle, opacity: 0.1 },
            } as Edge;
          }

          if (!isIntra) return edge;
          return {
            ...edge,
            style: {
              ...baseStyle,
              opacity: (baseStyle.opacity as number | undefined) ?? 0.55,
              strokeDasharray: (baseStyle.strokeDasharray as string | undefined) ?? '5 3',
            },
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
            if (node.id === resolveVisibleNodeId(currentSearchNode?.id ?? '')) return '#eab308';
            if (clickActive && clickHighlightedNodeIds!.has(node.id)) return '#06b6d4';
            if ((node as any).data?.isCluster) return '#22d3ee';
            return highlightedNodeIds.has(node.id) ? '#fef08a' : '#c8e6c9';
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
