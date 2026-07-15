import { AwsClient } from 'aws4fetch';
import { AI_ABORT_MS } from '../shared/constants';
import type {
  RoomContext,
  ClarifyOutput,
  SprintPacket,
  BreakDownOutput,
} from '../shared/types';
import {
  ClarifyOutputSchema,
  SprintPacketSchema,
  BreakDownOutputSchema,
} from './schemas';

// --- System preamble shared across all AI actions ---

const SYSTEM_PREAMBLE = `You are Sprint AI, a planning teammate in a multiplayer sprint room.
Ground every output in the provided room context only.
Do not invent stakeholders, systems, deadlines, or constraints.
If information is missing, state assumptions explicitly or ask questions
instead of guessing.
Keep language concise and action-oriented for sprint kickoff use.
Preserve prior team decisions and answered clarifications unless the
latest context clearly supersedes them.`;

const CLARIFY_INSTRUCTIONS = `Your task: generate clarifying questions for the team.
- Ask at most 5 questions.
- Focus on scope boundaries, ownership, blockers, and missing constraints that would block a usable sprint packet.
- Skip questions that have already been answered in the clarifications.
- Each question must include a short "context" explaining why it matters for planning.
- Call the clarify_output tool with your result.`;

const PLAN_INSTRUCTIONS = `Your task: generate a sprint-ready packet from the shared context.
- Include: sprint goal, in-scope items, out-of-scope items, prioritized tasks with acceptance criteria, and risks/dependencies.
- If context is thin, produce your best-effort packet and fill the "assumptions" array with what you assumed.
- Each task needs an id, title, description, priority (high/medium/low), and at least one acceptance criterion.
- For top-level tasks omit parentTaskId (do not use an empty string).
- Call the sprint_packet tool with your result.`;

const BREAK_DOWN_INSTRUCTIONS = `Your task: break down the specified parent task into sprint-sized subtasks.
- Each subtask needs an id, title, description, priority, and at least one acceptance criterion.
- Keep subtasks scoped to work that fits a single sprint.
- Preserve the parentTaskId reference.
- Call the break_down_output tool with your result.`;

/** Default Amazon Nova Lite on Bedrock (cost-efficient, Converse + tools). Override with BEDROCK_MODEL_ID. */
export const DEFAULT_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';

const TEMPERATURE_CLARIFY = 0.4;
const TEMPERATURE_PLAN = 0.3;
const TEMPERATURE_BREAK_DOWN = 0.3;

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1000, 2000];

export class AITimeoutError extends Error {
  constructor() {
    super('AI took too long — try again');
    this.name = 'AITimeoutError';
  }
}

export class AIServiceError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export class AIValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIValidationError';
  }
}

export interface BedrockToolConfig {
  tools: Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: { json: Record<string, unknown> };
    };
  }>;
  toolChoice: { tool: { name: string } };
}

export type ConverseRequestFn = (args: {
  region: string;
  modelId: string;
  systemText: string;
  userText: string;
  temperature: number;
  toolConfig: BedrockToolConfig;
  signal: AbortSignal;
}) => Promise<Record<string, unknown>>;

function formatContextMessage(context: RoomContext, taskId?: string): string {
  const parts: string[] = [];

  if (context.participantNames.length > 0) {
    parts.push(`## Participants\n${context.participantNames.join(', ')}`);
  }

  if (context.rawInputs.length > 0) {
    const inputs = context.rawInputs
      .map((i) => `- [${i.authorName}]: ${i.content}`)
      .join('\n');
    parts.push(`## Raw Inputs\n${inputs}`);
  }

  const answered = context.clarifications.filter((c) => c.answer !== null);
  const unanswered = context.clarifications.filter((c) => c.answer === null);

  if (answered.length > 0) {
    const qs = answered
      .map((c) => `- Q: ${c.question}\n  A: ${c.answer}`)
      .join('\n');
    parts.push(`## Answered Clarifications\n${qs}`);
  }

  if (unanswered.length > 0) {
    const qs = unanswered.map((c) => `- Q: ${c.question}`).join('\n');
    parts.push(`## Unanswered Clarifications\n${qs}`);
  }

  if (context.currentPacket) {
    parts.push(`## Current Sprint Packet\n${JSON.stringify(context.currentPacket, null, 2)}`);
  }

  if (context.notes?.trim()) {
    parts.push(`## Shared Notes\n${context.notes.trim()}`);
  }

  if (taskId) {
    parts.push(`## Target Task ID\n${taskId}`);
  }

  return parts.join('\n\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Flat task schema (no $ref — Bedrock tool schemas are stricter). */
const TASK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    parentTaskId: { type: 'string' },
  },
  required: ['id', 'title', 'description', 'priority', 'acceptanceCriteria'],
};

const CLARIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          context: { type: 'string' },
        },
        required: ['id', 'question', 'context'],
      },
    },
  },
  required: ['questions'],
};

const SPRINT_PACKET_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    sprintGoal: { type: 'string' },
    inScope: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: TASK_JSON_SCHEMA },
    risksAndDependencies: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['sprintGoal', 'inScope', 'outOfScope', 'tasks', 'risksAndDependencies'],
};

const BREAK_DOWN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    parentTaskId: { type: 'string' },
    parentTaskTitle: { type: 'string' },
    subtasks: { type: 'array', items: TASK_JSON_SCHEMA },
  },
  required: ['parentTaskId', 'parentTaskTitle', 'subtasks'],
};

function buildToolConfig(
  name: string,
  description: string,
  schema: Record<string, unknown>,
): BedrockToolConfig {
  return {
    tools: [
      {
        toolSpec: {
          name,
          description,
          inputSchema: { json: schema },
        },
      },
    ],
    toolChoice: { tool: { name } },
  };
}

function extractToolInput(response: {
  output?: { message?: { content?: Array<{ toolUse?: { input?: unknown } }> } };
}): Record<string, unknown> {
  const content = response.output?.message?.content;
  if (!content) {
    throw new AIServiceError('Empty response from Bedrock');
  }

  for (const block of content) {
    if (block.toolUse?.input && typeof block.toolUse.input === 'object') {
      return block.toolUse.input as Record<string, unknown>;
    }
  }

  throw new AIServiceError('Bedrock response missing tool output');
}

function readEnvCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
} {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new AIServiceError(
      'Missing AWS credentials in the PartyKit worker. Restart with `npm run partykit:dev` (writes resolved keys to .env.local) or put AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.local.',
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

/** Workers-safe Bedrock Converse via aws4fetch (no Node fs/credential providers). */
export const defaultConverseRequest: ConverseRequestFn = async ({
  region,
  modelId,
  systemText,
  userText,
  temperature,
  toolConfig,
  signal,
}) => {
  const creds = readEnvCredentials();
  const aws = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
    region,
    service: 'bedrock',
  });

  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  const response = await aws.fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      system: [{ text: systemText }],
      messages: [{ role: 'user', content: [{ text: userText }] }],
      inferenceConfig: { temperature, maxTokens: 4096 },
      toolConfig,
    }),
    signal,
  });

  if (response.status === 429) {
    const err = new AIServiceError('Rate limited by Bedrock — try again later', 429);
    throw err;
  }

  if (response.status >= 500) {
    throw new AIServiceError(
      `AI service error (${response.status}) — try again later`,
      response.status,
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new AIServiceError(
      `Bedrock error (${response.status}): ${text.slice(0, 400)}`,
      response.status,
    );
  }

  const json = (await response.json()) as Parameters<typeof extractToolInput>[0];
  return extractToolInput(json);
};

async function callBedrock(
  converse: ConverseRequestFn,
  region: string,
  modelId: string,
  systemText: string,
  userText: string,
  temperature: number,
  toolConfig: BedrockToolConfig,
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  let attempts = 0;

  while (attempts <= MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_ABORT_MS);

    try {
      const result = await converse({
        region,
        modelId,
        systemText,
        userText,
        temperature,
        toolConfig,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return result;
    } catch (error: unknown) {
      clearTimeout(timeout);

      if (
        (error instanceof Error && error.name === 'AbortError') ||
        controller.signal.aborted
      ) {
        throw new AITimeoutError();
      }

      const status =
        error instanceof AIServiceError ? error.statusCode : undefined;
      const isThrottle = status === 429;

      if (isThrottle) {
        if (attempts < MAX_RETRIES) {
          lastError = error instanceof Error ? error : new Error(String(error));
          await sleep(RETRY_BACKOFF_MS[attempts]);
          attempts++;
          continue;
        }
        throw new AIServiceError('Rate limited by Bedrock — try again later', 429);
      }

      if (status && status >= 500) {
        throw new AIServiceError(`AI service error (${status}) — try again later`, status);
      }

      if (error instanceof AIServiceError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown AI error';
      throw new AIServiceError(message, status);
    }
  }

  throw lastError || new AIServiceError('AI call failed after retries');
}

export interface AIHandler {
  clarify(context: RoomContext): Promise<ClarifyOutput>;
  plan(context: RoomContext): Promise<SprintPacket>;
  breakDown(context: RoomContext, taskId: string): Promise<BreakDownOutput>;
}

export interface CreateAIHandlerOptions {
  /** Defaults to AWS_REGION or us-east-1 */
  region?: string;
  /** Defaults to BEDROCK_MODEL_ID or amazon.nova-lite-v1:0 */
  modelId?: string;
  /** Injected for tests */
  converse?: ConverseRequestFn;
}

export function createAIHandler(options: CreateAIHandlerOptions = {}): AIHandler {
  const region = options.region || process.env.AWS_REGION || 'us-east-1';
  const modelId =
    options.modelId || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID;
  const converse = options.converse || defaultConverseRequest;

  return {
    async clarify(context: RoomContext): Promise<ClarifyOutput> {
      const raw = await callBedrock(
        converse,
        region,
        modelId,
        `${SYSTEM_PREAMBLE}\n\n${CLARIFY_INSTRUCTIONS}`,
        formatContextMessage(context),
        TEMPERATURE_CLARIFY,
        buildToolConfig(
          'clarify_output',
          'Clarifying questions for the sprint planning session',
          CLARIFY_JSON_SCHEMA,
        ),
      );
      return ClarifyOutputSchema.parse(raw);
    },

    async plan(context: RoomContext): Promise<SprintPacket> {
      const raw = await callBedrock(
        converse,
        region,
        modelId,
        `${SYSTEM_PREAMBLE}\n\n${PLAN_INSTRUCTIONS}`,
        formatContextMessage(context),
        TEMPERATURE_PLAN,
        buildToolConfig(
          'sprint_packet',
          'Structured sprint packet for kickoff',
          SPRINT_PACKET_JSON_SCHEMA,
        ),
      );
      return SprintPacketSchema.parse(raw);
    },

    async breakDown(context: RoomContext, taskId: string): Promise<BreakDownOutput> {
      const targetTask = context.currentPacket?.tasks.find((t) => t.id === taskId);
      const taskContext = targetTask
        ? `\n\n## Task to Break Down\n${JSON.stringify(targetTask, null, 2)}`
        : '';

      const raw = await callBedrock(
        converse,
        region,
        modelId,
        `${SYSTEM_PREAMBLE}\n\n${BREAK_DOWN_INSTRUCTIONS}`,
        formatContextMessage(context, taskId) + taskContext,
        TEMPERATURE_BREAK_DOWN,
        buildToolConfig(
          'break_down_output',
          'Subtasks for the selected parent task',
          BREAK_DOWN_JSON_SCHEMA,
        ),
      );
      return BreakDownOutputSchema.parse(raw);
    },
  };
}
