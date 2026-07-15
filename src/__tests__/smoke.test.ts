import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import { NANOID_LENGTH } from '@shared/constants';
import { hasPacket, extractPacketFromDoc, toMarkdown, toJSON } from '@client/export';

// Mock y-partykit for server import
vi.mock('y-partykit', () => ({
  onConnect: vi.fn(),
  unstable_getYDoc: vi.fn(() => Promise.resolve(new Y.Doc())),
}));

// Mock AI handler
vi.mock('../server/ai-handler', () => ({
  createAIHandler: vi.fn(() => ({
    clarify: vi.fn(),
    plan: vi.fn(),
    breakDown: vi.fn(),
  })),
  AITimeoutError: class AITimeoutError extends Error {
    constructor() {
      super('AI took too long — try again');
      this.name = 'AITimeoutError';
    }
  },
}));

// Mock context builder
vi.mock('../server/context-builder', () => ({
  buildContext: vi.fn(() => ({
    rawInputs: [],
    clarifications: [],
    currentPacket: null,
    participantNames: [],
  })),
}));

// Mock AI merge functions
vi.mock('../server/ai-merge', () => ({
  mergeClarifyOutput: vi.fn(),
  mergePlanOutput: vi.fn(),
  mergeBreakDownOutput: vi.fn(),
  handleMergeError: vi.fn(),
}));

describe('Smoke Tests', () => {
  describe('Room create yields valid ID', () => {
    it('generates an ID with correct length and URL-safe characters', () => {
      const id = nanoid(NANOID_LENGTH);

      expect(id).toHaveLength(10);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('Server accepts connection for valid room', () => {
    it('onConnect does not close connection for a valid room', async () => {
      const SprintRoomServer = (await import('../server/room.server')).default;

      const connections = new Map();
      const mockRoom = {
        id: 'test-smoke1',
        connections,
        getConnections: () => connections.values(),
      };

      const mockConnection = {
        id: 'conn-1',
        sent: [] as string[],
        closed: null as { code?: number; reason?: string } | null,
        send(data: string) { this.sent.push(data); },
        close(code?: number, reason?: string) { this.closed = { code, reason }; },
      };

      connections.set(mockConnection.id, mockConnection);

      const server = new SprintRoomServer(mockRoom as any);
      server.onConnect(mockConnection as any, {} as any);

      // Connection should NOT be closed
      expect(mockConnection.closed).toBeNull();
    });
  });

  describe('Editor mounts without crashing', () => {
    it('renders a textbox role element', async () => {
      const { render, screen } = await import('@testing-library/react');
      const React = await import('react');
      const { CollaborativeEditor } = await import(
        '../client/components/CollaborativeEditor'
      );

      const doc = new Y.Doc();
      doc.getXmlFragment('notes');

      const mockProvider = {
        awareness: {
          clientID: 1,
          getLocalState: vi.fn(() => ({})),
          setLocalStateField: vi.fn(),
          getStates: vi.fn(() => new Map()),
          on: vi.fn(),
          off: vi.fn(),
          destroy: vi.fn(),
        },
        on: vi.fn(),
        off: vi.fn(),
      } as any;

      render(
        React.createElement(CollaborativeEditor, { doc, provider: mockProvider })
      );

      const editor = screen.getByRole('textbox');
      expect(editor).toBeDefined();

      doc.destroy();
    });
  });

  describe('Export produces non-empty content when packet exists', () => {
    let doc: Y.Doc;

    beforeEach(() => {
      doc = new Y.Doc();
    });

    afterEach(() => {
      doc.destroy();
    });

    function seedPacket(doc: Y.Doc) {
      const packetMap = doc.getMap('sprintPacket');
      packetMap.set('sprintGoal', 'Ship the MVP');

      const inScope = new Y.Array<string>();
      inScope.push(['Feature A', 'Feature B']);
      packetMap.set('inScope', inScope);

      const outOfScope = new Y.Array<string>();
      outOfScope.push(['Feature C']);
      packetMap.set('outOfScope', outOfScope);

      const tasks = new Y.Array<Y.Map<any>>();
      const task = new Y.Map<any>();
      task.set('id', 'task-1');
      task.set('title', 'Build login');
      task.set('description', 'Implement login flow');
      task.set('priority', 'high');
      const ac = new Y.Array<string>();
      ac.push(['User can log in']);
      task.set('acceptanceCriteria', ac);
      tasks.push([task]);
      packetMap.set('tasks', tasks);

      const risks = new Y.Array<string>();
      risks.push(['Tight timeline']);
      packetMap.set('risksAndDependencies', risks);
    }

    it('toMarkdown returns non-empty string containing the sprint goal', () => {
      seedPacket(doc);

      const packet = extractPacketFromDoc(doc);
      expect(packet).not.toBeNull();

      const md = toMarkdown(packet!);
      expect(md.length).toBeGreaterThan(0);
      expect(md).toContain('Ship the MVP');
    });

    it('toJSON returns valid JSON', () => {
      seedPacket(doc);

      const packet = extractPacketFromDoc(doc);
      expect(packet).not.toBeNull();

      const json = toJSON(packet!);
      expect(json.length).toBeGreaterThan(0);

      const parsed = JSON.parse(json);
      expect(parsed.sprintGoal).toBe('Ship the MVP');
      expect(parsed.tasks).toHaveLength(1);
    });
  });

  describe('hasPacket returns true when goal is set', () => {
    it('returns true after setting sprintGoal', () => {
      const doc = new Y.Doc();
      const packetMap = doc.getMap('sprintPacket');

      // Before setting goal
      expect(hasPacket(doc)).toBe(false);

      // After setting goal
      packetMap.set('sprintGoal', 'Deliver sprint planning');
      expect(hasPacket(doc)).toBe(true);

      doc.destroy();
    });
  });
});
