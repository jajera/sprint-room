import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import type { Participant } from '../shared/types';

vi.mock('y-partykit', () => ({
  onConnect: vi.fn(),
  unstable_getYDoc: vi.fn(() =>
    Promise.resolve({
      getArray: vi.fn(() => ({ length: 0 })),
      getMap: vi.fn(() => ({ get: vi.fn(), set: vi.fn() })),
      getXmlFragment: vi.fn(() => ({ length: 0 })),
      transact: (fn: () => void) => fn(),
    })
  ),
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

function createServer(roomId = 'test-room-1') {
  const connections = new Map<string, MockConnection>();
  const mockRoom = {
    id: roomId,
    connections,
    getConnections() {
      return connections.values();
    },
  };
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

function participantsOf(server: SprintRoomServer): Participant[] {
  return Array.from((server as any).participants.values());
}

const validDisplayNameArb = fc
  .stringOf(
    fc.char().filter((c) => c.trim().length > 0),
    { minLength: 1, maxLength: 30 }
  )
  .map((s) => {
    const trimmed = s.trim();
    return trimmed.length > 0 && trimmed.length <= 30 ? s : s.slice(0, 30);
  })
  .filter((s) => {
    const trimmed = s.trim();
    return trimmed.length >= 1 && trimmed.length <= 30;
  });

/**
 * Feature: sprint-room, Property 2: Participant join adds to room state
 * Join is via WebSocket ?name= (not WS JSON).
 */
describe('Feature: sprint-room, Property 2: Participant join adds to room state', () => {
  it('joining with any valid name adds a human participant with correct name and type', async () => {
    await fc.assert(
      fc.asyncProperty(validDisplayNameArb, async (name) => {
        const { server, mockRoom } = createServer();
        const conn = createMockConnection('user-1');
        mockRoom.connections.set(conn.id, conn);

        await server.onConnect(conn as any, connectCtx(name));

        expect(conn.closed).toBeNull();
        const human = participantsOf(server).find((p) => p.id === 'user-1');
        expect(human).toBeDefined();
        expect(human!.name).toBe(name.trim());
        expect(human!.type).toBe('human');
        expect(human!.isConnected).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('participant type is always human for any joined user', async () => {
    await fc.assert(
      fc.asyncProperty(validDisplayNameArb, async (name) => {
        const { server, mockRoom } = createServer();
        const conn = createMockConnection('participant-abc');
        mockRoom.connections.set(conn.id, conn);
        await server.onConnect(conn as any, connectCtx(name));

        const human = participantsOf(server).find((p) => p.id === 'participant-abc');
        expect(human!.type).toBe('human');
      }),
      { numRuns: 100 }
    );
  });

  it('no account or auth is required - only a name is needed to join', async () => {
    await fc.assert(
      fc.asyncProperty(validDisplayNameArb, async (name) => {
        const { server, mockRoom } = createServer();
        const conn = createMockConnection('no-auth-user');
        mockRoom.connections.set(conn.id, conn);
        await server.onConnect(conn as any, connectCtx(name));

        expect(conn.closed).toBeNull();
        expect(participantsOf(server).some((p) => p.id === 'no-auth-user')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
