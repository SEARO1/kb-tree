// ─── React Flow types ────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; rawData?: any };
  type?: string;
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

export function parseKBToGraph(rawJson: any): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const kb = rawJson as KBJson;

  const hasIntents =
    kb.intents && Array.isArray(kb.intents) && kb.intents.length > 0 && 'intentId' in kb.intents[0];
  const hasActions = kb.actions && Array.isArray(kb.actions) && kb.actions.length > 0;

  if (hasIntents && hasActions) {
    parseKBFormatActions(kb, nodes, edges);
    return { nodes, edges };
  }

  if (hasIntents) {
    parseKBFormat(kb, nodes, edges);
    return { nodes, edges };
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
  return { nodes, edges };
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

function parseKBFormatActions(kb: KBJson, nodes: FlowNode[], edges: FlowEdge[]): void {
  const intents: KBIntent[] = [...(kb.intents ?? [])].sort(compareIntent);
  const actions: KBAction[] = [...(kb.actions ?? [])].sort(compareAction);

  const intentMap = new Map<string, KBIntent>();
  for (const intent of intents) intentMap.set(intent.intentId, intent);

// Add `methods: Set<string>` to track the method for the edge
const adjacency = new Map<string, Map<string, { labels: Set<string>; methods: Set<string>; order: number }>>();
const usedIntentIds = new Set<string>();
let edgeOrder = 0;

for (const action of actions) {
  const sourceIntentId = action.intentId;
  if (!sourceIntentId || !intentMap.has(sourceIntentId)) continue;

  const payload = normalizePayload(action.payload);
  if (!payload) continue;

  const redirects = getActionRedirects(payload);

  for (const redirect of redirects) {
    if (!redirect.targetId) continue;
    if (redirect.targetId === sourceIntentId) continue;
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

  for (const intent of sortedUsedIntents) {
    nodes.push({
      id: intent.intentId,
      position: { x: 0, y: 0 },
      data: { label: `${intent.intentId}\n${intent.intentName}`, rawData: intent },
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
      }

      edges.push({
        id: `${source}-${target}`,
        source,
        target,
        type: 'straight',
        animated: false,
        label: [...meta.labels].join(', '),
        style: { stroke: strokeColor, strokeWidth: 2 }, // Apply React Flow styling
        labelBgStyle: { fill: '#ffffff', color: '#fff', fillOpacity: 0.8 }, // Optional: clean up label background
        labelStyle: { fill: strokeColor, fontWeight: 700 } // Match text to line color
      });
    }
  }
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

// Step 3: extract every redirect target ID from a single action payload
function getActionRedirects(
  payload: KBActionPayload,
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

// "[1]" < "[2]" < "noh" < "followUp" < "redirect"
function compareEdgeLabel(a: string, b: string): number {
  const isDigitA = a.startsWith('[');
  const isDigitB = b.startsWith('[');
  if (isDigitA && !isDigitB) return -1;
  if (!isDigitA && isDigitB) return 1;
  return a.localeCompare(b);
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
