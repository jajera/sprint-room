import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { usePartyProvider } from './usePartyProvider';

// Mock y-partykit/provider
vi.mock('y-partykit/provider', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const listeners = new Map<string, Set<Function>>();
      return {
        wsconnected: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn((event: string, cb: Function) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(cb);
        }),
        off: vi.fn((event: string, cb: Function) => {
          listeners.get(event)?.delete(cb);
        }),
        _emit: (event: string, data: unknown) => {
          listeners.get(event)?.forEach(cb => cb(data));
        },
        _listeners: listeners,
      };
    }),
  };
});

describe('usePartyProvider', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts with connecting status when name provided', () => {
    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );
    expect(result.current.status).toBe('connecting');
    expect(result.current.isReconnecting).toBe(false);
  });

  it('transitions to connected on status event', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    // Get the mock provider instance
    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    act(() => {
      mockInstance._emit('status', { status: 'connected' });
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.isReconnecting).toBe(false);
  });

  it('transitions to reconnecting on disconnect', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    act(() => {
      mockInstance._emit('status', { status: 'connected' });
    });

    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });

    expect(result.current.status).toBe('reconnecting');
    expect(result.current.isReconnecting).toBe(true);
  });

  it('attempts reconnect with backoff delays', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    // First disconnect triggers 1s backoff
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });

    expect(result.current.status).toBe('reconnecting');

    // After 1s, connect should be called
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockInstance.connect).toHaveBeenCalledTimes(1);
  });

  it('gives up after max reconnect attempts', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    // Simulate 3 failed reconnection attempts
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // 4th disconnect — past max attempts
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });

    expect(result.current.status).toBe('disconnected');
    expect(result.current.isReconnecting).toBe(false);
  });

  it('resets reconnect counter on successful connection', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { result } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    // Disconnect then reconnect
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      mockInstance._emit('status', { status: 'connected' });
    });

    expect(result.current.status).toBe('connected');

    // Next disconnect should start fresh from attempt 0
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });

    expect(result.current.status).toBe('reconnecting');
  });

  it('cleans up provider on unmount', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { unmount } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    unmount();

    expect(mockInstance.disconnect).toHaveBeenCalled();
    expect(mockInstance.destroy).toHaveBeenCalled();
  });

  it('clears pending reconnect timer on unmount', async () => {
    const YPartyKitProvider = (await import('y-partykit/provider')).default;

    const { unmount } = renderHook(() =>
      usePartyProvider('room-1', doc, { host: 'localhost:1999', participantName: 'Alice' })
    );

    const mockInstance = vi.mocked(YPartyKitProvider).mock.results[0]?.value;

    // Start a reconnection cycle
    act(() => {
      mockInstance._emit('status', { status: 'disconnected' });
    });

    // Unmount before timer fires
    unmount();

    // Advancing timers shouldn't cause errors
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // connect should not have been called after unmount
    expect(mockInstance.connect).not.toHaveBeenCalled();
  });
});
