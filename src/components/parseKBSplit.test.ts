import { buildSplitNodes, countDegrees, decideSplitIntents, getSplitNodeId, resolveSplitEdges } from './parseKBSplit';
import type { Adjacency } from './parseKBActions';
import type { KBIntent } from './parseKB';

describe('parseKBSplit', () => {
  const intents: KBIntent[] = [
    { intentId: 'A', parentId: 'ROOT', intentName: 'Alpha', sortOrder: 1 },
    { intentId: 'B', parentId: 'A', intentName: 'Bravo', sortOrder: 2 },
    { intentId: 'C', parentId: 'A', intentName: 'Charlie', sortOrder: 3 },
    { intentId: 'D', parentId: 'A', intentName: 'Delta', sortOrder: 4 },
    { intentId: 'E', parentId: 'A', intentName: 'Echo', sortOrder: 5 },
    { intentId: 'F', parentId: 'A', intentName: 'Foxtrot', sortOrder: 6 },
  ];

  test('decides split intents from in/out degree thresholds', () => {
    const inboundCount = new Map([
      ['A', 1],
      ['B', 4],
      ['C', 1],
      ['D', 1],
      ['E', 1],
      ['F', 1],
    ]);
    const outboundCount = new Map([
      ['A', 4],
      ['B', 1],
      ['C', 1],
      ['D', 0],
      ['E', 0],
      ['F', 0],
    ]);

    const split = decideSplitIntents(intents, inboundCount, outboundCount);

    expect(split.has('A')).toBe(true);
    expect(split.has('B')).toBe(true);
    expect(split.has('D')).toBe(false);
  });

  test('buildSplitNodes creates in/out copies and marks first intent', () => {
    const splitIntentIds = new Set(['A']);
    const inboundCount = new Map([['A', 2]]);
    const outboundCount = new Map([['A', 3]]);

    const nodes = buildSplitNodes(intents.slice(0, 2), splitIntentIds, inboundCount, outboundCount, 'A', true);

    expect(nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        getSplitNodeId('A', 'in', 1),
        getSplitNodeId('A', 'in', 2),
        getSplitNodeId('A', 'out', 1),
        getSplitNodeId('A', 'out', 2),
        getSplitNodeId('A', 'out', 3),
        'B',
      ]),
    );
    const first = nodes.find((n) => n.id === getSplitNodeId('A', 'in', 1));
    expect(first?.data.isFirstIntent).toBe(true);
    expect(first?.data.label.startsWith('▶ ')).toBe(true);
  });

  test('countDegrees and resolveSplitEdges use deterministic adjacency order', () => {
    const adjacency: Adjacency = new Map([
      [
        'A',
        new Map([
          ['B', { labels: new Set(['x']), methods: new Set(['dtmf']), order: 0 }],
          ['C', { labels: new Set(['y']), methods: new Set(['redirect']), order: 1 }],
        ]),
      ],
      [
        'B',
        new Map([
          ['A', { labels: new Set(['z']), methods: new Set(['followUp']), order: 2 }],
        ]),
      ],
    ]);

    const { inboundCount, outboundCount } = countDegrees(adjacency);
    expect(outboundCount.get('A')).toBe(2);
    expect(inboundCount.get('A')).toBe(1);
    expect(inboundCount.get('B')).toBe(1);

    const splitIntentIds = new Set(['A']);
    const resolved = resolveSplitEdges(adjacency, splitIntentIds, true);

    expect(resolved[0].sourceId).toBe('A__out__1');
    expect(resolved[0].targetId).toBe('B');
    expect(resolved[1].sourceId).toBe('A__out__2');
    expect(resolved[1].targetId).toBe('C');
    expect(resolved[2].sourceId).toBe('B');
    expect(resolved[2].targetId).toBe('A__in__1');

    const resolvedCollapsed = resolveSplitEdges(adjacency, splitIntentIds, false);
    expect(resolvedCollapsed.every((e) => !e.sourceId.endsWith('__2'))).toBe(true);
    expect(resolvedCollapsed.find((e) => e.sourceBase === 'B')?.targetId).toBe('A__in__1');
  });
});
