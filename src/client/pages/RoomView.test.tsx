import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import RoomView, { RoomViewProps, ERROR_DISMISS_MS } from './RoomView';

// Mock the CollaborativeEditor since it depends on TipTap internals
vi.mock('../components/CollaborativeEditor', () => ({
  CollaborativeEditor: () => <div data-testid="collaborative-editor">Editor</div>,
}));

function createMockProvider() {
  const awareness = {
    getStates: () => new Map(),
    on: vi.fn(),
    off: vi.fn(),
  };

  // Create a minimal mock WebSocket with event listener support
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const ws = {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
    addEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    removeEventListener: (type: string, handler: (...args: unknown[]) => void) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((h) => h !== handler);
      }
    },
    // Helper to simulate incoming messages
    _simulateMessage: (data: unknown) => {
      const event = { data: JSON.stringify(data) } as MessageEvent;
      (listeners['message'] || []).forEach((h) => h(event));
    },
    _getListeners: () => listeners,
  };

  return {
    awareness,
    ws,
    wsconnected: true,
    synced: true,
    on: vi.fn(),
    off: vi.fn(),
    _ws: ws,
  } as unknown as RoomViewProps['provider'] & { _ws: typeof ws };
}

function renderRoomView(overrides: Partial<RoomViewProps> = {}) {
  const doc = new Y.Doc();
  // Initialize doc structure as useYDoc does
  doc.getMap('meta');
  doc.getArray('rawInputs');
  doc.getArray('clarifications');
  const sprintPacket = doc.getMap('sprintPacket');
  doc.transact(() => {
    sprintPacket.set('inScope', new Y.Array<string>());
    sprintPacket.set('outOfScope', new Y.Array<string>());
    sprintPacket.set('tasks', new Y.Array());
    sprintPacket.set('risksAndDependencies', new Y.Array<string>());
    sprintPacket.set('assumptions', new Y.Array<string>());
  });
  doc.getXmlFragment('notes');

  const mockProvider = createMockProvider();
  const defaults: RoomViewProps = {
    roomId: 'test123456',
    userId: 'user_alice',
    userName: 'Alice',
    doc,
    provider: mockProvider as unknown as RoomViewProps['provider'],
    partyHost: 'localhost:1999',
    isReconnecting: false,
    onCopyLink: vi.fn(),
  };

  const result = render(<RoomView {...defaults} {...overrides} />);
  return { ...result, mockProvider, doc };
}

describe('RoomView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the Sprint Room header', () => {
    renderRoomView();
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
  });

  it('renders the Copy link button in header', () => {
    renderRoomView();
    expect(screen.getByRole('button', { name: /copy room link/i })).toBeDefined();
  });

  it('renders presence bar (room participants list)', () => {
    renderRoomView();
    expect(screen.getByRole('list', { name: /room participants/i })).toBeDefined();
  });

  it('renders Raw Inputs section', () => {
    renderRoomView();
    expect(screen.getByRole('region', { name: /raw inputs/i }) ?? screen.getByLabelText(/raw inputs/i)).toBeDefined();
  });

  it('renders Clarifications section', () => {
    renderRoomView();
    expect(screen.getByLabelText(/clarifications/i)).toBeDefined();
  });

  it('renders Sprint Packet section', () => {
    renderRoomView();
    expect(screen.getByLabelText(/sprint packet/i)).toBeDefined();
  });

  it('renders Freeform notes section', () => {
    renderRoomView();
    expect(screen.getByLabelText(/freeform notes/i)).toBeDefined();
  });

  it('renders AI Actions section', () => {
    renderRoomView();
    expect(screen.getByLabelText(/ai actions/i)).toBeDefined();
  });

  it('renders Export Controls section', () => {
    renderRoomView();
    expect(screen.getByLabelText(/export controls/i)).toBeDefined();
  });

  it('renders collaborative editor', () => {
    renderRoomView();
    expect(screen.getByTestId('collaborative-editor')).toBeDefined();
  });

  it('shows reconnecting banner when isReconnecting is true', () => {
    renderRoomView({ isReconnecting: true });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });

  it('does not show reconnecting banner when connected', () => {
    renderRoomView({ isReconnecting: false });
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
  });

  it('calls onCopyLink when Copy link button is clicked', () => {
    const onCopyLink = vi.fn();
    renderRoomView({ onCopyLink });
    screen.getByRole('button', { name: /copy room link/i }).click();
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it('renders all AI action buttons (Clarify, Plan, Break Down)', () => {
    renderRoomView();
    expect(screen.getByRole('button', { name: /clarify/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /plan/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /break down/i })).toBeDefined();
  });

  it('renders export buttons (Markdown, JSON)', () => {
    renderRoomView();
    expect(screen.getByRole('button', { name: /markdown/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /json/i })).toBeDefined();
  });

  describe('Error toasts via Y.Map meta', () => {
    it('displays error toast when meta.lastError is set', () => {
      const { doc } = renderRoomView();
      act(() => {
        doc.getMap('meta').set('lastError', 'Something went wrong');
      });
      expect(screen.getByText('Something went wrong')).toBeDefined();
      expect(screen.getByTestId('error-toast')).toBeDefined();
    });

    it('does not toast a lastError already present when joining', () => {
      const doc = new Y.Doc();
      doc.getMap('meta');
      doc.getArray('rawInputs');
      doc.getArray('clarifications');
      const sprintPacket = doc.getMap('sprintPacket');
      doc.transact(() => {
        sprintPacket.set('inScope', new Y.Array<string>());
        sprintPacket.set('outOfScope', new Y.Array<string>());
        sprintPacket.set('tasks', new Y.Array());
        sprintPacket.set('risksAndDependencies', new Y.Array<string>());
        sprintPacket.set('assumptions', new Y.Array<string>());
      });
      doc.getXmlFragment('notes');
      doc.getMap('meta').set('lastError', 'Stale credentials error');

      renderRoomView({ doc });
      expect(screen.queryByText('Stale credentials error')).toBeNull();
    });

    it('auto-dismisses error toasts after ERROR_DISMISS_MS', () => {
      const { doc } = renderRoomView();
      act(() => {
        doc.getMap('meta').set('lastError', 'Temporary error');
      });
      expect(screen.getByText('Temporary error')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(ERROR_DISMISS_MS);
      });
      expect(screen.queryByText('Temporary error')).toBeNull();
    });

    it('sets AI working from meta.aiStatus and clears on idle + error', () => {
      const { doc } = renderRoomView();
      act(() => {
        doc.getMap('meta').set('aiStatus', 'clarifying');
      });
      expect(screen.getByText(/ai is working/i)).toBeDefined();

      act(() => {
        doc.getMap('meta').set('aiStatus', 'idle');
        doc.getMap('meta').set('lastError', 'AI took too long — try again');
      });

      expect(screen.getByText('AI took too long — try again')).toBeDefined();
      const clarifyBtn = screen.getByRole('button', { name: /clarify/i });
      expect(clarifyBtn.hasAttribute('disabled')).toBe(false);
    });
  });
});
