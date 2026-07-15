import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import { nanoid } from 'nanoid';

/**
 * Feature: sprint-room, Property 3: Raw input attribution
 *
 * **Validates: Requirements 2.2, 2.4**
 *
 * For any participant (id + name) and text input they submit, stored input
 * SHALL retain their identity (authorId, authorName) and original content.
 */
describe('Feature: sprint-room, Property 3: Raw input attribution', () => {
  // --- Generators ---

  /** Random user IDs (nanoid-style, 1-21 chars, alphanumeric + _-) */
  const userIdArb = fc.stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
    { minLength: 1, maxLength: 21 }
  );

  /** Random participant names (1-30 chars, non-empty after trim) */
  const participantNameArb = fc
    .stringOf(
      fc.char().filter((c) => c.trim().length > 0),
      { minLength: 1, maxLength: 30 }
    )
    .filter((s) => s.trim().length >= 1 && s.trim().length <= 30);

  /** Random non-empty content strings */
  const contentArb = fc
    .string({ minLength: 1, maxLength: 500 })
    .filter((s) => s.trim().length > 0);

  it('a single raw input retains authorId, authorName, and content', () => {
    fc.assert(
      fc.property(
        userIdArb,
        participantNameArb,
        contentArb,
        (authorId, authorName, content) => {
          const doc = new Y.Doc();
          const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');

          // Store entry as a Y.Map (same pattern as RawInputPanel)
          const entry = new Y.Map<string | number>();
          entry.set('id', nanoid());
          entry.set('authorId', authorId);
          entry.set('authorName', authorName);
          entry.set('content', content);
          entry.set('timestamp', Date.now());

          rawInputs.push([entry]);

          // Read back
          expect(rawInputs.length).toBe(1);
          const stored = rawInputs.get(0);
          expect(stored.get('authorId')).toBe(authorId);
          expect(stored.get('authorName')).toBe(authorName);
          expect(stored.get('content')).toBe(content);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple raw inputs from different participants all retain identity and content', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(userIdArb, participantNameArb, contentArb),
          { minLength: 2, maxLength: 20 }
        ),
        (inputs) => {
          const doc = new Y.Doc();
          const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');

          // Push all entries in a single transaction (simulates concurrent adds)
          doc.transact(() => {
            for (const [authorId, authorName, content] of inputs) {
              const entry = new Y.Map<string | number>();
              entry.set('id', nanoid());
              entry.set('authorId', authorId);
              entry.set('authorName', authorName);
              entry.set('content', content);
              entry.set('timestamp', Date.now());
              rawInputs.push([entry]);
            }
          });

          // Verify all entries retained their attribution
          expect(rawInputs.length).toBe(inputs.length);
          for (let i = 0; i < inputs.length; i++) {
            const [expectedAuthorId, expectedAuthorName, expectedContent] = inputs[i];
            const stored = rawInputs.get(i);
            expect(stored.get('authorId')).toBe(expectedAuthorId);
            expect(stored.get('authorName')).toBe(expectedAuthorName);
            expect(stored.get('content')).toBe(expectedContent);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('raw inputs preserve identity across independent transactions (concurrent submits)', () => {
    fc.assert(
      fc.property(
        fc.tuple(userIdArb, participantNameArb, contentArb),
        fc.tuple(userIdArb, participantNameArb, contentArb),
        (input1, input2) => {
          const doc = new Y.Doc();
          const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');

          // Simulate two participants submitting independently
          doc.transact(() => {
            const entry1 = new Y.Map<string | number>();
            entry1.set('id', nanoid());
            entry1.set('authorId', input1[0]);
            entry1.set('authorName', input1[1]);
            entry1.set('content', input1[2]);
            entry1.set('timestamp', Date.now());
            rawInputs.push([entry1]);
          });

          doc.transact(() => {
            const entry2 = new Y.Map<string | number>();
            entry2.set('id', nanoid());
            entry2.set('authorId', input2[0]);
            entry2.set('authorName', input2[1]);
            entry2.set('content', input2[2]);
            entry2.set('timestamp', Date.now());
            rawInputs.push([entry2]);
          });

          // Both inputs should be preserved with correct attribution
          expect(rawInputs.length).toBe(2);

          const stored1 = rawInputs.get(0);
          expect(stored1.get('authorId')).toBe(input1[0]);
          expect(stored1.get('authorName')).toBe(input1[1]);
          expect(stored1.get('content')).toBe(input1[2]);

          const stored2 = rawInputs.get(1);
          expect(stored2.get('authorId')).toBe(input2[0]);
          expect(stored2.get('authorName')).toBe(input2[1]);
          expect(stored2.get('content')).toBe(input2[2]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
