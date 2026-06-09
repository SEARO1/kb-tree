import { checkAllIntentsAdded, parseKBToGraph } from './parseKB';
import { kbIntentsOnly, kbWithActions } from '../test/fixtures/kbFixtures';

describe('parseKB entry behavior', () => {
  test('uses actions path when intents and actions are present', () => {
    const { nodes, edges } = parseKBToGraph(kbWithActions);

    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    expect(nodes.some((n) => n.id.includes('WELCOME'))).toBe(true);
    expect(edges.some((e) => e.source.includes('WELCOME') && e.target.includes('MENU'))).toBe(true);
  });

  test('uses intents-only parent tree path when no actions provided', () => {
    const { nodes, edges } = parseKBToGraph(kbIntentsOnly);

    expect(nodes.some((n) => n.id === 'version-v1')).toBe(true);
    expect(nodes.some((n) => n.id === 'ROOT_A')).toBe(true);
    expect(nodes.some((n) => n.id === 'CHILD_A1')).toBe(true);
    expect(edges.some((e) => e.source === 'ROOT_A' && e.target === 'CHILD_A1')).toBe(true);
  });

  test('falls back to generic traversal for minimal non-KB JSON', () => {
    const { nodes, edges } = parseKBToGraph({
      id: 'root',
      name: 'Root node',
      children: [{ id: 'child', title: 'Child node' }],
    });

    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(nodes.find((n) => n.id === 'root')?.data.label).toBe('Root node');
    expect(nodes.find((n) => n.id === 'child')?.data.label).toBe('Child node');
    expect(edges[0]).toMatchObject({ source: 'root', target: 'child' });
  });

  test('returns empty graph for null malformed input', () => {
    const { nodes, edges } = parseKBToGraph(null);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  test('creates mirror node for cycle by default and can disable acyclic transform', () => {
    const kbCycle = {
      intents: [
        { intentId: 'A', parentId: 'ROOT', intentName: 'Alpha', sortOrder: 1 },
        { intentId: 'B', parentId: 'A', intentName: 'Bravo', sortOrder: 2 },
        { intentId: 'C', parentId: 'B', intentName: 'Charlie', sortOrder: 3 },
      ],
      actions: [
        { actionId: 'ab', intentId: 'A', type: 'redirect', payload: { redirectIntent: 'B' } },
        { actionId: 'bc', intentId: 'B', type: 'redirect', payload: { redirectIntent: 'C' } },
        { actionId: 'ca', intentId: 'C', type: 'redirect', payload: { redirectIntent: 'A' } },
      ],
    };

    const defaultParsed = parseKBToGraph(kbCycle);
    expect(defaultParsed.nodes.some((n) => n.id.endsWith('__mirror'))).toBe(true);

    const noAcyclicParsed = parseKBToGraph(kbCycle, { makeAcyclic: false });
    expect(noAcyclicParsed.nodes.some((n) => n.id.endsWith('__mirror'))).toBe(false);
  });

  test('checkAllIntentsAdded reports missing intents from graph nodes', () => {
    const kb = {
      intents: [
        { intentId: 'A', parentId: 'ROOT', intentName: 'Alpha' },
        { intentId: 'B', parentId: 'A', intentName: 'Bravo' },
      ],
    };

    const result = checkAllIntentsAdded(kb, [
      { id: 'A', position: { x: 0, y: 0 }, data: { label: 'A' }, type: 'default' },
    ]);

    expect(result.allAdded).toBe(false);
    expect(result.totalIntents).toBe(2);
    expect(result.addedIntents).toBe(1);
    expect(result.missingIntents).toEqual(['B']);
  });
});
