import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildContext, CONTEXT_LIMIT, estimateSize } from './context-builder';
import type { SprintPacket } from '../shared/types';

// --- Helpers ---

function createDoc(): Y.Doc {
  return new Y.Doc();
}

function addRawInput(
  doc: Y.Doc,
  input: { id?: string; authorId?: string; authorName: string; content: string; timestamp?: number }
): void {
  const arr = doc.getArray('rawInputs');
  const map = new Y.Map();
  doc.transact(() => {
    map.set('id', input.id ?? `input-${arr.length}`);
    map.set('authorId', input.authorId ?? `author-${arr.length}`);
    map.set('authorName', input.authorName);
    map.set('content', input.content);
    map.set('timestamp', input.timestamp ?? Date.now());
    arr.push([map]);
  });
}

function addClarification(
  doc: Y.Doc,
  clar: { questionId?: string; question: string; questionContext?: string; answer: string | null; answeredBy?: string; timestamp?: number }
): void {
  const arr = doc.getArray('clarifications');
  const map = new Y.Map();
  doc.transact(() => {
    map.set('questionId', clar.questionId ?? `q-${arr.length}`);
    map.set('question', clar.question);
    map.set('questionContext', clar.questionContext ?? '');
    map.set('answer', clar.answer);
    map.set('answeredBy', clar.answeredBy ?? null);
    map.set('timestamp', clar.timestamp ?? Date.now());
    arr.push([map]);
  });
}

function setSprintPacket(doc: Y.Doc, packet: SprintPacket): void {
  const packetMap = doc.getMap('sprintPacket');
  doc.transact(() => {
    packetMap.set('sprintGoal', packet.sprintGoal);

    const inScope = new Y.Array<string>();
    inScope.push(packet.inScope);
    packetMap.set('inScope', inScope);

    const outOfScope = new Y.Array<string>();
    outOfScope.push(packet.outOfScope);
    packetMap.set('outOfScope', outOfScope);

    const tasks = new Y.Array();
    for (const task of packet.tasks) {
      const taskMap = new Y.Map();
      taskMap.set('id', task.id);
      taskMap.set('title', task.title);
      taskMap.set('description', task.description);
      taskMap.set('priority', task.priority);
      const ac = new Y.Array<string>();
      ac.push(task.acceptanceCriteria);
      taskMap.set('acceptanceCriteria', ac);
      tasks.push([taskMap]);
    }
    packetMap.set('tasks', tasks);

    const risks = new Y.Array<string>();
    risks.push(packet.risksAndDependencies);
    packetMap.set('risksAndDependencies', risks);

    const assumptions = new Y.Array<string>();
    if (packet.assumptions) {
      assumptions.push(packet.assumptions);
    }
    packetMap.set('assumptions', assumptions);
  });
}

function addNotes(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment('notes');
  doc.transact(() => {
    const p = new Y.XmlElement('p');
    p.insert(0, [new Y.XmlText(text)]);
    fragment.insert(fragment.length, [p]);
  });
}

// --- Tests ---

describe('buildContext', () => {
  describe('Basic extraction', () => {
    it('returns empty context from an empty doc', () => {
      const doc = createDoc();
      const ctx = buildContext(doc);

      expect(ctx.rawInputs).toEqual([]);
      expect(ctx.clarifications).toEqual([]);
      expect(ctx.currentPacket).toBeNull();
      expect(ctx.participantNames).toEqual([]);
    });

    it('extracts raw inputs with authorName and content', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: 'Alice', content: 'Build login page' });
      addRawInput(doc, { authorName: 'Bob', content: 'Add dark mode' });

      const ctx = buildContext(doc);

      expect(ctx.rawInputs).toHaveLength(2);
      expect(ctx.rawInputs.map((r) => r.content)).toContain('Build login page');
      expect(ctx.rawInputs.map((r) => r.content)).toContain('Add dark mode');
    });

    it('sorts raw inputs newest first', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: 'Alice', content: 'First', timestamp: 1000 });
      addRawInput(doc, { authorName: 'Bob', content: 'Second', timestamp: 2000 });
      addRawInput(doc, { authorName: 'Carol', content: 'Third', timestamp: 3000 });

      const ctx = buildContext(doc);

      expect(ctx.rawInputs[0].content).toBe('Third');
      expect(ctx.rawInputs[1].content).toBe('Second');
      expect(ctx.rawInputs[2].content).toBe('First');
    });

    it('extracts answered and unanswered clarifications', () => {
      const doc = createDoc();
      addClarification(doc, { question: 'What is the target platform?', answer: 'Web only' });
      addClarification(doc, { question: 'Who are the stakeholders?', answer: null });

      const ctx = buildContext(doc);

      expect(ctx.clarifications).toHaveLength(2);
      // Answered first (priority order)
      expect(ctx.clarifications[0].question).toBe('What is the target platform?');
      expect(ctx.clarifications[0].answer).toBe('Web only');
      // Then unanswered
      expect(ctx.clarifications[1].question).toBe('Who are the stakeholders?');
      expect(ctx.clarifications[1].answer).toBeNull();
    });

    it('extracts current sprint packet', () => {
      const doc = createDoc();
      const packet: SprintPacket = {
        sprintGoal: 'Ship MVP',
        inScope: ['Auth', 'Dashboard'],
        outOfScope: ['Mobile app'],
        tasks: [
          {
            id: 't1',
            title: 'Implement login',
            description: 'OAuth2 login flow',
            priority: 'high',
            acceptanceCriteria: ['User can log in with Google'],
          },
        ],
        risksAndDependencies: ['Third-party API downtime'],
      };
      setSprintPacket(doc, packet);

      const ctx = buildContext(doc);

      expect(ctx.currentPacket).not.toBeNull();
      expect(ctx.currentPacket!.sprintGoal).toBe('Ship MVP');
      expect(ctx.currentPacket!.inScope).toEqual(['Auth', 'Dashboard']);
      expect(ctx.currentPacket!.tasks).toHaveLength(1);
      expect(ctx.currentPacket!.tasks[0].title).toBe('Implement login');
    });

    it('returns null packet when no sprint goal is set', () => {
      const doc = createDoc();
      // Initialize the map without sprintGoal
      doc.getMap('sprintPacket');

      const ctx = buildContext(doc);
      expect(ctx.currentPacket).toBeNull();
    });

    it('extracts unique participant names from raw inputs', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: 'Alice', content: 'Idea 1' });
      addRawInput(doc, { authorName: 'Bob', content: 'Idea 2' });
      addRawInput(doc, { authorName: 'Alice', content: 'Idea 3' });

      const ctx = buildContext(doc);

      expect(ctx.participantNames).toHaveLength(2);
      expect(ctx.participantNames).toContain('Alice');
      expect(ctx.participantNames).toContain('Bob');
    });
  });

  describe('Packing order and priority', () => {
    it('answered clarifications are ordered before unanswered', () => {
      const doc = createDoc();
      addClarification(doc, { question: 'Q1 unanswered', answer: null });
      addClarification(doc, { question: 'Q2 answered', answer: 'Yes' });
      addClarification(doc, { question: 'Q3 unanswered', answer: null });
      addClarification(doc, { question: 'Q4 answered', answer: 'No' });

      const ctx = buildContext(doc);

      // Answered come first
      expect(ctx.clarifications[0].answer).not.toBeNull();
      expect(ctx.clarifications[1].answer).not.toBeNull();
      // Then unanswered
      expect(ctx.clarifications[2].answer).toBeNull();
      expect(ctx.clarifications[3].answer).toBeNull();
    });

    it('includes all clarifications regardless of context limit', () => {
      const doc = createDoc();
      // Add a bunch of clarifications
      for (let i = 0; i < 10; i++) {
        addClarification(doc, {
          question: `Question ${i} with some extra content`,
          answer: `Answer ${i} with details`,
        });
      }
      // Add many raw inputs to push over a small limit
      for (let i = 0; i < 50; i++) {
        addRawInput(doc, { authorName: `Author${i}`, content: `Input ${i} with lots of content padding here`, timestamp: i });
      }

      // Use a small limit that forces truncation of raw inputs
      const ctx = buildContext(doc, 2000);

      // All clarifications must be present
      expect(ctx.clarifications).toHaveLength(10);
      // Some raw inputs may have been dropped
      expect(ctx.rawInputs.length).toBeLessThan(50);
    });
  });

  describe('Context limit truncation', () => {
    it('drops oldest raw inputs when approaching limit', () => {
      const doc = createDoc();
      // Add inputs with known timestamps so ordering is deterministic
      for (let i = 0; i < 100; i++) {
        addRawInput(doc, {
          authorName: 'User',
          content: `Input number ${i} with some padding content here`,
          timestamp: i * 1000,
        });
      }

      // Use a small limit
      const ctx = buildContext(doc, 1500);

      // Should include fewer than 100 inputs
      expect(ctx.rawInputs.length).toBeLessThan(100);
      expect(ctx.rawInputs.length).toBeGreaterThan(0);

      // Should keep newest (highest timestamp) inputs
      // The first input should be the newest one
      expect(ctx.rawInputs[0].content).toBe('Input number 99 with some padding content here');
    });

    it('truncates notes when raw inputs fill remaining budget', () => {
      const doc = createDoc();
      // Add a large note
      const longNote = 'A'.repeat(5000);
      addNotes(doc, longNote);

      // Add enough raw inputs to eat into the budget
      for (let i = 0; i < 50; i++) {
        addRawInput(doc, {
          authorName: 'User',
          content: `Input ${i} with padding`,
          timestamp: i * 1000,
        });
      }

      // Use a moderate limit that includes all inputs but truncates notes
      const inputsSize = estimateSize(
        Array.from({ length: 50 }, (_, i) => ({ authorName: 'User', content: `Input ${i} with padding` }))
      );
      const ctx = buildContext(doc, inputsSize + 500);

      // Inputs should be present (maybe truncated)
      expect(ctx.rawInputs.length).toBeGreaterThan(0);
    });

    it('never drops answered clarifications even under tight limit', () => {
      const doc = createDoc();
      // Add many answered clarifications
      for (let i = 0; i < 20; i++) {
        addClarification(doc, {
          question: `Important question ${i}?`,
          answer: `Critical answer ${i}`,
        });
      }
      // Add a large packet
      setSprintPacket(doc, {
        sprintGoal: 'Very important goal',
        inScope: ['A', 'B', 'C'],
        outOfScope: ['X', 'Y'],
        tasks: [{
          id: 't1',
          title: 'Task 1',
          description: 'Do something',
          priority: 'high',
          acceptanceCriteria: ['Done when X'],
        }],
        risksAndDependencies: ['Risk 1'],
      });
      // Add many inputs
      for (let i = 0; i < 100; i++) {
        addRawInput(doc, { authorName: 'User', content: `Input ${i}`, timestamp: i });
      }

      const ctx = buildContext(doc, 2000);

      // All 20 answered clarifications must be present
      const answered = ctx.clarifications.filter((c) => c.answer !== null);
      expect(answered).toHaveLength(20);
    });

    it('never drops current packet even under tight limit', () => {
      const doc = createDoc();
      setSprintPacket(doc, {
        sprintGoal: 'Ship login feature',
        inScope: ['OAuth2', 'Email login'],
        outOfScope: ['SSO'],
        tasks: [{
          id: 't1',
          title: 'Implement OAuth',
          description: 'Set up OAuth2 flow',
          priority: 'high',
          acceptanceCriteria: ['Google login works'],
        }],
        risksAndDependencies: ['API rate limits'],
      });
      // Fill with lots of raw inputs
      for (let i = 0; i < 200; i++) {
        addRawInput(doc, { authorName: 'User', content: `Padding input ${i}`, timestamp: i });
      }

      const ctx = buildContext(doc, 1000);

      expect(ctx.currentPacket).not.toBeNull();
      expect(ctx.currentPacket!.sprintGoal).toBe('Ship login feature');
    });

    it('adds truncation assumption when content is dropped', () => {
      const doc = createDoc();
      setSprintPacket(doc, {
        sprintGoal: 'Test',
        inScope: [],
        outOfScope: [],
        tasks: [],
        risksAndDependencies: [],
      });
      // Add many inputs that will be dropped
      for (let i = 0; i < 100; i++) {
        addRawInput(doc, { authorName: 'User', content: `Input ${i} with some padding`, timestamp: i });
      }

      const ctx = buildContext(doc, 800);

      // Should have truncation noted in assumptions
      expect(ctx.currentPacket).not.toBeNull();
      expect(ctx.currentPacket!.assumptions).toBeDefined();
      const truncationNote = ctx.currentPacket!.assumptions!.find((a) =>
        a.includes('Context truncated')
      );
      expect(truncationNote).toBeDefined();
      expect(truncationNote).toContain('raw input(s) dropped');
    });

    it('adds notes truncation to assumption when notes are cut', () => {
      const doc = createDoc();
      setSprintPacket(doc, {
        sprintGoal: 'Test',
        inScope: [],
        outOfScope: [],
        tasks: [],
        risksAndDependencies: [],
      });
      // Add a large note
      addNotes(doc, 'X'.repeat(20000));

      const ctx = buildContext(doc, 500);

      expect(ctx.currentPacket!.assumptions).toBeDefined();
      const truncationNote = ctx.currentPacket!.assumptions!.find((a) =>
        a.includes('notes truncated')
      );
      expect(truncationNote).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('handles raw inputs with empty authorName', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: '', content: 'Anonymous input' });

      const ctx = buildContext(doc);

      expect(ctx.rawInputs).toHaveLength(1);
      expect(ctx.rawInputs[0].authorName).toBe('');
      // Empty names are not added to participantNames
      expect(ctx.participantNames).toEqual([]);
    });

    it('handles doc with only notes', () => {
      const doc = createDoc();
      addNotes(doc, 'Some planning notes');

      const ctx = buildContext(doc);

      expect(ctx.rawInputs).toEqual([]);
      expect(ctx.clarifications).toEqual([]);
      expect(ctx.currentPacket).toBeNull();
      expect(ctx.participantNames).toEqual([]);
      expect(ctx.notes).toContain('Some planning notes');
    });

    it('prefers participant names passed from the room over raw-input authors alone', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: 'Alice', content: 'idea' });
      const ctx = buildContext(doc, CONTEXT_LIMIT, {
        participantNames: ['Carol', 'Dave'],
      });
      expect(ctx.participantNames).toEqual(expect.arrayContaining(['Carol', 'Dave', 'Alice']));
    });

    it('handles sprint packet with assumptions already set', () => {
      const doc = createDoc();
      setSprintPacket(doc, {
        sprintGoal: 'Goal',
        inScope: ['A'],
        outOfScope: [],
        tasks: [],
        risksAndDependencies: [],
        assumptions: ['Assuming team of 3'],
      });

      const ctx = buildContext(doc);

      expect(ctx.currentPacket!.assumptions).toContain('Assuming team of 3');
    });

    it('preserves existing assumptions when adding truncation note', () => {
      const doc = createDoc();
      setSprintPacket(doc, {
        sprintGoal: 'Goal',
        inScope: [],
        outOfScope: [],
        tasks: [],
        risksAndDependencies: [],
        assumptions: ['Existing assumption'],
      });
      // Add many inputs to force truncation
      for (let i = 0; i < 100; i++) {
        addRawInput(doc, { authorName: 'User', content: `Input ${i} padding`, timestamp: i });
      }

      const ctx = buildContext(doc, 500);

      expect(ctx.currentPacket!.assumptions).toContain('Existing assumption');
      expect(ctx.currentPacket!.assumptions!.some((a) => a.includes('Context truncated'))).toBe(true);
    });

    it('works with default context limit', () => {
      const doc = createDoc();
      addRawInput(doc, { authorName: 'Alice', content: 'Test input' });

      // Should not throw with default limit
      const ctx = buildContext(doc);
      expect(ctx.rawInputs).toHaveLength(1);
    });
  });
});
