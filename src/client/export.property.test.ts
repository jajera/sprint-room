import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { SprintPacket, Task } from '../shared/types';
import { toMarkdown, toJSON } from './export';

// --- Generators ---

const arbNonEmptyString = (maxLength: number) =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

const arbTask: fc.Arbitrary<Task> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  title: arbNonEmptyString(50),
  description: arbNonEmptyString(100),
  priority: fc.constantFrom('high' as const, 'medium' as const, 'low' as const),
  acceptanceCriteria: fc.array(arbNonEmptyString(80), { minLength: 1, maxLength: 4 }),
});

const arbSprintPacket: fc.Arbitrary<SprintPacket> = fc.record({
  sprintGoal: arbNonEmptyString(100),
  inScope: fc.array(arbNonEmptyString(50), { minLength: 1, maxLength: 5 }),
  outOfScope: fc.array(arbNonEmptyString(50), { minLength: 1, maxLength: 5 }),
  tasks: fc.array(arbTask, { minLength: 1, maxLength: 5 }),
  risksAndDependencies: fc.array(arbNonEmptyString(80), { minLength: 1, maxLength: 5 }),
  assumptions: fc.oneof(
    fc.constant(undefined),
    fc.array(arbNonEmptyString(60), { minLength: 1, maxLength: 4 })
  ),
});

// --- Property Tests ---

describe('Feature: sprint-room, Property 10: Markdown export completeness', () => {
  /**
   * **Validates: Requirements 9.1, 9.3, 9.5**
   *
   * For any Sprint_Packet in the shared document, markdown export SHALL include
   * all required sections with content matching the source.
   */
  it('markdown output contains all sprint packet fields', () => {
    fc.assert(
      fc.property(arbSprintPacket, (packet) => {
        const md = toMarkdown(packet);

        // Sprint goal present
        expect(md).toContain(packet.sprintGoal);

        // All in-scope items present
        for (const item of packet.inScope) {
          expect(md).toContain(item);
        }

        // All out-of-scope items present
        for (const item of packet.outOfScope) {
          expect(md).toContain(item);
        }

        // All task titles present
        for (const task of packet.tasks) {
          expect(md).toContain(task.title);
        }

        // All acceptance criteria present
        for (const task of packet.tasks) {
          for (const ac of task.acceptanceCriteria) {
            expect(md).toContain(ac);
          }
        }

        // All risks present
        for (const risk of packet.risksAndDependencies) {
          expect(md).toContain(risk);
        }

        // Assumptions present when defined
        if (packet.assumptions && packet.assumptions.length > 0) {
          for (const assumption of packet.assumptions) {
            expect(md).toContain(assumption);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 11: JSON export round-trip', () => {
  /**
   * **Validates: Requirements 9.2, 9.3, 9.5**
   *
   * For any Sprint_Packet in the shared document, JSON export SHALL parse back
   * to an object with matching field values.
   */
  it('JSON round-trip preserves all packet fields', () => {
    fc.assert(
      fc.property(arbSprintPacket, (packet) => {
        const jsonStr = toJSON(packet);
        const parsed = JSON.parse(jsonStr);

        // Sprint goal matches
        expect(parsed.sprintGoal).toBe(packet.sprintGoal);

        // In-scope matches
        expect(parsed.inScope).toEqual(packet.inScope);

        // Out-of-scope matches
        expect(parsed.outOfScope).toEqual(packet.outOfScope);

        // Tasks match (titles, descriptions, priorities, acceptance criteria)
        expect(parsed.tasks).toHaveLength(packet.tasks.length);
        for (let i = 0; i < packet.tasks.length; i++) {
          expect(parsed.tasks[i].id).toBe(packet.tasks[i].id);
          expect(parsed.tasks[i].title).toBe(packet.tasks[i].title);
          expect(parsed.tasks[i].description).toBe(packet.tasks[i].description);
          expect(parsed.tasks[i].priority).toBe(packet.tasks[i].priority);
          expect(parsed.tasks[i].acceptanceCriteria).toEqual(
            packet.tasks[i].acceptanceCriteria
          );
        }

        // Risks match
        expect(parsed.risksAndDependencies).toEqual(packet.risksAndDependencies);

        // Assumptions match
        if (packet.assumptions) {
          expect(parsed.assumptions).toEqual(packet.assumptions);
        } else {
          expect(parsed.assumptions).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });
});
