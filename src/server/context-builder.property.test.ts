import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import { buildContext } from './context-builder';
import type { SprintPacket } from '../shared/types';

// --- Helpers ---

function createDoc(): Y.Doc {
  return new Y.Doc();
}

function addRawInput(
  doc: Y.Doc,
  input: { authorName: string; content: string; timestamp?: number }
): void {
  const arr = doc.getArray('rawInputs');
  const map = new Y.Map();
  doc.transact(() => {
    map.set('id', `input-${arr.length}`);
    map.set('authorId', `author-${arr.length}`);
    map.set('authorName', input.authorName);
    map.set('content', input.content);
    map.set('timestamp', input.timestamp ?? Date.now());
    arr.push([map]);
  });
}

function addClarification(
  doc: Y.Doc,
  clar: { question: string; answer: string | null }
): void {
  const arr = doc.getArray('clarifications');
  const map = new Y.Map();
  doc.transact(() => {
    map.set('questionId', `q-${arr.length}`);
    map.set('question', clar.question);
    map.set('questionContext', '');
    map.set('answer', clar.answer);
    map.set('answeredBy', clar.answer !== null ? 'someone' : null);
    map.set('timestamp', Date.now());
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

// --- Generators ---

const arbAuthorName = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);
const arbContent = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

const arbRawInput = fc.record({
  authorName: arbAuthorName,
  content: arbContent,
});

const arbAnsweredClarification = fc.record({
  question: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  answer: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
});

const arbUnansweredClarification = fc.record({
  question: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
});

const arbSprintPacket: fc.Arbitrary<SprintPacket> = fc.record({
  sprintGoal: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  inScope: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
  outOfScope: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
  tasks: fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }),
      title: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      priority: fc.constantFrom('high' as const, 'medium' as const, 'low' as const),
      acceptanceCriteria: fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 1, maxLength: 3 }),
    }),
    { minLength: 1, maxLength: 5 }
  ),
  risksAndDependencies: fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 0, maxLength: 3 }),
});

// --- Property Tests ---

describe('Feature: sprint-room, Property 4: AI context completeness', () => {
  /**
   * **Validates: Requirements 2.5, 5.2, 6.1, 7.2**
   *
   * For any room state with raw inputs and clarification answers,
   * `buildContext` SHALL include every raw input and every clarification answer.
   */
  it('all raw input content and clarification answers appear in the result', () => {
    fc.assert(
      fc.property(
        fc.array(arbRawInput, { minLength: 1, maxLength: 15 }),
        fc.array(arbAnsweredClarification, { minLength: 1, maxLength: 10 }),
        fc.array(arbUnansweredClarification, { minLength: 0, maxLength: 5 }),
        (rawInputs, answeredClars, unansweredClars) => {
          const doc = createDoc();

          // Add raw inputs with sequential timestamps
          for (let i = 0; i < rawInputs.length; i++) {
            addRawInput(doc, {
              authorName: rawInputs[i].authorName,
              content: rawInputs[i].content,
              timestamp: i * 1000,
            });
          }

          // Add answered clarifications
          for (const clar of answeredClars) {
            addClarification(doc, { question: clar.question, answer: clar.answer });
          }

          // Add unanswered clarifications
          for (const clar of unansweredClars) {
            addClarification(doc, { question: clar.question, answer: null });
          }

          // Use a large limit (default) so nothing is truncated
          const ctx = buildContext(doc);

          // Every raw input content must appear in the result
          const resultContents = ctx.rawInputs.map((r) => r.content);
          for (const input of rawInputs) {
            expect(resultContents).toContain(input.content);
          }

          // Every raw input's authorName must appear in the result
          const resultAuthors = ctx.rawInputs.map((r) => r.authorName);
          for (const input of rawInputs) {
            expect(resultAuthors).toContain(input.authorName);
          }

          // Every answered clarification's answer must appear in the result
          const resultAnswers = ctx.clarifications
            .filter((c) => c.answer !== null)
            .map((c) => c.answer);
          for (const clar of answeredClars) {
            expect(resultAnswers).toContain(clar.answer);
          }

          // Every clarification question (answered and unanswered) must appear
          const resultQuestions = ctx.clarifications.map((c) => c.question);
          for (const clar of answeredClars) {
            expect(resultQuestions).toContain(clar.question);
          }
          for (const clar of unansweredClars) {
            expect(resultQuestions).toContain(clar.question);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 5: Context accumulation and preservation', () => {
  /**
   * **Validates: Requirements 6.3, 11.6**
   *
   * For any room with answered clarifications or an existing Sprint_Packet,
   * later context builds SHALL include those answers and packet content.
   */
  it('growing states retain answered clarifications and existing packet across builds', () => {
    fc.assert(
      fc.property(
        // Initial state: some inputs and answered clarifications
        fc.array(arbRawInput, { minLength: 1, maxLength: 5 }),
        fc.array(arbAnsweredClarification, { minLength: 1, maxLength: 5 }),
        // Sprint packet for initial state
        arbSprintPacket,
        // Additional inputs and clarifications added later
        fc.array(arbRawInput, { minLength: 1, maxLength: 5 }),
        fc.array(arbAnsweredClarification, { minLength: 1, maxLength: 5 }),
        (initialInputs, initialClars, packet, additionalInputs, additionalClars) => {
          const doc = createDoc();

          // Stage 1: Set up initial state
          let timestamp = 0;
          for (const input of initialInputs) {
            addRawInput(doc, { ...input, timestamp: timestamp++ });
          }
          for (const clar of initialClars) {
            addClarification(doc, { question: clar.question, answer: clar.answer });
          }
          setSprintPacket(doc, packet);

          // Build context at stage 1
          const ctx1 = buildContext(doc);

          // Verify stage 1 has the packet
          expect(ctx1.currentPacket).not.toBeNull();
          expect(ctx1.currentPacket!.sprintGoal).toBe(packet.sprintGoal);

          // Verify stage 1 has all answered clarifications
          const ctx1Answers = ctx1.clarifications
            .filter((c) => c.answer !== null)
            .map((c) => c.answer);
          for (const clar of initialClars) {
            expect(ctx1Answers).toContain(clar.answer);
          }

          // Stage 2: Add more content (growing the state)
          for (const input of additionalInputs) {
            addRawInput(doc, { ...input, timestamp: timestamp++ });
          }
          for (const clar of additionalClars) {
            addClarification(doc, { question: clar.question, answer: clar.answer });
          }

          // Build context at stage 2
          const ctx2 = buildContext(doc);

          // Assert: packet is still present after adding more content
          expect(ctx2.currentPacket).not.toBeNull();
          expect(ctx2.currentPacket!.sprintGoal).toBe(packet.sprintGoal);

          // Assert: all initial answered clarifications are still present
          const ctx2Answers = ctx2.clarifications
            .filter((c) => c.answer !== null)
            .map((c) => c.answer);
          for (const clar of initialClars) {
            expect(ctx2Answers).toContain(clar.answer);
          }

          // Assert: all additional answered clarifications are also present
          for (const clar of additionalClars) {
            expect(ctx2Answers).toContain(clar.answer);
          }

          // Assert: newer content doesn't erase older answered clarifications
          // (total answered count should be at least initial + additional)
          expect(ctx2Answers.length).toBeGreaterThanOrEqual(
            initialClars.length + additionalClars.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
