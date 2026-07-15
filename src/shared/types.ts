// Shared TypeScript interfaces and types for Sprint Room

/** Server-side room state tracking */
export interface RoomState {
  id: string; // nanoid(10)
  createdAt: number;
  creatorConnectionId: string;
  humanCount: number; // max 3
  aiActionInProgress: boolean;
  currentAiAction: 'clarify' | 'plan' | 'break-down' | null;
  status: 'active' | 'expired';
}

/** A participant in the room (human or AI) */
export interface Participant {
  id: string; // connection id or 'ai_agent'
  name: string;
  type: 'human' | 'ai';
  joinedAt: number;
  isConnected: boolean;
}

/**
 * App control plane (not sent on the Yjs WebSocket — that corrupts sync).
 * - Join: `?name=` on the PartyKit WebSocket URL
 * - AI: HTTP POST `{ type: 'ai-action', action, targetTaskId? }`
 * - Status/errors: Y.Map("meta") fields aiStatus / lastError
 */
export type AIActionRequest = {
  type: 'ai-action';
  action: 'clarify' | 'plan' | 'break-down';
  targetTaskId?: string;
};

/** @deprecated WS JSON join/AI was removed; kept for older test imports */
export type ClientMessage =
  | { type: 'join'; name: string }
  | AIActionRequest;

/** Snapshot historically sent as WS room-state (now derived in tests from server maps) */
export interface RoomStateSnapshot {
  room: RoomState;
  participants: Participant[];
}

/** @deprecated Prefer Y.Map("meta") + awareness; kept for test helpers */
export type ServerMessage =
  | { type: 'room-state'; state: RoomStateSnapshot }
  | { type: 'participant-joined'; participant: Participant }
  | { type: 'participant-left'; participantId: string }
  | { type: 'ai-status'; status: 'idle' | 'working'; action?: string }
  | { type: 'error'; message: string };

/** Awareness (presence) state broadcast via Yjs awareness protocol */
export interface AwarenessState {
  user: {
    id: string;
    name: string;
    color: string;
    type: 'human' | 'ai';
  };
  cursor?: { anchor: number; head: number };
  aiStatus?: 'idle' | 'clarifying' | 'planning' | 'breaking-down';
}

/** Context passed to the AI handler for each action */
export interface RoomContext {
  rawInputs: RawInput[];
  clarifications: Clarification[];
  currentPacket: SprintPacket | null;
  participantNames: string[];
  /** Plain text from TipTap / Y.XmlFragment("notes") */
  notes?: string;
}

/** A raw input submitted by a participant */
export interface RawInput {
  authorName: string;
  content: string;
}

/** A clarification question + optional answer */
export interface Clarification {
  question: string;
  answer: string | null;
}

/** Output of the AI clarify action */
export interface ClarifyOutput {
  questions: ClarifyQuestion[];
}

/** A single clarifying question from the AI */
export interface ClarifyQuestion {
  id: string;
  question: string;
  context: string; // why this question matters for planning
}

/** The structured sprint packet produced by the AI plan action */
export interface SprintPacket {
  sprintGoal: string;
  inScope: string[];
  outOfScope: string[];
  tasks: Task[];
  risksAndDependencies: string[];
  assumptions?: string[];
}

/** A task within the sprint packet */
export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  acceptanceCriteria: string[];
  subtasks?: Task[];
  parentTaskId?: string | null;
}

/** Output of the AI break-down action */
export interface BreakDownOutput {
  parentTaskId: string;
  parentTaskTitle: string;
  subtasks: Task[];
}
