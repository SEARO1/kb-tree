// ─── React Flow types ────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: {
    label: string;
    rawData?: any;
    isFirstIntent?: boolean;
    splitRole?: 'in' | 'out';
    splitPairId?: string;
    baseIntentId?: string;
    sccId?: string;
    sccSize?: number;
    isCyclicScc?: boolean;
    isCluster?: boolean;
    memberCount?: number;
  };
  type?: string;
  style?: any;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  label?: string;
  style?: any;         // Add this line to allow custom line colors
  labelBgStyle?: any;  // Add this line to allow label background styling
  labelStyle?: any;    // Add this line to allow label text styling
  data?: {
    edgeClass?: 'intra-scc' | 'inter-scc' | 'cluster';
    methods?: string[];
    sourceSccId?: string;
    targetSccId?: string;
    isBackEdge?: boolean;
  };
  className?: string;
}

export interface SCCComponent {
  id: string;
  members: string[];
  isCyclic: boolean;
}

export interface CondensedEdge {
  id: string;
  sourceSccId: string;
  targetSccId: string;
  transitionCount: number;
}

export interface GraphMetadata {
  intentToSccId: Record<string, string>;
  nodeToSccId: Record<string, string>;
  sccs: SCCComponent[];
  condensedEdges: CondensedEdge[];
}

export interface ParseKBResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  metadata: GraphMetadata;
}

// ─── Types matching the KB JSON shape ────────────────────────────────────────

interface KBVersion {
  version: string;
  name: string;
  [key: string]: any;
}

interface KBIntent {
  intentId: string;
  parentId: string | null;
  intentName: string;
  intentType?: string;
  sortOrder?: number;
  [key: string]: any;
}

interface KBDtmfOption {
  dtmfPattern?: string;
  dtmfIntent?: string;
}

interface KBActionPayload {
  dtmfType?: string;
  dtmfOptions?: KBDtmfOption[];
  dtmfIntentId?: string;
  nohIntent?: string;
  followUpIntent?: string;
  redirectIntent?: string;
  procId?: string;
  args?: string;
  [key: string]: any;
}

interface KBAction {
  actionId: string;
  intentId: string;
  type: string;
  platform?: string;
  lang?: string;
  payload: KBActionPayload | string | null;
  sortOrder?: number;
  [key: string]: any;
}

interface KBJson {
  version?: KBVersion;
  intents?: KBIntent[];
  actions?: KBAction[];
  [key: string]: any;
}

// ─── Layout constants ────────────────────────────────────────────────────────

const NODE_WIDTH  = 240;
const NODE_HEIGHT = 70;
const H_GAP       = 80;
const V_GAP       = 100;

// ─── Main entry point ────────────────────────────────────────────────────────

export function parseKBToGraph(rawJson: any): ParseKBResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const kb = rawJson as KBJson;

  const hasIntents =
    kb.intents && Array.isArray(kb.intents) && kb.intents.length > 0 && 'intentId' in kb.intents[0];
  const hasActions = kb.actions && Array.isArray(kb.actions) && kb.actions.length > 0;

  if (hasIntents && hasActions) {
    const metadata = parseKBFormatActions(kb, nodes, edges);
    return { nodes, edges, metadata };
  }

  if (hasIntents) {
    parseKBFormat(kb, nodes, edges);
    return { nodes, edges, metadata: buildBasicMetadata(nodes, edges) };
  }

  // ── Fallback: generic nested tree (legacy behaviour) ─────────────────────
  let currentY = 0;
  function traverse(item: any, depthX: number, parentId: string | null) {
    if (!item) return;
    const nodeId = item.id || `node-${Math.random().toString(36).substring(2, 9)}`;
    nodes.push({
      id: nodeId,
      position: { x: depthX * 250, y: currentY * 100 },
      data: { label: item.name || item.title || 'Unknown Node', rawData: item },
      type: 'default',
    });
    currentY += 1;
    if (parentId) {
      edges.push({
        id: `edge-${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'bezier',
        animated: true,
      });
    }
    if (item.children && Array.isArray(item.children)) {
      item.children.forEach((child: any) => traverse(child, depthX + 1, nodeId));
    }
  }
  traverse(rawJson, 0, null);
  return { nodes, edges, metadata: buildBasicMetadata(nodes, edges) };
}

// ─── Action-based graph parser ───────────────────────────────────────────────
//
// Implementation follows the user-defined steps:
//   1. Iterate over each action {...}
//   2. Read the source intentId
//   3. Read redirect intent ID(s) from payload:
//        - dtmfType=END_WITH_HASH  → payload.dtmfIntentId
//        - dtmfType=SINGLE_DIGIT   → payload.dtmfOptions[].dtmfIntent
//        - payload.nohIntent
//        - payload.followUpIntent
//        - payload.redirectIntent
//   4. Each (source → target) becomes a labelled edge in the graph
//   5. Intents are sorted by sortOrder / intentId before rendering

function parseKBFormatActions(kb: KBJson, nodes: FlowNode[], edges: FlowEdge[]): GraphMetadata {
  const intents: KBIntent[] = [...(kb.intents ?? [])].sort(compareIntent);
  const actions: KBAction[] = [...(kb.actions ?? [])].sort(compareAction);

  const intentMap = new Map<string, KBIntent>();
  for (const intent of intents) intentMap.set(intent.intentId, intent);

  // Add `methods: Set<string>` to track the method for the edge
  const adjacency = new Map<
    string,
    Map<string, { labels: Set<string>; methods: Set<string>; order: number }>
  >();
  const usedIntentIds = new Set<string>();
  let edgeOrder = 0;

  for (const action of actions) {
    const sourceIntentId = action.intentId;
    if (!sourceIntentId || !intentMap.has(sourceIntentId)) continue;

    const payload = normalizePayload(action.payload);
    if (!payload) continue;

    const redirects = getActionRedirects(payload, intentMap);

    for (const redirect of redirects) {
      if (!redirect.targetId) continue;
      if (!intentMap.has(redirect.targetId)) continue;

      let outgoing = adjacency.get(sourceIntentId);
      if (!outgoing) {
        outgoing = new Map();
        adjacency.set(sourceIntentId, outgoing);
      }

      let entry = outgoing.get(redirect.targetId);
      if (!entry) {
        // Initialize the methods Set
        entry = { labels: new Set(), methods: new Set(), order: edgeOrder++ };
        outgoing.set(redirect.targetId, entry);
      }

      entry.labels.add(redirect.label);
      entry.methods.add(redirect.method); // Save the method

      usedIntentIds.add(sourceIntentId);
      usedIntentIds.add(redirect.targetId);
    }
  }

  for (const intent of intents) {
    if ((intent.parentId === 'ROOT' || intent.parentId == null) && adjacency.has(intent.intentId)) {
      usedIntentIds.add(intent.intentId);
    }
  }

  const sortedUsedIntents = intents.filter(i => usedIntentIds.has(i.intentId));
  const intentIdsForScc = sortedUsedIntents.map((intent) => intent.intentId);

  const sccResult = computeSCCs(adjacency, intentIdsForScc);
  const condensedEdges = buildCondensedDag(sccResult.intentToSccId, adjacency);
  const sccMap = new Map(sccResult.components.map((component) => [component.id, component]));

  // Identify the "first intent" — the entry-point of the flow.
  // Heuristic: the root intent (parentId === 'ROOT' / null) with the
  // lowest sortOrder among those that are actually used in the graph.
  // Falls back to the first sorted intent if no explicit root is found.
  const firstIntentId = pickFirstIntentId(sortedUsedIntents);

  const inboundCount = new Map<string, number>();
  const outboundCount = new Map<string, number>();
  for (const [source, targets] of adjacency) {
    outboundCount.set(source, targets.size);
    for (const target of targets.keys()) {
      inboundCount.set(target, (inboundCount.get(target) ?? 0) + 1);
    }
  }

  const splitIntentIds = new Set<string>();
  for (const intent of sortedUsedIntents) {
    const inbound = inboundCount.get(intent.intentId) ?? 0;
    const outbound = outboundCount.get(intent.intentId) ?? 0;
    const splitByInbound = inbound >= 4 && outbound > 0;
    const splitByOutbound = outbound >= 4 && inbound > 0;
    if (splitByInbound || splitByOutbound) splitIntentIds.add(intent.intentId);
  }

  const getSplitNodeId = (intentId: string, role: 'in' | 'out') => {
    return `${intentId}__${role}`;
  };

  for (const intent of sortedUsedIntents) {
    const isSplit = splitIntentIds.has(intent.intentId);
    const isFirst = intent.intentId === firstIntentId;
    const arrow = isFirst ? '▶ ' : '';

    if (!isSplit) {
      const sccId = sccResult.intentToSccId[intent.intentId] ?? intent.intentId;
      const scc = sccMap.get(sccId);
      nodes.push({
        id: intent.intentId,
        position: { x: 0, y: 0 },
        data: {
          label: `${arrow}${intent.intentId}\n${intent.intentName}`,
          rawData: intent,
          isFirstIntent: isFirst,
          baseIntentId: intent.intentId,
          sccId,
          sccSize: scc?.members.length ?? 1,
          isCyclicScc: scc?.isCyclic ?? false,
        },
        type: 'default',
      });
      continue;
    }

    const sccId = sccResult.intentToSccId[intent.intentId] ?? intent.intentId;
    const scc = sccMap.get(sccId);

    nodes.push({
      id: getSplitNodeId(intent.intentId, 'in'),
      position: { x: 0, y: 0 },
      data: {
        label: `${arrow}${intent.intentId}\n${intent.intentName} (in)`,
        rawData: intent,
        isFirstIntent: isFirst,
        splitRole: 'in',
        splitPairId: intent.intentId,
        baseIntentId: intent.intentId,
        sccId,
        sccSize: scc?.members.length ?? 1,
        isCyclicScc: scc?.isCyclic ?? false,
      },
      type: 'default',
    });

    nodes.push({
      id: getSplitNodeId(intent.intentId, 'out'),
      position: { x: 0, y: 0 },
      data: {
        label: `${intent.intentId}\n${intent.intentName} (out)`,
        rawData: intent,
        splitRole: 'out',
        splitPairId: intent.intentId,
        baseIntentId: intent.intentId,
        sccId,
        sccSize: scc?.members.length ?? 1,
        isCyclicScc: scc?.isCyclic ?? false,
      },
      type: 'default',
    });
  }

  for (const [source, targets] of adjacency) {
    const sortedTargets = [...targets.entries()].sort((a, b) => a[1].order - b[1].order);

    for (const [target, meta] of sortedTargets) {
      
      // Default color: gray
      let strokeColor = '#b1b1b7';
      
      // Determine color by method (prioritizing in this order if multiple exist)
      if (meta.methods.has('dtmf')) {
        strokeColor = '#10b981'; // Green
      } else if (meta.methods.has('noh')) {
        strokeColor = '#f43f5e'; // Red
      } else if (meta.methods.has('followUp')) {
        strokeColor = '#f59e0b'; // Orange
      } else if (meta.methods.has('redirect')) {
        strokeColor = '#3b82f6'; // Blue
      } else if (meta.methods.has('procArg')) {
        strokeColor = '#8b5cf6'; // Purple
      }

      const sourceId = splitIntentIds.has(source) ? getSplitNodeId(source, 'out') : source;
      const targetId = splitIntentIds.has(target) ? getSplitNodeId(target, 'in') : target;
      const sourceSccId = sccResult.intentToSccId[source] ?? source;
      const targetSccId = sccResult.intentToSccId[target] ?? target;
      const edgeClass = sourceSccId === targetSccId ? 'intra-scc' : 'inter-scc';

      const edgeStyle =
        edgeClass === 'intra-scc'
          ? { stroke: strokeColor, strokeWidth: 1.5, strokeDasharray: '5 3', opacity: 0.55 }
          : { stroke: strokeColor, strokeWidth: 2 };

      edges.push({
        id: `${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: 'straight',
        animated: false,
        label: [...meta.labels].join(', '),
        style: edgeStyle,
        labelBgStyle: { fill: '#ffffff', color: '#fff', fillOpacity: 0.8 }, // Optional: clean up label background
        labelStyle: { fill: strokeColor, fontWeight: 700 }, // Match text to line color
        className: edgeClass,
        data: {
          edgeClass,
          methods: [...meta.methods].sort(),
          sourceSccId,
          targetSccId,
        },
      });
    }
  }

  for (const intentId of splitIntentIds) {
    const inId = getSplitNodeId(intentId, 'in');
    const outId = getSplitNodeId(intentId, 'out');
    edges.push({
      id: `${inId}-${outId}-split-link`,
      source: inId,
      target: outId,
      type: 'straight',
      animated: false,
      style: { stroke: '#9ca3af', strokeWidth: 1, strokeDasharray: '4 4' },
      className: 'intra-scc',
      data: {
        edgeClass: 'intra-scc',
        methods: ['splitLink'],
        sourceSccId: sccResult.intentToSccId[intentId] ?? intentId,
        targetSccId: sccResult.intentToSccId[intentId] ?? intentId,
      },
    });
  }

  const nodeToSccId: Record<string, string> = {};
  for (const node of nodes) {
    const baseIntentId = node.data.baseIntentId ?? node.id;
    const sccId = sccResult.intentToSccId[baseIntentId] ?? baseIntentId;
    nodeToSccId[node.id] = sccId;
  }

  return {
    intentToSccId: sccResult.intentToSccId,
    nodeToSccId,
    sccs: sccResult.components,
    condensedEdges,
  };
}

function buildBasicMetadata(nodes: FlowNode[], edges: FlowEdge[]): GraphMetadata {
  const intentToSccId: Record<string, string> = {};
  const nodeToSccId: Record<string, string> = {};
  const sccs: SCCComponent[] = [];

  for (const node of nodes) {
    const baseIntentId = node.data.baseIntentId ?? node.data.splitPairId ?? node.id;
    intentToSccId[baseIntentId] = baseIntentId;
    nodeToSccId[node.id] = baseIntentId;
  }

  for (const intentId of Object.keys(intentToSccId)) {
    sccs.push({ id: intentId, members: [intentId], isCyclic: false });
  }

  const condensedMap = new Map<string, CondensedEdge>();
  for (const edge of edges) {
    const sourceSccId = nodeToSccId[edge.source] ?? edge.source;
    const targetSccId = nodeToSccId[edge.target] ?? edge.target;
    if (sourceSccId === targetSccId) continue;
    const id = `${sourceSccId}->${targetSccId}`;
    const existing = condensedMap.get(id);
    if (existing) {
      existing.transitionCount += 1;
    } else {
      condensedMap.set(id, {
        id,
        sourceSccId,
        targetSccId,
        transitionCount: 1,
      });
    }
  }

  return {
    intentToSccId,
    nodeToSccId,
    sccs,
    condensedEdges: [...condensedMap.values()],
  };
}

function computeSCCs(
  adjacency: Map<string, Map<string, { labels: Set<string>; methods: Set<string>; order: number }>>,
  allIntentIds: string[],
): {
  components: SCCComponent[];
  intentToSccId: Record<string, string>;
} {
  const ids = new Set<string>(allIntentIds);
  for (const [source, targets] of adjacency) {
    ids.add(source);
    for (const target of targets.keys()) ids.add(target);
  }

  const indexMap = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const inStack = new Set<string>();
  let index = 0;

  const components: SCCComponent[] = [];

  const strongConnect = (nodeId: string) => {
    indexMap.set(nodeId, index);
    lowLink.set(nodeId, index);
    index += 1;

    stack.push(nodeId);
    inStack.add(nodeId);

    const outgoing = adjacency.get(nodeId);
    if (outgoing) {
      for (const targetId of outgoing.keys()) {
        if (!indexMap.has(targetId)) {
          strongConnect(targetId);
          const low = Math.min(lowLink.get(nodeId)!, lowLink.get(targetId)!);
          lowLink.set(nodeId, low);
        } else if (inStack.has(targetId)) {
          const low = Math.min(lowLink.get(nodeId)!, indexMap.get(targetId)!);
          lowLink.set(nodeId, low);
        }
      }
    }

    if (lowLink.get(nodeId) === indexMap.get(nodeId)) {
      const members: string[] = [];
      let current = '';
      do {
        current = stack.pop()!;
        inStack.delete(current);
        members.push(current);
      } while (current !== nodeId);

      members.sort(compareIntentId);
      const hasSelfLoop = adjacency.get(nodeId)?.has(nodeId) ?? false;
      const isCyclic = members.length > 1 || hasSelfLoop;
      const componentId = `scc-${components.length}`;
      components.push({
        id: componentId,
        members,
        isCyclic,
      });
    }
  };

  const sortedIds = [...ids].sort(compareIntentId);
  for (const id of sortedIds) {
    if (!indexMap.has(id)) strongConnect(id);
  }

  const intentToSccId: Record<string, string> = {};
  for (const component of components) {
    for (const member of component.members) {
      intentToSccId[member] = component.id;
    }
  }

  components.sort((a, b) => compareIntentId(a.members[0], b.members[0]));

  return { components, intentToSccId };
}

function buildCondensedDag(
  intentToSccId: Record<string, string>,
  adjacency: Map<string, Map<string, { labels: Set<string>; methods: Set<string>; order: number }>>,
): CondensedEdge[] {
  const condensedMap = new Map<string, CondensedEdge>();
  for (const [sourceIntent, targets] of adjacency) {
    const sourceSccId = intentToSccId[sourceIntent] ?? sourceIntent;
    for (const targetIntent of targets.keys()) {
      const targetSccId = intentToSccId[targetIntent] ?? targetIntent;
      if (sourceSccId === targetSccId) continue;
      const id = `${sourceSccId}->${targetSccId}`;
      const existing = condensedMap.get(id);
      if (existing) {
        existing.transitionCount += 1;
      } else {
        condensedMap.set(id, {
          id,
          sourceSccId,
          targetSccId,
          transitionCount: 1,
        });
      }
    }
  }
  return [...condensedMap.values()].sort((a, b) => compareIntentId(a.id, b.id));
}

function normalizePayload(payload: KBAction['payload']): KBActionPayload | null {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return payload;
}

function parseProcedureArgs(argsStr: string): Array<{ intentId: string; label: string }> {
  const results: Array<{ intentId: string; label: string }> = [];
  const regex = /(\w+IntentId):\s*["']([\w]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(argsStr)) !== null) {
    const key = match[1];
    const intentId = match[2];
    let label = key.replace(/([A-Z])/g, ' $1').trim(); // e.g. "successIntentId" -> "success Intent Id"
    label = label.replace(/ Intent Id$/, '').trim();     // -> "success"
    results.push({ intentId, label });
  }
  return results;
}

// Step 3: extract every redirect target ID from a single action payload
function getActionRedirects(
  payload: KBActionPayload,
  intentMap: Map<string, KBIntent>,
): Array<{ targetId: string; label: string; method: string }> {
  const redirects: Array<{ targetId: string; label: string; method: string }> = [];

  // 1) END_WITH_HASH -> dtmf
  if (payload.dtmfType === 'END_WITH_HASH' && payload.dtmfIntentId) {
    redirects.push({
      targetId: payload.dtmfIntentId,
      label: '[# entered]',
      method: 'dtmf'
    });
  }

  // 2) SINGLE_DIGIT -> dtmf
  if (Array.isArray(payload.dtmfOptions)) {
    for (const opt of payload.dtmfOptions) {
      if (!opt?.dtmfIntent) continue;
      redirects.push({
        targetId: opt.dtmfIntent,
        label: opt.dtmfPattern ? `[${opt.dtmfPattern}]` : '[digit]',
        method: 'dtmf'
      });
    }
  }

  // 3) nohIntent / followUpIntent / redirectIntent
  if (payload.nohIntent) {
    redirects.push({
      targetId: payload.nohIntent,
      label: 'noh',
      method: 'noh'
    });
  }

  if (payload.followUpIntent) {
    redirects.push({
      targetId: payload.followUpIntent,
      label: 'followUp',
      method: 'followUp'
    });
  }

  if (payload.redirectIntent) {
    redirects.push({
      targetId: payload.redirectIntent,
      label: 'redirect',
      method: 'redirect'
    });
  }

  // Parse procedure args string for intent IDs
  if (payload.args && typeof payload.args === 'string') {
    const parsedArgs = parseProcedureArgs(payload.args);
    for (const { intentId, label } of parsedArgs) {
      if (intentId && intentMap.has(intentId)) {
        redirects.push({ targetId: intentId, label, method: 'procArg' });
      }
    }
  }

  // Remove duplicates based on targetId AND label
  const seen = new Set<string>();
  return redirects.filter((r) => {
    const key = `${r.targetId}|${r.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Sorting helpers ─────────────────────────────────────────────────────────

function compareIntent(a: KBIntent, b: KBIntent): number {
  return (
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    compareIntentId(a.intentId, b.intentId)
  );
}

function compareAction(a: KBAction, b: KBAction): number {
  return (
    compareIntentId(a.intentId, b.intentId) ||
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
    compareIntentId(a.actionId, b.actionId)
  );
}

function compareIntentId(a?: string, b?: string): number {
  return (a ?? '').localeCompare(b ?? '');
}

// Picks the "first intent" — the entry point of the flow.
// Preference order:
//   1. The root intent (parentId === 'ROOT' / null) with the lowest
//      sortOrder, among intents in the graph.
//   2. The intent with the lowest sortOrder overall (e.g. the very
//      first intent in the KB).
//   3. The first intent in the supplied list.
// Returns null only when the list is empty.
function pickFirstIntentId(sortedIntents: KBIntent[]): string | null {
  if (sortedIntents.length === 0) return null;

  const roots = sortedIntents.filter(
    (i) => i.parentId === 'ROOT' || i.parentId == null,
  );
  const pool = roots.length > 0 ? roots : sortedIntents;
  return pool[0].intentId;
}

// "[1]" < "[2]" < "noh" < "followUp" < "redirect"
function compareEdgeLabel(a: string, b: string): number {
  const isDigitA = a.startsWith('[');
  const isDigitB = b.startsWith('[');
  if (isDigitA && !isDigitB) return -1;
  if (!isDigitA && isDigitB) return 1;
  return a.localeCompare(b);
}

// ─── Intent coverage check ────────────────────────────────────────────────────

export interface IntentCheckResult {
  allAdded: boolean;
  totalIntents: number;
  addedIntents: number;
  missingIntents: string[];
}

/**
 * Checks whether all intents from the KB JSON are present as nodes in the graph.
 * An intent is considered "added" if it appears as a node (i.e., it has at least
 * one incoming or outgoing edge in the action-based graph).
 */
export function checkAllIntentsAdded(
  rawJson: any,
  nodes: FlowNode[],
): IntentCheckResult {
  const kb = rawJson as KBJson;
  const intents: KBIntent[] = kb.intents ?? [];

  const nodeIds = new Set(
    nodes.map((n) => {
      if (n.data?.splitPairId) return n.data.splitPairId;
      if (n.id.endsWith('__in')) return n.id.slice(0, -4);
      if (n.id.endsWith('__out')) return n.id.slice(0, -5);
      return n.id;
    }),
  );

  const missingIntents = intents
    .filter((i) => !nodeIds.has(i.intentId))
    .map((i) => i.intentId);

  return {
    allAdded: missingIntents.length === 0,
    totalIntents: intents.length,
    addedIntents: intents.length - missingIntents.length,
    missingIntents,
  };
}

// ─── Layout: BFS depth from root intents, then column packing ────────────────

function layoutActionGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  sortedIntents: KBIntent[],
  allIntents: KBIntent[],
): void {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Roots are intents that look like top-level entries (parentId === 'ROOT'),
  // falling back to nodes with no incoming edges, then to the first sorted node.
  const explicitRoots = allIntents
    .filter(i => (i.parentId === 'ROOT' || i.parentId == null) && nodeMap.has(i.intentId))
    .map(i => i.intentId);

  const inDegreeRoots = sortedIntents
    .filter(i => nodeMap.has(i.intentId) && (incomingCount.get(i.intentId) ?? 0) === 0)
    .map(i => i.intentId);

  const roots = explicitRoots.length > 0
    ? explicitRoots
    : inDegreeRoots.length > 0
      ? inDegreeRoots
      : sortedIntents.filter(i => nodeMap.has(i.intentId)).map(i => i.intentId).slice(0, 1);

  // BFS to assign depth. Use max-depth so that "deepest" path determines level.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r, 0);
    queue.push(r);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = (depth.get(id) ?? 0) + 1;
    for (const tgt of outgoing.get(id) ?? []) {
      if ((depth.get(tgt) ?? -1) < next) {
        depth.set(tgt, next);
        queue.push(tgt);
      }
    }
  }

  // Any node not reachable from a root (cycles, orphans) → place in a tail row
  let maxDepth = 0;
  depth.forEach(d => { if (d > maxDepth) maxDepth = d; });
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1);
  }

  // Bucket nodes by depth, preserving the sortedIntents order within each level.
  const levels = new Map<number, FlowNode[]>();
  for (const intent of sortedIntents) {
    const node = nodeMap.get(intent.intentId);
    if (!node) continue;
    const lvl = depth.get(intent.intentId) ?? 0;
    const list = levels.get(lvl) ?? [];
    list.push(node);
    levels.set(lvl, list);
  }

  // Position: centre each row horizontally
  levels.forEach((levelNodes, level) => {
    const totalWidth = levelNodes.length * NODE_WIDTH + (levelNodes.length - 1) * H_GAP;
    const startX = -totalWidth / 2;
    levelNodes.forEach((node, index) => {
      node.position = {
        x: startX + index * (NODE_WIDTH + H_GAP),
        y: level * (NODE_HEIGHT + V_GAP),
      };
    });
  });
}

// ─── parentId-only KB-format parser (used when no actions are present) ──────

function parseKBFormat(kb: KBJson, nodes: FlowNode[], edges: FlowEdge[]): void {
  const intents: KBIntent[] = kb.intents ?? [];
  const intentIdSet = new Set(intents.map(i => i.intentId));

  const childrenMap = new Map<string, KBIntent[]>();
  const rootIntents: KBIntent[] = [];

  for (const intent of intents) {
    const pid = intent.parentId ?? null;
    if (pid === null || pid === 'ROOT' || !intentIdSet.has(pid)) {
      rootIntents.push(intent);
    } else {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(intent);
    }
  }

  childrenMap.forEach(children => children.sort(compareIntent));
  rootIntents.sort(compareIntent);

  const versionNodeId = kb.version ? `version-${kb.version.version}` : null;
  if (kb.version && versionNodeId) {
    nodes.push({
      id: versionNodeId,
      position: { x: 0, y: 0 },
      data: {
        label: `📦 ${kb.version.name ?? kb.version.version}`,
        rawData: kb.version,
      },
      type: 'input',
    });
  }

  function subtreeWidth(id: string): number {
    const children = childrenMap.get(id);
    if (!children || children.length === 0) return NODE_WIDTH;
    const total =
      children.reduce((sum, c) => sum + subtreeWidth(c.intentId) + H_GAP, 0) - H_GAP;
    return Math.max(NODE_WIDTH, total);
  }

  function placeNode(intent: KBIntent, cx: number, depth: number, parentNodeId: string | null) {
    const nodeId = intent.intentId;
    const y = depth * (NODE_HEIGHT + V_GAP);

    nodes.push({
      id: nodeId,
      position: { x: cx - NODE_WIDTH / 2, y },
      data: {
        label: `${intent.intentId}\n${intent.intentName}`,
        rawData: intent,
      },
      type: 'default',
    });

    const effectiveParent = parentNodeId ?? versionNodeId;
    if (effectiveParent) {
      edges.push({
        id: `edge-${effectiveParent}-${nodeId}`,
        source: effectiveParent,
        target: nodeId,
        type: 'smoothstep',
        animated: false,
      });
    }

    const children = childrenMap.get(nodeId);
    if (!children || children.length === 0) return;

    const totalWidth =
      children.reduce((sum, c) => sum + subtreeWidth(c.intentId) + H_GAP, 0) - H_GAP;
    let startX = cx - totalWidth / 2;
    for (const child of children) {
      const sw = subtreeWidth(child.intentId);
      placeNode(child, startX + sw / 2, depth + 1, nodeId);
      startX += sw + H_GAP;
    }
  }

  const totalRootWidth =
    rootIntents.reduce((sum, r) => sum + subtreeWidth(r.intentId) + H_GAP, 0) - H_GAP;
  const startDepth = versionNodeId ? 1 : 0;
  let startRootX = -totalRootWidth / 2;

  for (const root of rootIntents) {
    const sw = subtreeWidth(root.intentId);
    placeNode(root, startRootX + sw / 2, startDepth, null);
    startRootX += sw + H_GAP;
  }

  if (versionNodeId) {
    const vNode = nodes.find(n => n.id === versionNodeId);
    if (vNode) {
      vNode.position = { x: -NODE_WIDTH / 2, y: -(NODE_HEIGHT + V_GAP) };
    }
  }
}
