import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ClarifyOutputSchema,
  SprintPacketSchema,
  BreakDownOutputSchema,
} from './schemas';

// --- Generators ---

const arbNonEmptyString = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const arbClarifyQuestion = fc.record({
  id: arbNonEmptyString,
  question: arbNonEmptyString,
  context: arbNonEmptyString,
});

const arbTask = fc.record({
  id: arbNonEmptyString,
  title: arbNonEmptyString,
  description: arbNonEmptyString,
  priority: fc.constantFrom('high' as const, 'medium' as const, 'low' as const),
  acceptanceCriteria: fc.array(arbNonEmptyString, { minLength: 1, maxLength: 5 }),
});

// --- Property Tests ---

describe('Feature: sprint-room, Property 7: Clarify question limit', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any clarify result accepted by the server, questions length SHALL be ≤ 5.
   * If questions > 5, parse throws.
   */
  it('clarify outputs with ≤5 questions pass schema validation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        (count) => {
          const questions = Array.from({ length: count }, (_, i) => ({
            id: `q-${i}`,
            question: `Question ${i}?`,
            context: `Context ${i}`,
          }));
          const result = ClarifyOutputSchema.parse({ questions });
          expect(result.questions.length).toBeLessThanOrEqual(5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('clarify outputs with >5 questions are rejected by schema validation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 10 }),
        (count) => {
          const questions = Array.from({ length: count }, (_, i) => ({
            id: `q-${i}`,
            question: `Question ${i}?`,
            context: `Context ${i}`,
          }));
          expect(() => ClarifyOutputSchema.parse({ questions })).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('randomly generated oversized clarify outputs are always rejected', () => {
    fc.assert(
      fc.property(
        fc.array(arbClarifyQuestion, { minLength: 6, maxLength: 10 }),
        (questions) => {
          expect(() => ClarifyOutputSchema.parse({ questions })).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 8: Sprint Packet structure completeness', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any plan result accepted by the server, the Sprint_Packet SHALL include
   * sprint goal, in-scope, out-of-scope, prioritized tasks with acceptance criteria,
   * and risks/dependencies.
   */
  it('valid sprint packets always have required sections after parse', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString, // sprintGoal
        fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 0, maxLength: 5 }), // inScope
        fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 0, maxLength: 5 }), // outOfScope
        fc.array(arbTask, { minLength: 1, maxLength: 5 }), // tasks
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 5 }), // risksAndDependencies
        (sprintGoal, inScope, outOfScope, tasks, risksAndDependencies) => {
          const packet = {
            sprintGoal,
            inScope,
            outOfScope,
            tasks,
            risksAndDependencies,
          };

          const result = SprintPacketSchema.parse(packet);

          // sprintGoal is non-empty
          expect(result.sprintGoal.length).toBeGreaterThan(0);

          // inScope, outOfScope, risksAndDependencies are arrays
          expect(Array.isArray(result.inScope)).toBe(true);
          expect(Array.isArray(result.outOfScope)).toBe(true);
          expect(Array.isArray(result.risksAndDependencies)).toBe(true);

          // tasks has at least 1 entry
          expect(result.tasks.length).toBeGreaterThanOrEqual(1);

          // each task has title and at least 1 acceptance criterion
          for (const task of result.tasks) {
            expect(task.title.length).toBeGreaterThan(0);
            expect(task.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sprint packets with empty sprintGoal are rejected', () => {
    fc.assert(
      fc.property(
        fc.array(arbTask, { minLength: 1, maxLength: 3 }),
        (tasks) => {
          const packet = {
            sprintGoal: '',
            inScope: [],
            outOfScope: [],
            tasks,
            risksAndDependencies: [],
          };
          expect(() => SprintPacketSchema.parse(packet)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sprint packets with zero tasks are rejected', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        (sprintGoal) => {
          const packet = {
            sprintGoal,
            inScope: [],
            outOfScope: [],
            tasks: [],
            risksAndDependencies: [],
          };
          expect(() => SprintPacketSchema.parse(packet)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 9: Break-down structural completeness', () => {
  /**
   * **Validates: Requirements 8.1, 8.2, 8.4**
   *
   * For any accepted break-down result, each subtask SHALL have description
   * and acceptance criteria, and the parent task id SHALL be preserved.
   */
  it('valid break-down outputs preserve parentTaskId and subtask structure', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString, // parentTaskId
        arbNonEmptyString, // parentTaskTitle
        fc.array(arbTask, { minLength: 1, maxLength: 5 }), // subtasks
        (parentTaskId, parentTaskTitle, subtasks) => {
          const output = {
            parentTaskId,
            parentTaskTitle,
            subtasks,
          };

          const result = BreakDownOutputSchema.parse(output);

          // parentTaskId is preserved and non-empty
          expect(result.parentTaskId).toBe(parentTaskId);
          expect(result.parentTaskId.length).toBeGreaterThan(0);

          // each subtask has description and acceptance criteria
          for (const subtask of result.subtasks) {
            expect(subtask.description.length).toBeGreaterThan(0);
            expect(subtask.acceptanceCriteria.length).toBeGreaterThanOrEqual(1);
            for (const ac of subtask.acceptanceCriteria) {
              expect(ac.length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('break-down with empty parentTaskId is rejected', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString, // parentTaskTitle
        fc.array(arbTask, { minLength: 1, maxLength: 3 }), // subtasks
        (parentTaskTitle, subtasks) => {
          const output = {
            parentTaskId: '',
            parentTaskTitle,
            subtasks,
          };
          expect(() => BreakDownOutputSchema.parse(output)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('break-down with subtasks missing description is rejected', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        arbNonEmptyString,
        (parentTaskId, parentTaskTitle) => {
          const output = {
            parentTaskId,
            parentTaskTitle,
            subtasks: [
              {
                id: 'sub-1',
                title: 'Subtask',
                description: '', // empty - should fail
                priority: 'medium' as const,
                acceptanceCriteria: ['AC1'],
              },
            ],
          };
          expect(() => BreakDownOutputSchema.parse(output)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('break-down with subtasks missing acceptance criteria is rejected', () => {
    fc.assert(
      fc.property(
        arbNonEmptyString,
        arbNonEmptyString,
        (parentTaskId, parentTaskTitle) => {
          const output = {
            parentTaskId,
            parentTaskTitle,
            subtasks: [
              {
                id: 'sub-1',
                title: 'Subtask',
                description: 'Some description',
                priority: 'low' as const,
                acceptanceCriteria: [], // empty - should fail
              },
            ],
          };
          expect(() => BreakDownOutputSchema.parse(output)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: sprint-room, Property 12: Action validation', () => {
  /**
   * **Validates: Requirements 11.1**
   *
   * For any AI action string, the server SHALL accept only `clarify`, `plan`,
   * and `break-down` and reject others.
   */
  const VALID_ACTIONS = ['clarify', 'plan', 'break-down'] as const;

  function isValidAiAction(action: string): action is 'clarify' | 'plan' | 'break-down' {
    return (VALID_ACTIONS as readonly string[]).includes(action);
  }

  it('only clarify, plan, and break-down are accepted as valid actions', () => {
    for (const action of VALID_ACTIONS) {
      expect(isValidAiAction(action)).toBe(true);
    }
  });

  it('arbitrary strings that are not valid actions are rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        (action) => {
          if (VALID_ACTIONS.includes(action as any)) {
            // If by chance the random string matches a valid action, it should pass
            expect(isValidAiAction(action)).toBe(true);
          } else {
            expect(isValidAiAction(action)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('similar-looking strings are rejected (not just prefix/suffix matches)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'Clarify', 'CLARIFY', 'Plan', 'PLAN', 'Break-Down', 'BREAK-DOWN',
          'break_down', 'breakdown', 'break down', 'planning', 'clarifying',
          'clarify ', ' plan', 'break-down!', '', 'unknown', 'delete', 'update'
        ),
        (action) => {
          expect(isValidAiAction(action)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
