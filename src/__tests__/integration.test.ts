import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { mergeClarifyOutput, mergePlanOutput } from '../server/ai-merge';
import { buildContext } from '../server/context-builder';
import { extractPacketFromDoc, toMarkdown, toJSON } from '../client/export';
import type { ClarifyOutput, SprintPacket } from '../shared/types';

// --- Helpers ---

/** Create a fresh Y.Doc with the standard Sprint Room structure */
function createDoc(): Y.Doc {
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
  return doc;
}

/** Add a raw input to the doc */
function addRawInput(doc: Y.Doc, authorName: string, content: string): void {
  const rawInputs = doc.getArray('rawInputs');
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('id', `input_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    entry.set('authorId', `user_${authorName.toLowerCase()}`);
    entry.set('authorName', authorName);
    entry.set('content', content);
    entry.set('timestamp', Date.now());
    rawInputs.push([entry]);
  });
}

/** Answer a clarification in the doc */
function answerClarification(doc: Y.Doc, questionIndex: number, answer: string, answeredBy: string): void {
  const clarifications = doc.getArray('clarifications');
  const entry = clarifications.get(questionIndex) as Y.Map<any>;
  doc.transact(() => {
    entry.set('answer', answer);
    entry.set('answeredBy', answeredBy);
  });
}

/** Sample ClarifyOutput */
function sampleClarifyOutput(): ClarifyOutput {
  return {
    questions: [
      { id: 'q1', question: 'What is the target user persona?', context: 'Helps scope the MVP' },
      { id: 'q2', question: 'Any hard deadline?', context: 'Affects priority of tasks' },
      { id: 'q3', question: 'Which platforms are in scope?', context: 'Impacts engineering tasks' },
    ],
  };
}

/** Sample SprintPacket (plan output) */
function samplePlanOutput(): SprintPacket {
  return {
    sprintGoal: 'Ship user onboarding flow for web app',
    inScope: ['Sign-up form', 'Email verification', 'Welcome tutorial'],
    outOfScope: ['Social login', 'Mobile native app'],
    tasks: [
      {
        id: 'task_1',
        title: 'Build sign-up form',
        description: 'Create form with email + password fields and validation',
        priority: 'high',
        acceptanceCriteria: ['Form validates email format', 'Password min 8 chars'],
      },
      {
        id: 'task_2',
        title: 'Implement email verification',
        description: 'Send verification email on sign-up',
        priority: 'high',
        acceptanceCriteria: ['Verification email sent within 30s', 'Link expires after 24h'],
      },
      {
        id: 'task_3',
        title: 'Create welcome tutorial',
        description: 'Interactive walkthrough for new users',
        priority: 'medium',
        acceptanceCriteria: ['Tutorial shows 3 key features', 'Can be skipped'],
      },
    ],
    risksAndDependencies: ['Email provider rate limits', 'Design for tutorial not finalized'],
    assumptions: ['Web-only for MVP', 'English-only initially'],
  };
}

// --- Test Suites ---

describe('Integration: Happy path data flow', () => {
  it('complete flow: create → input → clarify → answer → plan → edit → export', () => {
    // 1. Create Y.Doc (simulates room creation)
    const doc = createDoc();

    // 2. Add raw inputs (simulates user contributions)
    addRawInput(doc, 'Alice', 'We need a user onboarding flow');
    addRawInput(doc, 'Bob', 'Must support email verification');
    addRawInput(doc, 'Alice', 'Target: web app only for now');

    // Verify inputs stored
    const rawInputs = doc.getArray('rawInputs');
    expect(rawInputs.length).toBe(3);

    // 3. Clarify: merge AI clarification output
    const clarifyOutput = sampleClarifyOutput();
    mergeClarifyOutput(doc, clarifyOutput);

    // Verify clarifications written
    const clarifications = doc.getArray('clarifications');
    expect(clarifications.length).toBe(3);
    const q1 = clarifications.get(0) as Y.Map<any>;
    expect(q1.get('question')).toBe('What is the target user persona?');
    expect(q1.get('answer')).toBeNull();

    // 4. Answer clarifications (simulates humans answering)
    answerClarification(doc, 0, 'Small-team PMs and engineers', 'Alice');
    answerClarification(doc, 1, 'End of Q1 — 3 weeks out', 'Bob');

    // Verify answers persisted
    expect((clarifications.get(0) as Y.Map<any>).get('answer')).toBe('Small-team PMs and engineers');
    expect((clarifications.get(1) as Y.Map<any>).get('answer')).toBe('End of Q1 — 3 weeks out');

    // 5. Plan: merge AI plan output
    const planOutput = samplePlanOutput();
    mergePlanOutput(doc, planOutput);

    // Verify packet written
    const context = buildContext(doc);
    expect(context.currentPacket).not.toBeNull();
    expect(context.currentPacket!.sprintGoal).toBe('Ship user onboarding flow for web app');
    expect(context.currentPacket!.tasks).toHaveLength(3);

    // 6. Edit: human edits a task title in the packet
    const packetMap = doc.getMap('sprintPacket');
    const tasks = packetMap.get('tasks') as Y.Array<Y.Map<any>>;
    doc.transact(() => {
      const firstTask = tasks.get(0) as Y.Map<any>;
      firstTask.set('title', 'Build sign-up form with SSO prep');
    });

    // 7. Export: verify export reflects the edit
    const packet = extractPacketFromDoc(doc);
    expect(packet).not.toBeNull();
    expect(packet!.tasks[0].title).toBe('Build sign-up form with SSO prep');

    // Markdown export includes all sections
    const md = toMarkdown(packet!);
    expect(md).toContain('# Sprint Goal');
    expect(md).toContain('Ship user onboarding flow for web app');
    expect(md).toContain('## In Scope');
    expect(md).toContain('Sign-up form');
    expect(md).toContain('## Out of Scope');
    expect(md).toContain('Social login');
    expect(md).toContain('## Tasks');
    expect(md).toContain('Build sign-up form with SSO prep');
    expect(md).toContain('## Risks & Dependencies');
    expect(md).toContain('Email provider rate limits');
    expect(md).toContain('## Assumptions');
    expect(md).toContain('Web-only for MVP');

    // JSON export round-trips
    const json = toJSON(packet!);
    const parsed = JSON.parse(json);
    expect(parsed.sprintGoal).toBe('Ship user onboarding flow for web app');
    expect(parsed.tasks[0].title).toBe('Build sign-up form with SSO prep');
    expect(parsed.tasks).toHaveLength(3);
  });
});

describe('Integration: Two-client concurrent edits', () => {
  it('both clients raw inputs are preserved via Yjs sync', () => {
    // Create two Y.Docs representing two clients
    const doc1 = createDoc();
    const doc2 = createDoc();

    // Sync initial state: doc2 = doc1
    const state1 = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, state1);

    // Client 1 adds a raw input
    addRawInput(doc1, 'Alice', 'Feature: dark mode support');

    // Client 2 adds a raw input concurrently
    addRawInput(doc2, 'Bob', 'Bug: login timeout on slow network');

    // Sync: apply doc1's changes to doc2 and vice versa
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc2, update1);
    Y.applyUpdate(doc1, update2);

    // Both docs should have both inputs
    const inputs1 = doc1.getArray('rawInputs');
    const inputs2 = doc2.getArray('rawInputs');

    expect(inputs1.length).toBe(2);
    expect(inputs2.length).toBe(2);

    // Collect content from both docs
    const contents1 = new Set<string>();
    for (let i = 0; i < inputs1.length; i++) {
      contents1.add((inputs1.get(i) as Y.Map<any>).get('content'));
    }

    const contents2 = new Set<string>();
    for (let i = 0; i < inputs2.length; i++) {
      contents2.add((inputs2.get(i) as Y.Map<any>).get('content'));
    }

    expect(contents1.has('Feature: dark mode support')).toBe(true);
    expect(contents1.has('Bug: login timeout on slow network')).toBe(true);
    expect(contents2.has('Feature: dark mode support')).toBe(true);
    expect(contents2.has('Bug: login timeout on slow network')).toBe(true);
  });

  it('concurrent task edits on the same packet are merged', () => {
    // Use a single origin doc and sync to two clients after the plan is written
    const origin = new Y.Doc();
    origin.getMap('meta');
    origin.getArray('rawInputs');
    origin.getArray('clarifications');
    const sp = origin.getMap('sprintPacket');
    origin.transact(() => {
      sp.set('inScope', new Y.Array<string>());
      sp.set('outOfScope', new Y.Array<string>());
      sp.set('tasks', new Y.Array());
      sp.set('risksAndDependencies', new Y.Array<string>());
      sp.set('assumptions', new Y.Array<string>());
    });
    origin.getXmlFragment('notes');

    // Merge plan into origin
    mergePlanOutput(origin, samplePlanOutput());

    // Create two client docs from the origin state
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const originState = Y.encodeStateAsUpdate(origin);
    Y.applyUpdate(doc1, originState);
    Y.applyUpdate(doc2, originState);

    // Verify both have 3 tasks
    const tasks1 = doc1.getMap('sprintPacket').get('tasks') as Y.Array<Y.Map<any>>;
    const tasks2 = doc2.getMap('sprintPacket').get('tasks') as Y.Array<Y.Map<any>>;
    expect(tasks1.length).toBe(3);
    expect(tasks2.length).toBe(3);

    // Client 1 edits task 1 title
    doc1.transact(() => {
      (tasks1.get(0) as Y.Map<any>).set('title', 'Build sign-up form (updated by Alice)');
    });

    // Client 2 edits task 2 title concurrently
    doc2.transact(() => {
      (tasks2.get(1) as Y.Map<any>).set('title', 'Email verification (updated by Bob)');
    });

    // Sync both ways using state vectors for incremental updates
    const sv1 = Y.encodeStateVector(doc1);
    const sv2 = Y.encodeStateVector(doc2);
    const diff1to2 = Y.encodeStateAsUpdate(doc1, sv2);
    const diff2to1 = Y.encodeStateAsUpdate(doc2, sv1);
    Y.applyUpdate(doc2, diff1to2);
    Y.applyUpdate(doc1, diff2to1);

    // Both edits should be preserved in both docs
    const finalTasks1 = doc1.getMap('sprintPacket').get('tasks') as Y.Array<Y.Map<any>>;
    const finalTasks2 = doc2.getMap('sprintPacket').get('tasks') as Y.Array<Y.Map<any>>;

    expect((finalTasks1.get(0) as Y.Map<any>).get('title')).toBe('Build sign-up form (updated by Alice)');
    expect((finalTasks1.get(1) as Y.Map<any>).get('title')).toBe('Email verification (updated by Bob)');
    expect((finalTasks2.get(0) as Y.Map<any>).get('title')).toBe('Build sign-up form (updated by Alice)');
    expect((finalTasks2.get(1) as Y.Map<any>).get('title')).toBe('Email verification (updated by Bob)');
  });
});

describe('Integration: AI working state transitions', () => {
  it('simulates AI action lifecycle: idle → working → idle', () => {
    // This tests the data/state model, not the WebSocket transport
    // Simulates the server-side state machine for AI actions

    type AIStatus = 'idle' | 'working';
    let aiStatus: AIStatus = 'idle';
    let currentAction: string | null = null;

    // Simulate receiving ai-action message
    function dispatchAIAction(action: string): boolean {
      if (aiStatus === 'working') {
        return false; // "AI is busy"
      }
      aiStatus = 'working';
      currentAction = action;
      return true;
    }

    function completeAIAction(): void {
      aiStatus = 'idle';
      currentAction = null;
    }

    // Initial state
    expect(aiStatus).toBe('idle');
    expect(currentAction).toBeNull();

    // Dispatch clarify
    const accepted = dispatchAIAction('clarify');
    expect(accepted).toBe(true);
    expect(aiStatus).toBe('working');
    expect(currentAction).toBe('clarify');

    // Reject concurrent action
    const rejected = dispatchAIAction('plan');
    expect(rejected).toBe(false);
    expect(aiStatus).toBe('working');
    expect(currentAction).toBe('clarify');

    // Complete action
    completeAIAction();
    expect(aiStatus).toBe('idle');
    expect(currentAction).toBeNull();

    // Now plan can proceed
    const accepted2 = dispatchAIAction('plan');
    expect(accepted2).toBe(true);
    expect(aiStatus).toBe('working');
    expect(currentAction).toBe('plan');

    completeAIAction();
    expect(aiStatus).toBe('idle');
  });

  it('AI status transitions correlate with Y.Doc modifications', () => {
    const doc = createDoc();
    addRawInput(doc, 'Alice', 'We need a dashboard');

    // Simulate: AI starts clarify → writes questions → goes idle
    // Before AI action: no clarifications
    expect(doc.getArray('clarifications').length).toBe(0);

    // AI produces output and merges
    mergeClarifyOutput(doc, sampleClarifyOutput());

    // After AI action: clarifications present
    expect(doc.getArray('clarifications').length).toBe(3);

    // Verify context builder sees them
    const context = buildContext(doc);
    expect(context.clarifications).toHaveLength(3);
    expect(context.clarifications[0].question).toBe('What is the target user persona?');
  });
});

describe('Integration: Context builder with full data', () => {
  it('buildContext includes all content types from a fully populated doc', () => {
    const doc = createDoc();

    // Add raw inputs
    addRawInput(doc, 'Alice', 'Need user auth');
    addRawInput(doc, 'Bob', 'Must have API rate limiting');
    addRawInput(doc, 'Charlie', 'Dashboard with charts');

    // Add clarifications with answers
    mergeClarifyOutput(doc, {
      questions: [
        { id: 'cq1', question: 'Which auth provider?', context: 'Affects integration effort' },
        { id: 'cq2', question: 'What rate limits?', context: 'Defines scaling requirements' },
      ],
    });
    answerClarification(doc, 0, 'Auth0 or Firebase', 'Alice');
    answerClarification(doc, 1, '100 req/min per user', 'Bob');

    // Add plan
    mergePlanOutput(doc, samplePlanOutput());

    // Add TipTap notes
    const notes = doc.getXmlFragment('notes');
    doc.transact(() => {
      const p = new Y.XmlElement('p');
      const text = new Y.XmlText();
      text.insert(0, 'Meeting note: agreed on 2-week sprint');
      p.insert(0, [text]);
      notes.push([p]);
    });

    // Build context
    const context = buildContext(doc);

    // Verify completeness
    expect(context.rawInputs.length).toBe(3);
    expect(context.rawInputs.some(r => r.content === 'Need user auth')).toBe(true);
    expect(context.rawInputs.some(r => r.content === 'Must have API rate limiting')).toBe(true);
    expect(context.rawInputs.some(r => r.content === 'Dashboard with charts')).toBe(true);

    expect(context.clarifications.length).toBe(2);
    expect(context.clarifications.filter(c => c.answer !== null).length).toBe(2);

    expect(context.currentPacket).not.toBeNull();
    expect(context.currentPacket!.sprintGoal).toBe('Ship user onboarding flow for web app');
    expect(context.currentPacket!.tasks).toHaveLength(3);

    expect(context.participantNames).toContain('Alice');
    expect(context.participantNames).toContain('Bob');
    expect(context.participantNames).toContain('Charlie');
  });
});

describe('Integration: Export after edits', () => {
  it('plan output → human edits a task title → export reflects the edit', () => {
    const doc = createDoc();

    // AI generates plan
    mergePlanOutput(doc, samplePlanOutput());

    // Verify initial state
    let packet = extractPacketFromDoc(doc);
    expect(packet).not.toBeNull();
    expect(packet!.tasks[0].title).toBe('Build sign-up form');

    // Human edits task title
    const packetMap = doc.getMap('sprintPacket');
    const tasks = packetMap.get('tasks') as Y.Array<Y.Map<any>>;
    doc.transact(() => {
      (tasks.get(0) as Y.Map<any>).set('title', 'Build sign-up form with OAuth');
    });

    // Export reflects the edit
    packet = extractPacketFromDoc(doc);
    expect(packet!.tasks[0].title).toBe('Build sign-up form with OAuth');

    // Markdown contains the edited title
    const md = toMarkdown(packet!);
    expect(md).toContain('Build sign-up form with OAuth');
    expect(md).not.toContain('Build sign-up form**');

    // JSON contains the edited title
    const json = toJSON(packet!);
    const parsed = JSON.parse(json);
    expect(parsed.tasks[0].title).toBe('Build sign-up form with OAuth');
  });

  it('human adds acceptance criteria → export includes them', () => {
    const doc = createDoc();
    mergePlanOutput(doc, samplePlanOutput());

    // Human adds an acceptance criterion to task 1
    const packetMap = doc.getMap('sprintPacket');
    const tasks = packetMap.get('tasks') as Y.Array<Y.Map<any>>;
    doc.transact(() => {
      const task = tasks.get(0) as Y.Map<any>;
      const ac = task.get('acceptanceCriteria') as Y.Array<string>;
      ac.push(['Shows success message after sign-up']);
    });

    // Export reflects the addition
    const packet = extractPacketFromDoc(doc);
    expect(packet!.tasks[0].acceptanceCriteria).toContain('Shows success message after sign-up');
    expect(packet!.tasks[0].acceptanceCriteria).toHaveLength(3);

    const md = toMarkdown(packet!);
    expect(md).toContain('Shows success message after sign-up');
  });

  it('export with empty packet returns null', () => {
    const doc = createDoc();
    const packet = extractPacketFromDoc(doc);
    expect(packet).toBeNull();
  });
});
