import { buildAdjacency, buildIntentMap, getActionRedirects, pickEdgeColor } from './parseKBActions';
import type { KBAction, KBActionPayload, KBIntent } from './parseKB';

describe('parseKBActions', () => {
  const intents: KBIntent[] = [
    { intentId: 'A', parentId: 'ROOT', intentName: 'Alpha' },
    { intentId: 'B', parentId: 'A', intentName: 'Bravo' },
    { intentId: 'C', parentId: 'A', intentName: 'Charlie' },
    { intentId: 'D', parentId: 'A', intentName: 'Delta' },
    { intentId: 'E', parentId: 'A', intentName: 'Echo' },
    { intentId: 'F', parentId: 'A', intentName: 'Foxtrot' },
  ];

  const intentMap = buildIntentMap(intents);

  test('extracts redirects from payload variants and deduplicates by target+label', () => {
    const payload: KBActionPayload = {
      dtmfType: 'END_WITH_HASH',
      dtmfIntentId: 'B',
      dtmfOptions: [
        { dtmfPattern: '1', dtmfIntent: 'C' },
        { dtmfPattern: '1', dtmfIntent: 'C' },
      ],
      nohIntent: 'D',
      followUpIntent: 'E',
      redirectIntent: 'F',
      args: `successIntentId: "B", retryIntentId: "C", missingIntentId: "ZZZ"`,
    };

    const redirects = getActionRedirects(payload, intentMap);

    expect(redirects).toEqual(
      expect.arrayContaining([
        { targetId: 'B', label: '[# entered]', method: 'dtmf' },
        { targetId: 'C', label: '[1]', method: 'dtmf' },
        { targetId: 'D', label: 'noh', method: 'noh' },
        { targetId: 'E', label: 'followUp', method: 'followUp' },
        { targetId: 'F', label: 'redirect', method: 'redirect' },
        { targetId: 'B', label: 'success', method: 'procArg' },
        { targetId: 'C', label: 'retry', method: 'procArg' },
      ]),
    );
    expect(redirects.filter((r) => r.targetId === 'C' && r.label === '[1]')).toHaveLength(1);
    expect(redirects.some((r) => r.targetId === 'ZZZ')).toBe(false);
  });

  test('buildAdjacency drops unknown and self-loop redirects while tracking used intents', () => {
    const actions: KBAction[] = [
      {
        actionId: 'a1',
        intentId: 'A',
        type: 'route',
        payload: {
          dtmfType: 'END_WITH_HASH',
          dtmfIntentId: 'B',
          followUpIntent: 'A',
          redirectIntent: 'UNKNOWN',
        },
      },
      {
        actionId: 'a2',
        intentId: 'A',
        type: 'route',
        payload: {
          dtmfType: 'END_WITH_HASH',
          dtmfIntentId: 'B',
        },
      },
    ];

    const { adjacency, usedIntentIds } = buildAdjacency(actions, intentMap, (action) =>
      getActionRedirects(action.payload as KBActionPayload, intentMap),
    );

    expect(adjacency.get('A')?.has('B')).toBe(true);
    const meta = adjacency.get('A')?.get('B');
    expect(meta?.labels.has('[# entered]')).toBe(true);
    expect(meta?.methods.has('dtmf')).toBe(true);
    expect(adjacency.get('A')?.has('A')).toBe(false);
    expect(adjacency.get('A')?.has('UNKNOWN')).toBe(false);
    expect(usedIntentIds.has('A')).toBe(true);
    expect(usedIntentIds.has('B')).toBe(true);
  });

  test('pickEdgeColor applies method priority', () => {
    expect(pickEdgeColor(new Set(['redirect']))).toBe('#3b82f6');
    expect(pickEdgeColor(new Set(['followUp', 'redirect']))).toBe('#f59e0b');
    expect(pickEdgeColor(new Set(['dtmf', 'redirect']))).toBe('#10b981');
    expect(pickEdgeColor(new Set())).toBe('#b1b1b7');
  });
});
