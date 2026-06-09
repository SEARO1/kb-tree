import type { KBAction, KBIntent, KBJson } from '../../components/parseKB';

export const intentsBasic: KBIntent[] = [
  {
    intentId: 'WELCOME',
    parentId: 'ROOT',
    intentName: 'Welcome',
    sortOrder: 1,
  },
  {
    intentId: 'MENU',
    parentId: 'WELCOME',
    intentName: 'Main menu',
    sortOrder: 2,
  },
  {
    intentId: 'HELP',
    parentId: 'MENU',
    intentName: 'Help',
    sortOrder: 3,
  },
  {
    intentId: 'AGENT',
    parentId: 'MENU',
    intentName: 'Agent handoff',
    sortOrder: 4,
  },
  {
    intentId: 'TIMEOUT',
    parentId: 'MENU',
    intentName: 'Timeout path',
    sortOrder: 5,
  },
  {
    intentId: 'FOLLOW',
    parentId: 'MENU',
    intentName: 'Follow up',
    sortOrder: 6,
  },
];

export const actionsBasic: KBAction[] = [
  {
    actionId: 'a-1',
    intentId: 'WELCOME',
    type: 'redirect',
    payload: { redirectIntent: 'MENU' },
    sortOrder: 1,
  },
  {
    actionId: 'a-2',
    intentId: 'MENU',
    type: 'route',
    payload: {
      dtmfType: 'SINGLE_DIGIT',
      dtmfOptions: [
        { dtmfPattern: '1', dtmfIntent: 'HELP' },
        { dtmfPattern: '0', dtmfIntent: 'AGENT' },
      ],
      nohIntent: 'TIMEOUT',
      followUpIntent: 'FOLLOW',
    },
    sortOrder: 2,
  },
];

export const kbWithActions: KBJson = {
  intents: intentsBasic,
  actions: actionsBasic,
};

export const kbIntentsOnly: KBJson = {
  version: {
    version: 'v1',
    name: 'Test KB',
  },
  intents: [
    {
      intentId: 'ROOT_A',
      parentId: 'ROOT',
      intentName: 'Root A',
      sortOrder: 1,
    },
    {
      intentId: 'CHILD_A1',
      parentId: 'ROOT_A',
      intentName: 'Child A1',
      sortOrder: 2,
    },
  ],
};

export const cycleIntents: KBIntent[] = [
  {
    intentId: 'A',
    parentId: 'ROOT',
    intentName: 'Alpha',
    sortOrder: 1,
  },
  {
    intentId: 'B',
    parentId: 'A',
    intentName: 'Bravo',
    sortOrder: 2,
  },
  {
    intentId: 'C',
    parentId: 'B',
    intentName: 'Charlie',
    sortOrder: 3,
  },
];
