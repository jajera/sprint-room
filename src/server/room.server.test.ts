import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Participant, RoomState } from '../shared/types';
import { MAX_HUMANS, AI_ID, AI_NAME, ROOM_EXPIRY_MS } from '../shared/constants';

vi.mock('y-partykit', () => ({
  onConnect: vi.fn(),
  unstable_getYDoc: vi.fn(() => {
    const store = new Map();
    return Promise.resolve({
      getArray: vi.fn(() => ({ length: 0, get: vi.fn() })),
      getMap: vi.fn(() => ({
        get: (k: string) => store.get(k),
        set: (k: string, v: unknown) => store.set(k, v),
      })),
      getXmlFragment: vi.fn(() => ({ length: 0, get: vi.fn() })),
      transact: (fn: () => void) => fn(),
    });
  }),
}));

const clarifyHold = vi.hoisted(() => ({
  pending: null as null | { resolve: (v: unknown) => void },
}));

vi.mock('./ai-handler', () => ({
  createAIHandler: vi.fn(() => ({
    clarify: vi.fn(
      () =>
        new Promise((resolve) => {
          clarifyHold.pending = { resolve };
        })
    ),
    plan: vi.fn(() =>
      Promise.resolve({
        sprintGoal: 'Test goal',
        inScope: [],
        outOfScope: [],
        tasks: [],
        risksAndDependencies: [],
      })
    ),
    breakDown: vi.fn(() =>
      Promise.resolve({
        parentTaskId: 'task-1',
        parentTaskTitle: 'Test task',
        subtasks: [],
      })
    ),
  })),
  AITimeoutError: class AITimeoutError extends Error {
    constructor() {
      super('AI took too long — try again');
      this.name = 'AITimeoutError';
    }
  },
}));

vi.mock('./context-builder', () => ({
  buildContext: vi.fn(() => ({
    rawInputs: [],
    clarifications: [],
    currentPacket: null,
    participantNames: [],
  })),
}));

vi.mock('./ai-merge', () => ({
  mergeClarifyOutput: vi.fn(),
  mergePlanOutput: vi.fn(),
  mergeBreakDownOutput: vi.fn(),
  handleMergeError: vi.fn(),
}));

import SprintRoomServer from './room.server';

interface MockConnection {
  id: string;
  closed: { code?: number; reason?: string } | null;
  send(): void;
  close(code?: number, reason?: string): void;
}

function createMockConnection(id: string): MockConnection {
  return {
    id,
    closed: null,
    send() {},
    close(code?: number, reason?: string) {
      this.closed = { code, reason };
    },
  };
}

interface MockRoom {
  id: string;
  connections: Map<string, MockConnection>;
  getConnections(): IterableIterator<MockConnection>;
}

function createMockRoom(id = 'test-room-1'): MockRoom {
  const connections = new Map<string, MockConnection>();
  return {
    id,
    connections,
    getConnections() {
      return connections.values();
    },
  };
}

function createServer(roomId = 'test-room-1') {
  const mockRoom = createMockRoom(roomId);
  const server = new SprintRoomServer(mockRoom as any);
  return { server, mockRoom };
}

function connectCtx(name: string) {
  return {
    request: {
      url: `http://127.0.0.1:1999/parties/main/test-room?name=${encodeURIComponent(name)}`,
    },
  } as any;
}

async function joinRoom(
  server: SprintRoomServer,
  mockRoom: MockRoom,
  conn: MockConnection,
  name: string
): Promise<void> {
  mockRoom.connections.set(conn.id, conn);
  await server.onConnect(conn as any, connectCtx(name));
}

function participantsOf(server: SprintRoomServer): Participant[] {
  return Array.from((server as any).participants.values());
}

function roomStateOf(server: SprintRoomServer): RoomState | null {
  return (server as any).roomState;
}

async function postAi(
  server: SprintRoomServer,
  action: 'clarify' | 'plan' | 'break-down',
  targetTaskId?: string
): Promise<Response> {
  return server.onRequest(
    new Request('http://127.0.0.1:1999/parties/main/test-room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'ai-action', action, targetTaskId }),
    }) as any
  );
}

describe('SprintRoomServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clarifyHold.pending = null;
  });

  describe('Room initialization', () => {
    it('seeds AI participant on first connection', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'Alice');

      const ai = participantsOf(server).find((p) => p.id === AI_ID);
      expect(ai).toBeDefined();
      expect(ai!.name).toBe(AI_NAME);
      expect(ai!.type).toBe('ai');
      expect(ai!.isConnected).toBe(true);
    });

    it('sets room status to active on creation', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'Alice');

      const state = roomStateOf(server);
      expect(state?.status).toBe('active');
      expect(state?.id).toBe('test-room-1');
    });
  });

  describe('Join handling', () => {
    it('adds human participant with correct name and type', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'Alice');

      const human = participantsOf(server).find((p) => p.id === 'user-1');
      expect(human).toMatchObject({
        name: 'Alice',
        type: 'human',
        isConnected: true,
      });
      expect(conn.closed).toBeNull();
    });

    it('trims display name whitespace', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, '  Bob  ');

      expect(participantsOf(server).find((p) => p.id === 'user-1')!.name).toBe('Bob');
    });

    it('rejects empty name with close 4001', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      mockRoom.connections.set(conn.id, conn);
      await server.onConnect(conn as any, connectCtx('   '));

      expect(conn.closed?.code).toBe(4001);
    });

    it('rejects name longer than 30 characters with close 4001', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      mockRoom.connections.set(conn.id, conn);
      await server.onConnect(conn as any, connectCtx('A'.repeat(31)));

      expect(conn.closed?.code).toBe(4001);
    });

    it('accepts name exactly 1 character', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'A');
      expect(conn.closed).toBeNull();
      expect(participantsOf(server).some((p) => p.id === 'user-1')).toBe(true);
    });

    it('accepts name exactly 30 characters', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'A'.repeat(30));
      expect(conn.closed).toBeNull();
    });
  });

  describe('Capacity enforcement', () => {
    it('allows up to 3 humans to join', async () => {
      const { server, mockRoom } = createServer();
      for (let i = 1; i <= 3; i++) {
        const conn = createMockConnection(`user-${i}`);
        await joinRoom(server, mockRoom, conn, `Human${i}`);
        expect(conn.closed).toBeNull();
      }
      expect(participantsOf(server).filter((p) => p.type === 'human')).toHaveLength(3);
    });

    it('rejects 4th human with close 4003', async () => {
      const { server, mockRoom } = createServer();
      for (let i = 1; i <= 3; i++) {
        await joinRoom(server, mockRoom, createMockConnection(`user-${i}`), `Human${i}`);
      }

      const conn4 = createMockConnection('user-4');
      await joinRoom(server, mockRoom, conn4, 'Human4');
      expect(conn4.closed?.code).toBe(4003);
      expect(conn4.closed?.reason).toContain('Room is full');
    });

    it('AI participant does not consume a human slot', async () => {
      const { server, mockRoom } = createServer();
      for (let i = 1; i <= 3; i++) {
        await joinRoom(server, mockRoom, createMockConnection(`user-${i}`), `Human${i}`);
      }
      const all = participantsOf(server);
      expect(all.find((p) => p.id === AI_ID)).toBeDefined();
      expect(all.filter((p) => p.type === 'human').length).toBe(MAX_HUMANS);
      expect(all.length).toBe(MAX_HUMANS + 1);
    });
  });

  describe('Disconnect handling', () => {
    it('removes human from presence after 5 seconds', async () => {
      const { server, mockRoom } = createServer();
      const conn = createMockConnection('user-1');
      await joinRoom(server, mockRoom, conn, 'Alice');
      await joinRoom(server, mockRoom, createMockConnection('user-2'), 'Bob');

      mockRoom.connections.delete('user-1');
      server.onClose(conn as any);

      vi.advanceTimersByTime(4999);
      expect(participantsOf(server).some((p) => p.id === 'user-1')).toBe(true);

      vi.advanceTimersByTime(1);
      expect(participantsOf(server).some((p) => p.id === 'user-1')).toBe(false);
    });

    it('allows a new human to join after disconnect timeout frees a slot', async () => {
      const { server, mockRoom } = createServer();
      for (let i = 1; i <= 3; i++) {
        await joinRoom(server, mockRoom, createMockConnection(`user-${i}`), `Human${i}`);
      }

      const leaving = createMockConnection('user-1');
      mockRoom.connections.delete('user-1');
      server.onClose(leaving as any);
      vi.advanceTimersByTime(5000);

      const conn4 = createMockConnection('user-4');
      await joinRoom(server, mockRoom, conn4, 'Human4');
      expect(conn4.closed).toBeNull();
    });
  });

  describe('Room expiry', () => {
    it('rejects connections to expired rooms with close code 4004', async () => {
      const { server, mockRoom } = createServer();
      await joinRoom(server, mockRoom, createMockConnection('user-1'), 'Alice');

      vi.advanceTimersByTime(ROOM_EXPIRY_MS);

      const conn2 = createMockConnection('user-2');
      await joinRoom(server, mockRoom, conn2, 'Bob');
      expect(conn2.closed?.code).toBe(4004);
    });
  });

  describe('AI actions via HTTP', () => {
    it('starts AI action and marks busy', async () => {
      const { server, mockRoom } = createServer();
      await joinRoom(server, mockRoom, createMockConnection('user-1'), 'Alice');

      const res = await postAi(server, 'clarify');
      expect(res.status).toBe(200);
      expect(roomStateOf(server)?.aiActionInProgress).toBe(true);
      expect(roomStateOf(server)?.currentAiAction).toBe('clarify');
    });

    it('rejects concurrent AI actions with 409', async () => {
      const { server, mockRoom } = createServer();
      await joinRoom(server, mockRoom, createMockConnection('user-1'), 'Alice');

      // clarify hangs until pendingClarify.resolve — keeps busy flag set
      const res1 = await postAi(server, 'clarify');
      expect(res1.status).toBe(200);

      const res2 = await postAi(server, 'plan');
      expect(res2.status).toBe(409);
      const body = await res2.json();
      expect(body.error).toBe('AI is busy');

      clarifyHold.pending?.resolve({ questions: [] });
    });

    it('allows new AI action after reset', async () => {
      const { server, mockRoom } = createServer();
      await joinRoom(server, mockRoom, createMockConnection('user-1'), 'Alice');

      await postAi(server, 'clarify');
      expect(roomStateOf(server)?.aiActionInProgress).toBe(true);
      server.resetAiAction();
      const res = await postAi(server, 'plan');
      expect(res.status).toBe(200);
      expect(roomStateOf(server)?.currentAiAction).toBe('plan');
      clarifyHold.pending?.resolve({ questions: [] });
    });
  });
});
