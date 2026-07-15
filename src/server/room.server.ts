import type * as Party from 'partykit/server';
import { onConnect, unstable_getYDoc } from 'y-partykit';
import {
  MAX_HUMANS,
  AI_ID,
  AI_NAME,
  ROOM_EXPIRY_MS,
} from '../shared/constants';
import type { RoomState, Participant } from '../shared/types';
import { createAIHandler, AITimeoutError } from './ai-handler';
import type { AIHandler } from './ai-handler';
import { buildContext } from './context-builder';
import {
  mergeClarifyOutput,
  mergePlanOutput,
  mergeBreakDownOutput,
  handleMergeError,
} from './ai-merge';

/** Shared y-partykit options — must match for onConnect and getYDoc */
const Y_OPTS = { persist: { mode: 'snapshot' as const } };

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * IMPORTANT: Do not send custom JSON over the Yjs WebSocket.
 * y-partykit treats unexpected string frames as Yjs updates and corrupts the doc
 * ("Unexpected end of array"). Use:
 * - connection query `?name=` for join/capacity
 * - HTTP onRequest for AI actions
 * - Y.Map("meta") for aiStatus / lastError broadcast
 */
export default class SprintRoomServer implements Party.Server {
  private roomState: RoomState | null = null;
  private participants: Map<string, Participant> = new Map();
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _aiHandler: AIHandler | null = null;

  constructor(readonly room: Party.Room) {}

  private get aiHandler(): AIHandler {
    if (!this._aiHandler) {
      this._aiHandler = createAIHandler();
    }
    return this._aiHandler;
  }

  private ensureRoomInitialized(creatorConnectionId: string): void {
    if (this.roomState) return;

    this.roomState = {
      id: this.room.id,
      createdAt: Date.now(),
      creatorConnectionId,
      humanCount: 0,
      aiActionInProgress: false,
      currentAiAction: null,
      status: 'active',
    };

    this.participants.set(AI_ID, {
      id: AI_ID,
      name: AI_NAME,
      type: 'ai',
      joinedAt: Date.now(),
      isConnected: true,
    });
  }

  private isRoomExpired(): boolean {
    if (!this.roomState) return false;
    return Date.now() - this.roomState.createdAt >= ROOM_EXPIRY_MS;
  }

  private connectedHumanCount(): number {
    return Array.from(this.participants.values()).filter(
      (p) => p.type === 'human' && p.isConnected
    ).length;
  }

  private async setMeta(
    patch: Record<string, string | number | null>
  ): Promise<void> {
    const doc = await unstable_getYDoc(this.room, Y_OPTS);
    const meta = doc.getMap('meta');
    doc.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        meta.set(key, value);
      }
    });
  }

  async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    this.ensureRoomInitialized(connection.id);

    if (this.isRoomExpired()) {
      this.roomState!.status = 'expired';
      connection.close(4004, 'Room expired');
      return;
    }

    const requestUrl = ctx?.request?.url || `http://room.local/?name=Anonymous`;
    const url = new URL(requestUrl);
    const name = (url.searchParams.get('name') || '').trim();

    if (!name) {
      connection.close(4001, 'Display name required');
      return;
    }
    if (name.length > 30) {
      connection.close(4001, 'Display name must be 1–30 characters');
      return;
    }

    // Reconnect of same connection id
    if (this.participants.has(connection.id)) {
      const timer = this.disconnectTimers.get(connection.id);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(connection.id);
      }
      const existing = this.participants.get(connection.id)!;
      existing.isConnected = true;
      existing.name = name;
    } else {
      if (this.connectedHumanCount() >= MAX_HUMANS) {
        connection.close(4003, 'Room is full (3 humans + AI)');
        return;
      }

      this.participants.set(connection.id, {
        id: connection.id,
        name,
        type: 'human',
        joinedAt: Date.now(),
        isConnected: true,
      });
    }

    this.roomState!.humanCount = this.connectedHumanCount();

    // Yjs sync only on this socket — no app JSON frames
    await onConnect(connection, this.room, Y_OPTS);
  }

  onClose(connection: Party.Connection): void {
    this.handleDisconnect(connection.id);
  }

  onError(connection: Party.Connection): void {
    this.handleDisconnect(connection.id);
  }

  /** HTTP API for AI actions (keeps Yjs WebSocket clean). */
  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }

    this.ensureRoomInitialized('http');

    if (this.isRoomExpired()) {
      return Response.json(
        { error: 'Room expired' },
        { status: 410, headers: CORS_HEADERS }
      );
    }

    let body: {
      type?: string;
      action?: 'clarify' | 'plan' | 'break-down';
      targetTaskId?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (body.type !== 'ai-action' || !body.action) {
      return Response.json(
        { error: 'Expected { type: "ai-action", action }' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (this.roomState!.aiActionInProgress) {
      return Response.json(
        { error: 'AI is busy' },
        { status: 409, headers: CORS_HEADERS }
      );
    }

    const valid = ['clarify', 'plan', 'break-down'] as const;
    if (!valid.includes(body.action)) {
      return Response.json(
        { error: 'Invalid AI action' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Kick off async work; respond immediately that work started
    this.roomState!.aiActionInProgress = true;
    this.roomState!.currentAiAction = body.action;
    void this.dispatchAiAction(body.action, body.targetTaskId);

    return Response.json(
      { ok: true, status: 'started', action: body.action },
      { headers: CORS_HEADERS }
    );
  }

  private handleDisconnect(connectionId: string): void {
    const participant = this.participants.get(connectionId);
    if (!participant || participant.type !== 'human') return;

    participant.isConnected = false;

    const timer = setTimeout(() => {
      this.participants.delete(connectionId);
      this.disconnectTimers.delete(connectionId);

      if (this.roomState) {
        this.roomState.humanCount = this.connectedHumanCount();
      }
    }, 5000);

    this.disconnectTimers.set(connectionId, timer);
  }

  private async dispatchAiAction(
    action: 'clarify' | 'plan' | 'break-down',
    targetTaskId?: string
  ): Promise<void> {
    try {
      await this.setMeta({
        aiStatus: action === 'break-down' ? 'breaking-down' : action === 'plan' ? 'planning' : 'clarifying',
        lastError: null,
      });

      const doc = await unstable_getYDoc(this.room, Y_OPTS);
      const participantNames = Array.from(this.participants.values())
        .filter((p) => p.type === 'human' && p.isConnected)
        .map((p) => p.name);
      const context = buildContext(doc, undefined, { participantNames });

      switch (action) {
        case 'clarify': {
          const result = await this.aiHandler.clarify(context);
          mergeClarifyOutput(doc, result);
          break;
        }
        case 'plan': {
          const result = await this.aiHandler.plan(context);
          mergePlanOutput(doc, result);
          break;
        }
        case 'break-down': {
          if (!targetTaskId) {
            await this.setMeta({
              aiStatus: 'idle',
              lastError: 'Break down requires a target task',
            });
            this.resetAiAction();
            return;
          }
          const result = await this.aiHandler.breakDown(context, targetTaskId);
          mergeBreakDownOutput(doc, result);
          break;
        }
      }

      await this.setMeta({ aiStatus: 'idle', lastError: null });
      this.resetAiAction();
    } catch (error: unknown) {
      this.resetAiAction();

      const errorMessage =
        error instanceof AITimeoutError
          ? 'AI took too long — try again'
          : error instanceof Error
            ? error.message
            : 'Unknown AI error';

      try {
        await this.setMeta({ aiStatus: 'idle', lastError: errorMessage });
        const doc = await unstable_getYDoc(this.room, Y_OPTS);
        handleMergeError(doc, errorMessage);
      } catch {
        // ignore secondary failures
      }
    }
  }

  public resetAiAction(): void {
    if (!this.roomState) return;
    this.roomState.aiActionInProgress = false;
    this.roomState.currentAiAction = null;
  }
}
