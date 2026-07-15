import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RoomPage from './RoomPage';

const mockNavigate = vi.fn();
let mockParticipantName: string | undefined;
let mockStatus = 'disconnected';
const mockSetLocalStateField = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../hooks/useYDoc', () => {
  const Y = require('yjs');
  return {
    useYDoc: () => {
      const doc = new Y.Doc();
      doc.getMap('meta');
      doc.getArray('rawInputs');
      doc.getArray('clarifications');
      const sp = doc.getMap('sprintPacket');
      doc.transact(() => {
        sp.set('inScope', new Y.Array());
        sp.set('outOfScope', new Y.Array());
        sp.set('tasks', new Y.Array());
        sp.set('risksAndDependencies', new Y.Array());
        sp.set('assumptions', new Y.Array());
      });
      doc.getXmlFragment('notes');
      return doc;
    },
  };
});

vi.mock('../hooks/usePartyProvider', () => ({
  usePartyProvider: (_roomId: string, _doc: unknown, opts: { participantName?: string } = {}) => {
    mockParticipantName = opts.participantName;
    const connected = Boolean(opts.participantName);
    mockStatus = connected ? 'connected' : 'disconnected';
    return {
      provider: connected
        ? {
            ws: { readyState: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() },
            awareness: { setLocalStateField: mockSetLocalStateField, getStates: () => new Map(), on: vi.fn(), off: vi.fn() },
          }
        : null,
      status: mockStatus,
      isReconnecting: false,
      host: 'localhost:1999',
    };
  },
}));

vi.mock('./RoomView', () => ({
  default: ({ userName }: { userName: string }) => (
    <div>
      <h1>Sprint Room</h1>
      <p>Joined as {userName}</p>
    </div>
  ),
}));

function renderRoomPage(roomId = 'abc1234567', initialStatus?: 'join-gate' | 'joined' | 'not-found') {
  return render(
    <MemoryRouter initialEntries={[`/room/${roomId}`]}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomPage initialStatus={initialStatus} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RoomPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetLocalStateField.mockClear();
    mockParticipantName = undefined;
  });

  describe('Join gate', () => {
    it('renders join heading', () => {
      renderRoomPage();
      expect(screen.getByRole('heading', { name: /join sprint room/i })).toBeDefined();
    });

    it('renders display name input', () => {
      renderRoomPage();
      expect(screen.getByLabelText(/display name/i).getAttribute('maxLength')).toBe('30');
    });

    it('shows room link containing the roomId', () => {
      renderRoomPage('testroom12');
      expect(screen.getByText(/\/room\/testroom12/)).toBeDefined();
    });

    it('shows error when name is empty on join', () => {
      renderRoomPage();
      fireEvent.click(screen.getByRole('button', { name: /^join$/i }));
      expect(screen.getByText(/name must be 1–30 characters/i)).toBeDefined();
    });

    it('joins by connecting with display name (no JSON on Yjs socket)', async () => {
      renderRoomPage();
      fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Alice' } });
      fireEvent.click(screen.getByRole('button', { name: /^join$/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^sprint room$/i })).toBeDefined();
      });
      expect(mockParticipantName).toBe('Alice');
      expect(mockSetLocalStateField).toHaveBeenCalledWith(
        'user',
        expect.objectContaining({ name: 'Alice', type: 'human' })
      );
    });

    it('joins on Enter key press', async () => {
      renderRoomPage();
      const input = screen.getByLabelText(/display name/i);
      fireEvent.change(input, { target: { value: 'Bob' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => {
        expect(screen.getByText(/joined as bob/i)).toBeDefined();
      });
    });
  });

  describe('Not-found state', () => {
    it('shows Room Not Found heading', () => {
      renderRoomPage('expired123', 'not-found');
      expect(screen.getByRole('heading', { name: /room not found/i })).toBeDefined();
    });

    it('navigates home from Create new room', () => {
      renderRoomPage('expired123', 'not-found');
      fireEvent.click(screen.getByRole('button', { name: /create new room/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});
