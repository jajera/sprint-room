import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { useYDoc } from '../hooks/useYDoc';
import { usePartyProvider } from '../hooks/usePartyProvider';
import { HUMAN_COLORS } from '../../shared/constants';
import RoomView from './RoomView';

export type RoomStatus = 'join-gate' | 'joined' | 'not-found' | 'full';

export interface RoomPageProps {
  /** Override initial status for testing or external control */
  initialStatus?: RoomStatus;
}

function pickHumanColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % HUMAN_COLORS.length;
  }
  return HUMAN_COLORS[hash]!;
}

export default function RoomPage({ initialStatus = 'join-gate' }: RoomPageProps = {}) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<RoomStatus>(
    initialStatus === 'joined' ? 'join-gate' : initialStatus
  );
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  // Stable per-tab identity so same display names don't collide in awareness
  const clientId = useMemo(() => nanoid(10), []);

  const roomLink = `${window.location.origin}/room/${roomId}`;

  const doc = useYDoc();
  // Connect only after join — name is sent as ?name= (no JSON on the Yjs socket)
  const { provider, status: connectionStatus, isReconnecting, host } = usePartyProvider(
    roomId ?? '',
    doc,
    { participantName: displayName || undefined }
  );

  // After WS connects, set awareness + enter room view
  useEffect(() => {
    if (!displayName || !provider) return;

    if (connectionStatus === 'connected') {
      const userId = clientId;
      provider.awareness.setLocalStateField('user', {
        id: userId,
        name: displayName,
        color: pickHumanColor(`${roomId}_${userId}`),
        type: 'human',
      });
      setJoining(false);
      setJoinError('');
      setStatus('joined');
    }
  }, [connectionStatus, displayName, provider, roomId, clientId]);

  // Close codes from capacity / expiry
  useEffect(() => {
    if (!provider) return;

    const handleClose = (event: CloseEvent) => {
      setJoining(false);
      if (event.code === 4004) {
        setStatus('not-found');
        setDisplayName('');
      } else if (event.code === 4003) {
        setStatus('full');
        setJoinError('Room is full (3 humans + AI)');
        setDisplayName('');
      } else if (event.code === 4001) {
        setJoinError(event.reason || 'Invalid display name');
        setDisplayName('');
        setStatus('join-gate');
      }
    };

    const attach = () => {
      const ws = provider.ws;
      if (!ws) return null;
      ws.addEventListener('close', handleClose);
      return ws;
    };

    let ws = attach();
    const timer = window.setInterval(() => {
      if (!ws && provider.ws) ws = attach();
    }, 100);

    return () => {
      window.clearInterval(timer);
      if (ws) ws.removeEventListener('close', handleClose);
    };
  }, [provider]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = roomLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [roomLink]);

  const handleJoin = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 30) {
      setNameError('Name must be 1–30 characters');
      return;
    }
    setNameError('');
    setJoinError('');
    setJoining(true);
    // Triggers usePartyProvider connect with ?name=
    setDisplayName(trimmed);
  }, [name]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleJoin();
      }
    },
    [handleJoin]
  );

  const handleCreateNewRoom = useCallback(() => {
    navigate('/');
  }, [navigate]);

  if (status === 'not-found') {
    return (
      <div className="sr-gate">
        <h1>Room Not Found</h1>
        <p>This room is invalid or has expired.</p>
        <button className="sr-primary" onClick={handleCreateNewRoom}>
          Create new room
        </button>
      </div>
    );
  }

  if (status === 'joined') {
    if (!provider || connectionStatus !== 'connected') {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: '1rem',
          }}
        >
          <p>{isReconnecting ? 'Reconnecting…' : 'Connecting…'}</p>
        </div>
      );
    }

    return (
      <RoomView
        roomId={roomId!}
        userId={clientId}
        userName={displayName}
        doc={doc}
        provider={provider}
        partyHost={host}
        isReconnecting={isReconnecting}
        onCopyLink={handleCopyLink}
      />
    );
  }

  return (
    <div className="sr-gate">
      <h1>Join Sprint Room</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <code style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{roomLink}</code>
        <button onClick={handleCopyLink} aria-label="Copy link">
          {linkCopied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <label htmlFor="display-name" style={{ fontWeight: 600 }}>
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your name"
          maxLength={30}
          disabled={joining}
          aria-describedby={nameError ? 'name-error' : joinError ? 'join-error' : undefined}
          style={{ padding: '0.5rem 0.75rem', width: '14rem', borderRadius: 8, border: '1px solid var(--line)' }}
        />
        {nameError && (
          <span id="name-error" role="alert" style={{ color: 'var(--danger-ink)', fontSize: '0.85rem' }}>
            {nameError}
          </span>
        )}
        {joinError && (
          <span id="join-error" role="alert" style={{ color: 'var(--danger-ink)', fontSize: '0.85rem' }}>
            {joinError}
          </span>
        )}
        <button className="sr-primary" onClick={handleJoin} disabled={joining}>
          {joining ? 'Joining…' : 'Join'}
        </button>
      </div>
    </div>
  );
}
