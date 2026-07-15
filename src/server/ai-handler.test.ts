import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAIHandler,
  AITimeoutError,
  AIServiceError,
  DEFAULT_BEDROCK_MODEL_ID,
  type AIHandler,
  type ConverseRequestFn,
} from './ai-handler';
import type { RoomContext } from '../shared/types';

const mockConverse = vi.fn<ConverseRequestFn>();

const baseContext: RoomContext = {
  rawInputs: [
    { authorName: 'Alice', content: 'We need user authentication' },
    { authorName: 'Bob', content: 'Must support OAuth providers' },
  ],
  clarifications: [
    { question: 'Which OAuth providers?', answer: 'Google and GitHub' },
    { question: 'Need MFA?', answer: null },
  ],
  currentPacket: null,
  participantNames: ['Alice', 'Bob'],
};

const validClarifyResponse = {
  questions: [
    { id: 'q1', question: 'What is the timeline?', context: 'Needed for prioritization' },
    { id: 'q2', question: 'Who owns the auth service?', context: 'Determines scope of work' },
  ],
};

const validPlanResponse = {
  sprintGoal: 'Implement OAuth login for Google and GitHub',
  inScope: ['OAuth login flow', 'User session management'],
  outOfScope: ['MFA', 'Password reset'],
  tasks: [
    {
      id: 'task-1',
      title: 'Implement Google OAuth',
      description: 'Set up Google OAuth2 flow',
      priority: 'high' as const,
      acceptanceCriteria: ['User can sign in with Google'],
    },
  ],
  risksAndDependencies: ['Need Google Cloud project credentials'],
  assumptions: ['Single-tenant app'],
};

const validBreakDownResponse = {
  parentTaskId: 'task-1',
  parentTaskTitle: 'Implement Google OAuth',
  subtasks: [
    {
      id: 'task-1-1',
      title: 'Set up OAuth client',
      description: 'Register app in Google Cloud console',
      priority: 'high' as const,
      acceptanceCriteria: ['Client ID and secret configured'],
    },
    {
      id: 'task-1-2',
      title: 'Implement callback handler',
      description: 'Handle OAuth redirect and token exchange',
      priority: 'high' as const,
      acceptanceCriteria: ['Token exchange works end-to-end'],
    },
  ],
};

describe('AI Handler', () => {
  let handler: AIHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    mockConverse.mockReset();
    handler = createAIHandler({
      region: 'us-east-1',
      converse: mockConverse,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('clarify', () => {
    it('returns validated clarify output on success', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      const result = await handler.clarify(baseContext);

      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].id).toBe('q1');
      expect(result.questions[0].question).toBe('What is the timeline?');
      expect(result.questions[0].context).toBe('Needed for prioritization');
    });

    it('calls Bedrock with temperature 0.4', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      await handler.clarify(baseContext);

      expect(mockConverse).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.4 })
      );
    });

    it('includes system preamble and clarify instructions', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      await handler.clarify(baseContext);

      const args = mockConverse.mock.calls[0][0];
      expect(args.systemText).toContain('You are Sprint AI');
      expect(args.systemText).toContain('Do not invent stakeholders');
      expect(args.systemText).toContain('at most 5 questions');
    });

    it('includes room context in user message', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      await handler.clarify(baseContext);

      const args = mockConverse.mock.calls[0][0];
      expect(args.userText).toContain('Alice');
      expect(args.userText).toContain('Bob');
      expect(args.userText).toContain('user authentication');
      expect(args.userText).toContain('Google and GitHub');
    });
  });

  describe('plan', () => {
    it('returns validated sprint packet on success', async () => {
      mockConverse.mockResolvedValue(validPlanResponse);

      const result = await handler.plan(baseContext);

      expect(result.sprintGoal).toBe('Implement OAuth login for Google and GitHub');
      expect(result.inScope).toHaveLength(2);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].acceptanceCriteria).toHaveLength(1);
      expect(result.assumptions).toEqual(['Single-tenant app']);
    });

    it('calls Bedrock with temperature 0.3', async () => {
      mockConverse.mockResolvedValue(validPlanResponse);

      await handler.plan(baseContext);

      expect(mockConverse).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 })
      );
    });
  });

  describe('breakDown', () => {
    it('returns validated break-down output on success', async () => {
      mockConverse.mockResolvedValue(validBreakDownResponse);

      const contextWithPacket: RoomContext = {
        ...baseContext,
        currentPacket: validPlanResponse,
      };

      const result = await handler.breakDown(contextWithPacket, 'task-1');

      expect(result.parentTaskId).toBe('task-1');
      expect(result.parentTaskTitle).toBe('Implement Google OAuth');
      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasks[0].acceptanceCriteria).toHaveLength(1);
    });

    it('calls Bedrock with temperature 0.3', async () => {
      mockConverse.mockResolvedValue(validBreakDownResponse);

      await handler.breakDown(baseContext, 'task-1');

      expect(mockConverse).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 })
      );
    });

    it('includes target task ID in user message', async () => {
      mockConverse.mockResolvedValue(validBreakDownResponse);

      await handler.breakDown(baseContext, 'task-1');

      expect(mockConverse.mock.calls[0][0].userText).toContain('task-1');
    });
  });

  describe('timeout handling', () => {
    it('throws AITimeoutError when request is aborted', async () => {
      vi.useRealTimers();

      mockConverse.mockImplementation(async ({ signal }) => {
        const err = new Error('Request aborted');
        err.name = 'AbortError';
        return new Promise((_, reject) => {
          setTimeout(() => reject(err), 5);
          signal.addEventListener('abort', () => reject(err));
        });
      });

      await expect(handler.clarify(baseContext)).rejects.toThrow(AITimeoutError);

      vi.useFakeTimers();
    });
  });

  describe('throttle retry behavior', () => {
    it('retries up to 2 times with backoff on 429', async () => {
      vi.useRealTimers();

      const throttle = new AIServiceError('throttled', 429);
      mockConverse
        .mockRejectedValueOnce(throttle)
        .mockRejectedValueOnce(throttle)
        .mockResolvedValueOnce(validClarifyResponse);

      const result = await handler.clarify(baseContext);
      expect(result.questions).toHaveLength(2);
      expect(mockConverse).toHaveBeenCalledTimes(3);

      vi.useFakeTimers();
    });

    it('throws after exhausting 2 retries on throttle', async () => {
      vi.useRealTimers();

      const throttle = new AIServiceError('throttled', 429);
      mockConverse
        .mockRejectedValueOnce(throttle)
        .mockRejectedValueOnce(throttle)
        .mockRejectedValueOnce(throttle);

      await expect(handler.clarify(baseContext)).rejects.toThrow('Rate limited');
      expect(mockConverse).toHaveBeenCalledTimes(3);

      vi.useFakeTimers();
    });
  });

  describe('5xx error propagation', () => {
    it('throws AIServiceError immediately on 500', async () => {
      mockConverse.mockRejectedValue(new AIServiceError('Internal server error', 500));

      await expect(handler.clarify(baseContext)).rejects.toThrow('AI service error (500)');
      expect(mockConverse).toHaveBeenCalledTimes(1);
    });

    it('throws AIServiceError on 503', async () => {
      mockConverse.mockRejectedValue(new AIServiceError('Service unavailable', 503));

      await expect(handler.clarify(baseContext)).rejects.toThrow('AI service error (503)');
    });
  });

  describe('malformed response handling (Zod validation failure)', () => {
    it('throws on clarify response with missing required fields', async () => {
      mockConverse.mockResolvedValue({ questions: [{ id: 'q1' }] });

      await expect(handler.clarify(baseContext)).rejects.toThrow();
    });

    it('throws on clarify response exceeding 5 questions', async () => {
      mockConverse.mockResolvedValue({
        questions: Array.from({ length: 6 }, (_, i) => ({
          id: `q${i}`,
          question: `Question ${i}`,
          context: `Context ${i}`,
        })),
      });

      await expect(handler.clarify(baseContext)).rejects.toThrow();
    });

    it('throws on plan response with empty sprintGoal', async () => {
      mockConverse.mockResolvedValue({ ...validPlanResponse, sprintGoal: '' });

      await expect(handler.plan(baseContext)).rejects.toThrow();
    });

    it('throws on plan response with task missing acceptance criteria', async () => {
      mockConverse.mockResolvedValue({
        ...validPlanResponse,
        tasks: [
          {
            id: 'task-1',
            title: 'A task',
            description: 'Desc',
            priority: 'high',
            acceptanceCriteria: [],
          },
        ],
      });

      await expect(handler.plan(baseContext)).rejects.toThrow();
    });

    it('throws on break-down response with empty subtasks', async () => {
      mockConverse.mockResolvedValue({
        parentTaskId: 'task-1',
        parentTaskTitle: 'Task 1',
        subtasks: [],
      });

      await expect(handler.breakDown(baseContext, 'task-1')).rejects.toThrow();
    });
  });

  describe('model and tool config', () => {
    it('uses Amazon Nova Lite by default', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      await handler.clarify(baseContext);

      expect(mockConverse.mock.calls[0][0].modelId).toBe(DEFAULT_BEDROCK_MODEL_ID);
    });

    it('forces clarify_output tool choice', async () => {
      mockConverse.mockResolvedValue(validClarifyResponse);

      await handler.clarify(baseContext);

      expect(mockConverse.mock.calls[0][0].toolConfig.toolChoice.tool.name).toBe(
        'clarify_output'
      );
    });
  });
});
