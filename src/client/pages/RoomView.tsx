import { useState, useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type YPartyKitProvider from 'y-partykit/provider';
import PresenceBar, { PresenceParticipant } from '../components/PresenceBar';
import RawInputPanel from '../components/RawInputPanel';
import ClarificationsPanel from '../components/ClarificationsPanel';
import SprintPacketPanel from '../components/SprintPacketPanel';
import { CollaborativeEditor } from '../components/CollaborativeEditor';
import AIActionBar from '../components/AIActionBar';
import ExportControls from '../components/ExportControls';
import { AI_ID, AI_NAME, AI_COLOR } from '../../shared/constants';

/** Auto-dismiss delay for error toasts (ms) */
export const ERROR_DISMISS_MS = 5000;

export interface ErrorToast {
  id: string;
  message: string;
}

export interface RoomViewProps {
  roomId: string;
  userId: string;
  userName: string;
  doc: Y.Doc;
  provider: YPartyKitProvider;
  /** PartyKit host for HTTP AI actions (e.g. localhost:1999) */
  partyHost: string;
  isReconnecting: boolean;
  onCopyLink: () => void;
}

/**
 * Full Room view — single continuous layout covering the entire happy path
 * (Req 10.1, 10.4). No wizard or multi-step navigation.
 *
 * Layout:
 *   Header: brand/title + copy link + presence avatars
 *   Main (left): Raw inputs → Clarifications → Sprint Packet → Freeform notes
 *   Sidebar (right): AI actions + Export controls
 */
export default function RoomView({
  roomId,
  userId,
  userName,
  doc,
  provider,
  partyHost,
  isReconnecting,
  onCopyLink,
}: RoomViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isAIWorking, setIsAIWorking] = useState(false);
  const [aiStatus, setAiStatus] = useState<
    'idle' | 'clarifying' | 'planning' | 'breaking-down'
  >('idle');
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);
  const [errors, setErrors] = useState<ErrorToast[]>([]);
  const errorIdCounter = useRef(0);
  const lastErrorSeen = useRef<string | null>(null);

  // Auto-dismiss errors after ERROR_DISMISS_MS
  useEffect(() => {
    if (errors.length === 0) return;
    const timers = errors.map((err) =>
      setTimeout(() => {
        setErrors((prev) => prev.filter((e) => e.id !== err.id));
      }, ERROR_DISMISS_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [errors]);

  const addError = useCallback((message: string) => {
    const id = `err_${++errorIdCounter.current}`;
    setErrors((prev) => [...prev, { id, message }]);
  }, []);

  // Build presence list from awareness state
  const buildParticipants = useCallback((): PresenceParticipant[] => {
    const states = provider.awareness.getStates();
    const result: PresenceParticipant[] = [];

    states.forEach((state) => {
      if (state.user) {
        result.push({
          id: state.user.id,
          name: state.user.name,
          type: state.user.type || 'human',
          color: state.user.color || '#999',
          isConnected: true,
          aiStatus: state.aiStatus,
        });
      }
    });

    // Ensure AI is always visible in presence
    const hasAI = result.some((p) => p.id === AI_ID);
    if (!hasAI) {
      result.push({
        id: AI_ID,
        name: AI_NAME,
        type: 'ai',
        color: AI_COLOR,
        isConnected: true,
        aiStatus,
      });
    } else {
      // Overlay doc-driven AI status onto the AI participant
      return result.map((p) =>
        p.id === AI_ID || p.type === 'ai' ? { ...p, aiStatus } : p
      );
    }

    return result;
  }, [provider.awareness, aiStatus]);

  // Subscribe to awareness changes for presence updates
  useEffect(() => {
    const update = () => setParticipants(buildParticipants());
    update(); // initial
    provider.awareness.on('change', update);
    return () => {
      provider.awareness.off('change', update);
    };
  }, [provider.awareness, buildParticipants]);

  // AI status + errors via Y.Map("meta") — never JSON over the Yjs WebSocket
  useEffect(() => {
    const meta = doc.getMap('meta');
    // After Yjs sync, seed lastErrorSeen so joining doesn't toast a stale room error.
    let acceptErrors = provider.synced;

    const seedLastError = () => {
      const lastError = meta.get('lastError');
      lastErrorSeen.current =
        typeof lastError === 'string' && lastError ? lastError : null;
      acceptErrors = true;
    };

    const sync = () => {
      const status = (meta.get('aiStatus') as string) || 'idle';
      const normalized =
        status === 'clarifying' || status === 'planning' || status === 'breaking-down'
          ? status
          : 'idle';
      setAiStatus(normalized);
      setIsAIWorking(normalized !== 'idle');

      const lastError = meta.get('lastError');
      if (!acceptErrors) {
        return;
      }
      if (lastError == null || lastError === '') {
        lastErrorSeen.current = null;
        return;
      }
      if (typeof lastError === 'string' && lastError !== lastErrorSeen.current) {
        lastErrorSeen.current = lastError;
        addError(lastError);
      }
    };

    const onProviderSync = (isSynced: boolean) => {
      if (isSynced) {
        seedLastError();
        sync();
      }
    };

    if (provider.synced) {
      seedLastError();
    } else {
      provider.on('sync', onProviderSync);
    }

    sync();
    meta.observe(sync);
    return () => {
      meta.unobserve(sync);
      provider.off('sync', onProviderSync);
    };
  }, [doc, provider, addError]);

  // AI actions via PartyKit HTTP (keeps Yjs socket clean)
  const handleAIAction = useCallback(
    async (action: 'clarify' | 'plan' | 'break-down', targetTaskId?: string) => {
      if (isAIWorking) return;

      const url = `http://${partyHost}/parties/main/${roomId}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'ai-action', action, targetTaskId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          addError(data.error || `AI request failed (${res.status})`);
        }
      } catch (err) {
        addError(err instanceof Error ? err.message : 'Failed to reach AI server');
      }
    },
    [isAIWorking, partyHost, roomId, addError]
  );

  return (
    <div className="sr-room">
      {isReconnecting && (
        <div role="alert" aria-live="polite" style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
          Reconnecting…
        </div>
      )}

      {errors.length > 0 && (
        <div
          aria-live="assertive"
          role="status"
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {errors.map((err) => (
            <div key={err.id} role="alert" data-testid="error-toast" className="sr-error-toast">
              {err.message}
            </div>
          ))}
        </div>
      )}

      <header className="sr-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="sr-brand">Sprint Room</h1>
          <button onClick={onCopyLink} aria-label="Copy room link">
            Copy link
          </button>
        </div>
        <PresenceBar participants={participants} />
      </header>

      <div className="sr-layout">
        <main className="sr-main">
          <RawInputPanel doc={doc} userId={userId} userName={userName} />
          <ClarificationsPanel doc={doc} userId={userId} userName={userName} />
          <SprintPacketPanel
            doc={doc}
            onSelectTask={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
          />
          <section aria-label="Freeform notes">
            <h2>Notes</h2>
            <CollaborativeEditor doc={doc} provider={provider} />
          </section>
        </main>

        <aside className="sr-side">
          <AIActionBar
            onAction={handleAIAction}
            isAIWorking={isAIWorking}
            selectedTaskId={selectedTaskId ?? undefined}
          />
          <ExportControls doc={doc} />
        </aside>
      </div>
    </div>
  );
}
