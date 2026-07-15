import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import RoomView, { RoomViewProps } from '../client/pages/RoomView';
import { mergePlanOutput, mergeClarifyOutput } from '../server/ai-merge';
import type { SprintPacket, ClarifyOutput } from '../shared/types';

// Mock the CollaborativeEditor since it depends on TipTap/ProseMirror internals
vi.mock('../client/components/CollaborativeEditor', () => ({
  CollaborativeEditor: () => <div data-testid="collaborative-editor">Editor</div>,
}));

function createMockProvider() {
  const awareness = {
    getStates: () => {
      const states = new Map();
      // Simulate two humans and AI in awareness
      states.set(1, {
        user: { id: 'user_alice', name: 'Alice', type: 'human', color: '#E4572E' },
      });
      states.set(2, {
        user: { id: 'user_bob', name: 'Bob', type: 'human', color: '#F4A261' },
      });
      states.set(3, {
        user: { id: 'ai_agent', name: 'Sprint AI', type: 'ai', color: '#2A9D8F' },
        aiStatus: 'idle',
      });
      return states;
    },
    on: vi.fn(),
    off: vi.fn(),
  };

  return {
    awareness,
    ws: null,
    wsconnected: true,
    synced: true,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as RoomViewProps['provider'];
}

/** Create a fully populated Y.Doc simulating a mid-session state */
function createPopulatedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getArray('rawInputs');
  doc.getArray('clarifications');
  const sp = doc.getMap('sprintPacket');
  doc.transact(() => {
    sp.set('inScope', new Y.Array<string>());
    sp.set('outOfScope', new Y.Array<string>());
    sp.set('tasks', new Y.Array());
    sp.set('risksAndDependencies', new Y.Array<string>());
    sp.set('assumptions', new Y.Array<string>());
  });
  doc.getXmlFragment('notes');

  // Add raw inputs
  const rawInputs = doc.getArray('rawInputs');
  doc.transact(() => {
    const input1 = new Y.Map();
    input1.set('id', 'input_1');
    input1.set('authorId', 'user_alice');
    input1.set('authorName', 'Alice');
    input1.set('content', 'Need user dashboard');
    input1.set('timestamp', Date.now() - 5000);
    rawInputs.push([input1]);

    const input2 = new Y.Map();
    input2.set('id', 'input_2');
    input2.set('authorId', 'user_bob');
    input2.set('authorName', 'Bob');
    input2.set('content', 'API must have rate limiting');
    input2.set('timestamp', Date.now() - 3000);
    rawInputs.push([input2]);
  });

  // Add clarifications (some answered)
  const clarifyOutput: ClarifyOutput = {
    questions: [
      { id: 'q1', question: 'Which metrics on the dashboard?', context: 'Defines scope' },
      { id: 'q2', question: 'What rate limit threshold?', context: 'Affects architecture' },
    ],
  };
  mergeClarifyOutput(doc, clarifyOutput);

  // Answer one clarification
  const clarifications = doc.getArray('clarifications');
  doc.transact(() => {
    (clarifications.get(0) as Y.Map<any>).set('answer', 'Active users and revenue');
    (clarifications.get(0) as Y.Map<any>).set('answeredBy', 'Alice');
  });

  // Add plan
  const planOutput: SprintPacket = {
    sprintGoal: 'Launch analytics dashboard MVP',
    inScope: ['User metrics display', 'Rate limiting middleware'],
    outOfScope: ['Custom report builder'],
    tasks: [
      {
        id: 'task_1',
        title: 'Build metrics API',
        description: 'Create REST endpoint for dashboard data',
        priority: 'high',
        acceptanceCriteria: ['Returns user count', 'Response under 200ms'],
      },
      {
        id: 'task_2',
        title: 'Create dashboard UI',
        description: 'React components for metrics display',
        priority: 'high',
        acceptanceCriteria: ['Shows active users chart', 'Auto-refreshes every 30s'],
      },
    ],
    risksAndDependencies: ['Analytics DB not yet provisioned'],
    assumptions: ['Using existing auth system'],
  };
  mergePlanOutput(doc, planOutput);

  return doc;
}

describe('Integration UI: RoomView with fully populated doc', () => {
  it('renders all sections with populated data visible', () => {
    const doc = createPopulatedDoc();
    const provider = createMockProvider();

    render(
      <RoomView
        roomId="abc1234567"
        userId="user_alice"
        userName="Alice"
        doc={doc}
        provider={provider}
        partyHost="localhost:1999"
        isReconnecting={false}
        onCopyLink={vi.fn()}
      />
    );

    // Header renders
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();

    // Presence bar renders with participants
    expect(screen.getByRole('list', { name: /room participants/i })).toBeDefined();

    // Raw inputs section present
    expect(screen.getByLabelText(/raw inputs/i)).toBeDefined();

    // Clarifications section present
    expect(screen.getByLabelText(/clarifications/i)).toBeDefined();

    // Sprint packet section present
    expect(screen.getByLabelText(/sprint packet/i)).toBeDefined();

    // AI actions section present
    expect(screen.getByLabelText(/ai actions/i)).toBeDefined();

    // Export controls section present
    expect(screen.getByLabelText(/export controls/i)).toBeDefined();

    // Notes / editor present
    expect(screen.getByTestId('collaborative-editor')).toBeDefined();
  });

  it('displays presence for multiple participants including AI', () => {
    const doc = createPopulatedDoc();
    const provider = createMockProvider();

    render(
      <RoomView
        roomId="abc1234567"
        userId="user_alice"
        userName="Alice"
        doc={doc}
        provider={provider}
        partyHost="localhost:1999"
        isReconnecting={false}
        onCopyLink={vi.fn()}
      />
    );

    // The presence bar should show participants (rendered as role="listitem" divs)
    const listItems = screen.getAllByRole('listitem');
    // At least the AI should always appear, plus the humans from awareness
    expect(listItems.length).toBeGreaterThanOrEqual(2);
  });

  it('AI action buttons are enabled when AI is idle', () => {
    const doc = createPopulatedDoc();
    const provider = createMockProvider();

    render(
      <RoomView
        roomId="abc1234567"
        userId="user_alice"
        userName="Alice"
        doc={doc}
        provider={provider}
        partyHost="localhost:1999"
        isReconnecting={false}
        onCopyLink={vi.fn()}
      />
    );

    const clarifyBtn = screen.getByRole('button', { name: /clarify/i });
    const planBtn = screen.getByRole('button', { name: /plan/i });

    // Buttons should be enabled when AI is idle
    expect(clarifyBtn).not.toHaveProperty('disabled', true);
    expect(planBtn).not.toHaveProperty('disabled', true);
  });

  it('export buttons are available when packet exists', () => {
    const doc = createPopulatedDoc();
    const provider = createMockProvider();

    render(
      <RoomView
        roomId="abc1234567"
        userId="user_alice"
        userName="Alice"
        doc={doc}
        provider={provider}
        partyHost="localhost:1999"
        isReconnecting={false}
        onCopyLink={vi.fn()}
      />
    );

    const mdBtn = screen.getByRole('button', { name: /markdown/i });
    const jsonBtn = screen.getByRole('button', { name: /json/i });

    expect(mdBtn).toBeDefined();
    expect(jsonBtn).toBeDefined();
  });

  it('shows reconnecting banner when disconnected', () => {
    const doc = createPopulatedDoc();
    const provider = createMockProvider();

    render(
      <RoomView
        roomId="abc1234567"
        userId="user_alice"
        userName="Alice"
        doc={doc}
        provider={provider}
        partyHost="localhost:1999"
        isReconnecting={true}
        onCopyLink={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });
});
