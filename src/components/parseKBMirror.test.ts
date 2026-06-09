import { buildFinalEdges, buildMirrorMap, buildMirrorNodes, detectCycles, getBaseIntentId } from './parseKBMirror';
import type { SplitEdge } from './parseKBSplit';
import { cycleIntents } from '../test/fixtures/kbFixtures';

describe('parseKBMirror', () => {
  const compareIntentId = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');

  test('getBaseIntentId normalizes split IDs', () => {
    expect(getBaseIntentId('A__in__2')).toBe('A');
    expect(getBaseIntentId('B__out__1')).toBe('B');
    expect(getBaseIntentId('C')).toBe('C');
  });

  test('detectCycles marks return edges by source-target key', () => {
    const splitEdges: SplitEdge[] = [
      {
        sourceId: 'A',
        targetId: 'B',
        sourceBase: 'A',
        targetBase: 'B',
        meta: { labels: new Set(['ab']), methods: new Set(['redirect']), order: 0 },
      },
      {
        sourceId: 'B',
        targetId: 'C',
        sourceBase: 'B',
        targetBase: 'C',
        meta: { labels: new Set(['bc']), methods: new Set(['redirect']), order: 1 },
      },
      {
        sourceId: 'C',
        targetId: 'A',
        sourceBase: 'C',
        targetBase: 'A',
        meta: { labels: new Set(['ca']), methods: new Set(['redirect']), order: 2 },
      },
    ];

    const cycleKeys = detectCycles(splitEdges, cycleIntents, new Set<string>(), compareIntentId);

    expect(cycleKeys.has('C\0A')).toBe(true);
    expect(cycleKeys.has('A\0B')).toBe(false);
  });

  test('buildMirrorMap and buildMirrorNodes create one mirror per target', () => {
    const cycleKeys = new Set<string>(['X\0A__in__1', 'Y\0A__in__1', 'Z\0B']);
    const mirrorMap = buildMirrorMap(cycleKeys);

    expect(mirrorMap.size).toBe(2);
    expect(mirrorMap.get('A__in__1')).toBe('A__in__1__mirror');
    expect(mirrorMap.get('B')).toBe('B__mirror');

    const intentMap = new Map(cycleIntents.map((i) => [i.intentId, i]));
    const nodes = buildMirrorNodes(mirrorMap, intentMap, compareIntentId);

    const splitMirror = nodes.find((n) => n.id === 'A__in__1__mirror');
    expect(splitMirror?.data.isMirror).toBe(true);
    expect(splitMirror?.data.mirrorOf).toBe('A__in__1');
    expect(splitMirror?.data.mirrorOfBase).toBe('A');
    expect(splitMirror?.data.label).toContain("A' (in 1)");

    const plainMirror = nodes.find((n) => n.id === 'B__mirror');
    expect(plainMirror?.data.label).toContain("B'");
  });

  test('buildFinalEdges rewrites cycle return targets to mirror IDs', () => {
    const splitEdges: SplitEdge[] = [
      {
        sourceId: 'A',
        targetId: 'B',
        sourceBase: 'A',
        targetBase: 'B',
        meta: { labels: new Set(['ab']), methods: new Set(['dtmf']), order: 0 },
      },
      {
        sourceId: 'B',
        targetId: 'A',
        sourceBase: 'B',
        targetBase: 'A',
        meta: { labels: new Set(['ba']), methods: new Set(['followUp']), order: 1 },
      },
    ];

    const cycleKeys = new Set<string>(['B\0A']);
    const mirrorMap = new Map<string, string>([['A', 'A__mirror']]);

    const edges = buildFinalEdges(splitEdges, cycleKeys, mirrorMap, () => '#000000');

    expect(edges[0].target).toBe('B');
    expect(edges[1].target).toBe('A__mirror');
    expect(edges[1].id).toBe('B-A__mirror');
  });
});
