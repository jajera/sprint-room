import { useEffect, useRef, useState } from 'react';
import YPartyKitProvider from 'y-partykit/provider';
import type * as Y from 'yjs';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface UsePartyProviderOptions {
  /** PartyKit host. Defaults to VITE_PARTYKIT_HOST, then localhost:1999 in dev. */
  host?: string;
  /**
   * Display name passed as ?name= on the PartyKit connection.
   * Connection is deferred until a non-empty name is provided (join gate).
   */
  participantName?: string;
}

interface UsePartyProviderReturn {
  provider: YPartyKitProvider | null;
  status: ConnectionStatus;
  isReconnecting: boolean;
  host: string;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const BACKOFF_DELAYS = [1000, 2000, 4000];

export function resolvePartyKitHost(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = import.meta.env.VITE_PARTYKIT_HOST as string | undefined;
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'localhost:1999';
  return window.location.host;
}

/**
 * Connects a Y.Doc to a PartyKit room via y-partykit.
 * Only binary Yjs frames go over this socket — no app JSON (that corrupts Yjs).
 */
export function usePartyProvider(
  roomId: string,
  doc: Y.Doc,
  options: UsePartyProviderOptions = {}
): UsePartyProviderReturn {
  const { host: hostOpt, participantName } = options;
  const partyHost = resolvePartyKitHost(hostOpt);
  const [provider, setProvider] = useState<YPartyKitProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId || !doc || !participantName?.trim()) {
      setProvider(null);
      setStatus('disconnected');
      return;
    }

    const next = new YPartyKitProvider(partyHost, roomId, doc, {
      connect: true,
      params: { name: participantName.trim() },
    });

    setProvider(next);
    setStatus('connecting');
    reconnectAttemptsRef.current = 0;

    const handleDisconnect = () => {
      const attempt = reconnectAttemptsRef.current;

      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setStatus('disconnected');
        return;
      }

      setStatus('reconnecting');
      const delay = BACKOFF_DELAYS[attempt] ?? BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
      reconnectAttemptsRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(() => {
        if (next && !next.wsconnected) {
          next.connect();
        }
      }, delay);
    };

    const handleStatus = ({ status: wsStatus }: { status: string }) => {
      if (wsStatus === 'connected') {
        reconnectAttemptsRef.current = 0;
        setStatus('connected');
      } else if (wsStatus === 'disconnected') {
        handleDisconnect();
      }
    };

    next.on('status', handleStatus);

    return () => {
      next.off('status', handleStatus);

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      next.disconnect();
      next.destroy();
      setProvider(null);
    };
  }, [roomId, doc, partyHost, participantName]);

  return {
    provider,
    status,
    isReconnecting: status === 'reconnecting',
    host: partyHost,
  };
}
