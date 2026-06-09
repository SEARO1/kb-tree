import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { parseKBToGraph, checkAllIntentsAdded } from './components/parseKB';

jest.mock('./components/Canvas', () => ({
  __esModule: true,
  default: ({ searchResults, currentResultIndex }: { searchResults: Array<{ id: string }>; currentResultIndex: number }) => (
    <div data-testid="canvas-mock">
      canvas:{searchResults.length}:{currentResultIndex}
    </div>
  ),
}));

jest.mock('./components/JsonUploader', () => ({
  __esModule: true,
  default: ({ onJsonLoaded }: { onJsonLoaded: (data: any) => void }) => (
    <button onClick={() => onJsonLoaded({ intents: [{ intentId: 'A' }], actions: [] })}>
      Load fixture JSON
    </button>
  ),
}));

jest.mock('./components/parseKB', () => ({
  __esModule: true,
  parseKBToGraph: jest.fn(),
  checkAllIntentsAdded: jest.fn(),
}));

const mockedParseKBToGraph = parseKBToGraph as jest.MockedFunction<typeof parseKBToGraph>;
const mockedCheckAllIntentsAdded = checkAllIntentsAdded as jest.MockedFunction<typeof checkAllIntentsAdded>;

describe('App', () => {
  beforeEach(() => {
    mockedParseKBToGraph.mockReset();
    mockedCheckAllIntentsAdded.mockReset();

    mockedParseKBToGraph.mockReturnValue({
      nodes: [
        {
          id: 'A',
          position: { x: 0, y: 0 },
          data: { label: 'Alpha node' },
          type: 'default',
        },
      ],
      edges: [],
    });

    mockedCheckAllIntentsAdded.mockReturnValue({
      allAdded: true,
      totalIntents: 1,
      addedIntents: 1,
      missingIntents: [],
    });
  });

  test('renders current header and initial empty state', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Knowledge Base Visualizer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Knowledge Base Loaded' })).toBeInTheDocument();
    expect(screen.getByText('Click "Load JSON" above to upload a file')).toBeInTheDocument();
    expect(screen.queryByText(/learn react/i)).not.toBeInTheDocument();
  });

  test('toggles uploader visibility and button label', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggleBtn = screen.getByRole('button', { name: '▲ Load JSON' });
    await user.click(toggleBtn);

    expect(screen.getByRole('button', { name: '▼ Hide Loader' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load fixture JSON' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '▼ Hide Loader' }));
    expect(screen.queryByRole('button', { name: 'Load fixture JSON' })).not.toBeInTheDocument();
  });

  test('updates search input and clear button resets search state', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByPlaceholderText('Search by intent name or ID...');
    await user.type(input, 'alpha');
    expect(input).toHaveValue('alpha');

    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: '✕' })).not.toBeInTheDocument();
  });

  test('loads JSON, hides uploader, and can search loaded nodes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '▲ Load JSON' }));
    await user.click(screen.getByRole('button', { name: 'Load fixture JSON' }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-mock')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Load fixture JSON' })).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText('Search by intent name or ID...');
    await user.type(input, 'alpha');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✕' }));
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });

  test('toggling parse option checkboxes re-runs parse with updated options', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '▲ Load JSON' }));
    await user.click(screen.getByRole('button', { name: 'Load fixture JSON' }));

    await waitFor(() => {
      expect(mockedParseKBToGraph).toHaveBeenCalled();
    });

    const splitCheckbox = screen.getByRole('checkbox', { name: 'Split in/out node' });
    expect(splitCheckbox).toBeChecked();

    const callsBeforeToggle = mockedParseKBToGraph.mock.calls.length;
    await user.click(splitCheckbox);

    await waitFor(() => {
      expect(mockedParseKBToGraph.mock.calls.length).toBeGreaterThan(callsBeforeToggle);
    });

    const lastCall = mockedParseKBToGraph.mock.calls[mockedParseKBToGraph.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      splitInboundOutbound: false,
      separateMultiNode: true,
      makeAcyclic: true,
    });
  });
});
