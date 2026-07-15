import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { nanoid } from 'nanoid';
import { NANOID_LENGTH, AI_ID, MAX_HUMANS } from '../shared/constants';
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

describe('Feature: sprint-room, Property 1: Room ID uniqueness and format', () => {
  it('batch-generated IDs are unique, URL-safe, and length 10', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 500 }), (batchSize) => {
        const ids: string[] = [];
        for (let i = 0; i < batchSize; i++) {
          ids.push(nanoid(NANOID_LENGTH));
        }
        for (const id of ids) {
          expect(id).toHaveLength(NANOID_LENGTH);
          expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
        }
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 13: Human capacity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('random join sequences never exceed 3 humans and AI is always present', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc
              .string({ minLength: 1, maxLength: 30 })
              .filter((s) => s.trim().length > 0),
          }),
          { minLength: 4, maxLength: 20 }
        ),
        async (joinAttempts) => {
          const { server, mockRoom } = createServer();
          const joinedHumans: string[] = [];

          for (let i = 0; i < joinAttempts.length; i++) {
            const connId = `user-${i}`;
            const conn = createMockConnection(connId);
            mockRoom.connections.set(connId, conn);
            await server.onConnect(conn as any, connectCtx(joinAttempts[i]!.name));

            if (conn.closed == null) {
              joinedHumans.push(connId);
              const participants = participantsOf(server);
              const connectedHumans = participants.filter(
                (p) => p.type === 'human' && p.isConnected
              );
              expect(connectedHumans.length).toBeLessThanOrEqual(MAX_HUMANS);
              expect(participants.find((p) => p.id === AI_ID)?.type).toBe('ai');
            } else if (joinedHumans.length >= MAX_HUMANS) {
              expect(conn.closed.code).toBe(4003);
            }
          }

          expect(joinedHumans.length).toBeLessThanOrEqual(MAX_HUMANS);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('join sequences with disconnects still enforce capacity and AI presence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({
              action: fc.constant('join' as const),
              name: fc
                .string({ minLength: 1, maxLength: 30 })
                .filter((s) => s.trim().length > 0),
            }),
            fc.record({
              action: fc.constant('disconnect' as const),
              name: fc.constant(''),
            })
          ),
          { minLength: 5, maxLength: 30 }
        ),
        async (actions) => {
          const { server, mockRoom } = createServer();
          const activeConnections: MockConnection[] = [];
          let connectionCounter = 0;

          const initConn = createMockConnection('init-user');
          mockRoom.connections.set('init-user', initConn);
          await server.onConnect(initConn as any, connectCtx('Init'));
          activeConnections.push(initConn);

          for (const act of actions) {
            if (act.action === 'join') {
              const connId = `user-prop-${connectionCounter++}`;
              const conn = createMockConnection(connId);
              mockRoom.connections.set(connId, conn);
              await server.onConnect(conn as any, connectCtx(act.name));
              if (conn.closed == null) {
                activeConnections.push(conn);
              }
            } else if (act.action === 'disconnect' && activeConnections.length > 0) {
              const conn = activeConnections[0]!;
              mockRoom.connections.delete(conn.id);
              server.onClose(conn as any);
              vi.advanceTimersByTime(5001);
              activeConnections.splice(0, 1);
            }
          }

          const humans = participantsOf(server).filter(
            (p) => p.type === 'human' && p.isConnected
          );
          expect(humans.length).toBeLessThanOrEqual(MAX_HUMANS);
          expect(participantsOf(server).find((p) => p.id === AI_ID)?.type).toBe('ai');
        }
      ),
      { numRuns: 100 }
    );
  });
});
