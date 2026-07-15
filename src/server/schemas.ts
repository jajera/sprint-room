import { z } from 'zod';

// --- Task Schema (recursive for subtasks) ---

/** Bedrock often emits "" for optional parentTaskId on top-level tasks. */
const OptionalParentTaskId = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.string().min(1).nullable(),
);

const BaseTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  parentTaskId: OptionalParentTaskId.optional(),
});

export type Task = z.infer<typeof BaseTaskSchema> & {
  subtasks?: Task[];
};

export const TaskSchema: z.ZodType<Task> = BaseTaskSchema.extend({
  subtasks: z.lazy(() => z.array(TaskSchema)).optional(),
});

// --- ClarifyQuestion Schema ---

export const ClarifyQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  context: z.string().min(1),
});

export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

// --- ClarifyOutput Schema ---

export const ClarifyOutputSchema = z.object({
  questions: z.array(ClarifyQuestionSchema).max(5),
});

export type ClarifyOutput = z.infer<typeof ClarifyOutputSchema>;

// --- SprintPacket Schema ---

export const SprintPacketSchema = z.object({
  sprintGoal: z.string().min(1),
  inScope: z.array(z.string()),
  outOfScope: z.array(z.string()),
  tasks: z.array(TaskSchema).min(1),
  risksAndDependencies: z.array(z.string()),
  assumptions: z.array(z.string()).optional(),
});

export type SprintPacket = z.infer<typeof SprintPacketSchema>;

// --- BreakDownOutput Schema ---

export const BreakDownOutputSchema = z.object({
  parentTaskId: z.string().min(1),
  parentTaskTitle: z.string().min(1),
  subtasks: z.array(TaskSchema).min(1),
});

export type BreakDownOutput = z.infer<typeof BreakDownOutputSchema>;
