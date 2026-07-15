import { useEffect, useRef, useState } from 'react';

export interface PresenceParticipant {
  id: string;
  name: string;
  type: 'human' | 'ai';
  color: string;
  isConnected: boolean;
  aiStatus?: 'idle' | 'clarifying' | 'planning' | 'breaking-down';
}

export interface PresenceBarProps {
  participants: PresenceParticipant[];
}

/** Delay before removing a disconnected human from the visible list (ms) */
const DISCONNECT_DROP_MS = 5000;

export default function PresenceBar({ participants }: PresenceBarProps) {
  // Track IDs that are still visible but pending removal (grace period)
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  // Track IDs that have been fully dropped (timers have expired)
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  // Keep a ref to active timers so we can clean up
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Find newly disconnected humans that haven't been handled yet
    const newlyDisconnected = participants.filter(
      (p) =>
        p.type === 'human' &&
        !p.isConnected &&
        !pendingRemoval.has(p.id) &&
        !dropped.has(p.id)
    );

    if (newlyDisconnected.length === 0) return;

    // Mark them as pending removal
    setPendingRemoval((prev) => {
      const next = new Set(prev);
      newlyDisconnected.forEach((p) => next.add(p.id));
      return next;
    });

    // Set timers to drop them after 5 seconds
    newlyDisconnected.forEach((p) => {
      const timer = setTimeout(() => {
        setPendingRemoval((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
        setDropped((prev) => {
          const next = new Set(prev);
          next.add(p.id);
          return next;
        });
        timersRef.current.delete(p.id);
      }, DISCONNECT_DROP_MS);
      timersRef.current.set(p.id, timer);
    });
  }, [participants, pendingRemoval, dropped]);

  // If a participant reconnects, clear them from dropped/pending
  useEffect(() => {
    participants.forEach((p) => {
      if (p.isConnected && (dropped.has(p.id) || pendingRemoval.has(p.id))) {
        // Cancel any pending timer
        const timer = timersRef.current.get(p.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(p.id);
        }
        setPendingRemoval((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
        setDropped((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      }
    });
  }, [participants, dropped, pendingRemoval]);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Visible participants: connected ones + disconnected humans still in grace period
  const visibleParticipants = participants.filter(
    (p) => p.isConnected || (p.type === 'human' && pendingRemoval.has(p.id))
  );

  return (
    <div
      role="list"
      aria-label="Room participants"
      style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
    >
      {visibleParticipants.map((participant) => (
        <PresenceAvatar key={participant.id} participant={participant} />
      ))}
    </div>
  );
}

function PresenceAvatar({ participant }: { participant: PresenceParticipant }) {
  const { name, type, color, isConnected, aiStatus } = participant;

  const displayLabel = getDisplayLabel(name, type, aiStatus);
  const opacity = isConnected ? 1 : 0.5;

  return (
    <div
      role="listitem"
      aria-label={displayLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        opacity,
      }}
    >
      {/* Color dot */}
      <span
        data-testid={`presence-dot-${participant.id}`}
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      {/* Name */}
      <span style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>{name}</span>
      {/* AI type badge */}
      {type === 'ai' && (
        <span
          data-testid="ai-badge"
          style={{
            fontSize: '10px',
            fontWeight: 'bold',
            backgroundColor: color,
            color: '#fff',
            padding: '1px 4px',
            borderRadius: '3px',
          }}
        >
          AI
        </span>
      )}
      {/* AI working status */}
      {type === 'ai' && aiStatus && aiStatus !== 'idle' && (
        <span
          data-testid="ai-status"
          style={{ fontSize: '12px', fontStyle: 'italic', color: '#666' }}
        >
          {aiStatus}…
        </span>
      )}
    </div>
  );
}

function getDisplayLabel(
  name: string,
  type: 'human' | 'ai',
  aiStatus?: string
): string {
  if (type === 'ai' && aiStatus && aiStatus !== 'idle') {
    return `${name} (${aiStatus})`;
  }
  return name;
}
