import { describe, it, expect } from 'vitest';
import {
  TaskSchema,
  ClarifyQuestionSchema,
  ClarifyOutputSchema,
  SprintPacketSchema,
  BreakDownOutputSchema,
} from './schemas';

describe('schemas', () => {
  describe('TaskSchema', () => {
    it('accepts a valid task with acceptance criteria', () => {
      const task = {
        id: 'task-1',
        title: 'Build login page',
        description: 'Create a login form',
        priority: 'high' as const,
        acceptanceCriteria: ['User can enter email and password'],
      };
      expect(TaskSchema.parse(task)).toEqual(task);
    });

    it('rejects a task with empty acceptance criteria', () => {
      const task = {
        id: 'task-1',
        title: 'Build login page',
        description: 'Create a login form',
        priority: 'high',
        acceptanceCriteria: [],
      };
      expect(() => TaskSchema.parse(task)).toThrow();
    });

    it('rejects a task with empty title', () => {
      const task = {
        id: 'task-1',
        title: '',
        description: 'Desc',
        priority: 'medium',
        acceptanceCriteria: ['AC1'],
      };
      expect(() => TaskSchema.parse(task)).toThrow();
    });

    it('accepts a task with subtasks', () => {
      const task = {
        id: 'task-1',
        title: 'Build auth',
        description: 'Implement authentication',
        priority: 'high' as const,
        acceptanceCriteria: ['Users can log in'],
        subtasks: [
          {
            id: 'task-1-1',
            title: 'Login form',
            description: 'Create login form',
            priority: 'medium' as const,
            acceptanceCriteria: ['Form renders'],
            parentTaskId: 'task-1',
          },
        ],
      };
      const result = TaskSchema.parse(task);
      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks![0].parentTaskId).toBe('task-1');
    });

    it('coerces empty parentTaskId to null (Bedrock top-level tasks)', () => {
      const task = {
        id: 'task-1',
        title: 'Ship MVP',
        description: 'One-day MVP',
        priority: 'high' as const,
        acceptanceCriteria: ['Demoable'],
        parentTaskId: '',
      };
      const result = TaskSchema.parse(task);
      expect(result.parentTaskId).toBeNull();
    });

    it('rejects invalid priority', () => {
      const task = {
        id: 'task-1',
        title: 'Task',
        description: 'Desc',
        priority: 'critical',
        acceptanceCriteria: ['AC'],
      };
      expect(() => TaskSchema.parse(task)).toThrow();
    });
  });

  describe('ClarifyOutputSchema', () => {
    it('accepts up to 5 questions', () => {
      const output = {
        questions: Array.from({ length: 5 }, (_, i) => ({
          id: `q-${i}`,
          question: `Question ${i}?`,
          context: `Context for question ${i}`,
        })),
      };
      expect(ClarifyOutputSchema.parse(output).questions).toHaveLength(5);
    });

    it('rejects more than 5 questions', () => {
      const output = {
        questions: Array.from({ length: 6 }, (_, i) => ({
          id: `q-${i}`,
          question: `Question ${i}?`,
          context: `Context for question ${i}`,
        })),
      };
      expect(() => ClarifyOutputSchema.parse(output)).toThrow();
    });

    it('accepts empty questions array', () => {
      const output = { questions: [] };
      expect(ClarifyOutputSchema.parse(output).questions).toHaveLength(0);
    });

    it('rejects question with empty id', () => {
      const output = {
        questions: [{ id: '', question: 'Q?', context: 'Why' }],
      };
      expect(() => ClarifyOutputSchema.parse(output)).toThrow();
    });
  });

  describe('SprintPacketSchema', () => {
    const validPacket = {
      sprintGoal: 'Ship authentication flow',
      inScope: ['Login', 'Signup'],
      outOfScope: ['Social login'],
      tasks: [
        {
          id: 'task-1',
          title: 'Build login',
          description: 'Create login page',
          priority: 'high' as const,
          acceptanceCriteria: ['User can log in'],
        },
      ],
      risksAndDependencies: ['API availability'],
    };

    it('accepts a valid sprint packet', () => {
      expect(SprintPacketSchema.parse(validPacket)).toEqual(validPacket);
    });

    it('rejects empty sprintGoal', () => {
      expect(() =>
        SprintPacketSchema.parse({ ...validPacket, sprintGoal: '' })
      ).toThrow();
    });

    it('rejects empty tasks array', () => {
      expect(() =>
        SprintPacketSchema.parse({ ...validPacket, tasks: [] })
      ).toThrow();
    });

    it('accepts optional assumptions', () => {
      const withAssumptions = {
        ...validPacket,
        assumptions: ['Team has access to design system'],
      };
      const result = SprintPacketSchema.parse(withAssumptions);
      expect(result.assumptions).toEqual(['Team has access to design system']);
    });

    it('accepts packet without assumptions field', () => {
      const result = SprintPacketSchema.parse(validPacket);
      expect(result.assumptions).toBeUndefined();
    });

    it('allows empty inScope and outOfScope arrays', () => {
      const packet = { ...validPacket, inScope: [], outOfScope: [] };
      expect(SprintPacketSchema.parse(packet).inScope).toEqual([]);
    });
  });

  describe('BreakDownOutputSchema', () => {
    it('accepts valid break-down output', () => {
      const output = {
        parentTaskId: 'task-1',
        parentTaskTitle: 'Build auth',
        subtasks: [
          {
            id: 'task-1-1',
            title: 'Login form',
            description: 'Create login form UI',
            priority: 'medium' as const,
            acceptanceCriteria: ['Form has email and password fields'],
            parentTaskId: 'task-1',
          },
        ],
      };
      expect(BreakDownOutputSchema.parse(output)).toEqual(output);
    });

    it('rejects empty parentTaskId', () => {
      const output = {
        parentTaskId: '',
        parentTaskTitle: 'Build auth',
        subtasks: [
          {
            id: 'task-1-1',
            title: 'Sub',
            description: 'Desc',
            priority: 'low' as const,
            acceptanceCriteria: ['AC'],
          },
        ],
      };
      expect(() => BreakDownOutputSchema.parse(output)).toThrow();
    });

    it('rejects empty subtasks array', () => {
      const output = {
        parentTaskId: 'task-1',
        parentTaskTitle: 'Build auth',
        subtasks: [],
      };
      expect(() => BreakDownOutputSchema.parse(output)).toThrow();
    });

    it('rejects subtask without description', () => {
      const output = {
        parentTaskId: 'task-1',
        parentTaskTitle: 'Build auth',
        subtasks: [
          {
            id: 'task-1-1',
            title: 'Sub',
            description: '',
            priority: 'low',
            acceptanceCriteria: ['AC'],
          },
        ],
      };
      expect(() => BreakDownOutputSchema.parse(output)).toThrow();
    });

    it('rejects subtask without acceptance criteria', () => {
      const output = {
        parentTaskId: 'task-1',
        parentTaskTitle: 'Build auth',
        subtasks: [
          {
            id: 'task-1-1',
            title: 'Sub',
            description: 'Desc',
            priority: 'low',
            acceptanceCriteria: [],
          },
        ],
      };
      expect(() => BreakDownOutputSchema.parse(output)).toThrow();
    });
  });
});
