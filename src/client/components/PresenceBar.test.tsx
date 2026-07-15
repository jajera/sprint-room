import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PresenceBar, { PresenceParticipant } from './PresenceBar';

describe('PresenceBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const humanAlice: PresenceParticipant = {
    id: 'conn_1',
    name: 'Alice',
    type: 'human',
    color: '#E4572E',
    isConnected: true,
  };

  const humanBob: PresenceParticipant = {
    id: 'conn_2',
    name: 'Bob',
    type: 'human',
    color: '#F4A261',
    isConnected: true,
  };

  const aiIdle: PresenceParticipant = {
    id: 'ai_agent',
    name: 'Sprint AI',
    type: 'ai',
    color: '#2A9D8F',
    isConnected: true,
    aiStatus: 'idle',
  };

  it('renders all connected participants', () => {
    render(<PresenceBar participants={[humanAlice, humanBob, aiIdle]} />);

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('Sprint AI')).toBeDefined();
  });

  it('renders a list with correct role', () => {
    render(<PresenceBar participants={[humanAlice]} />);
    expect(screen.getByRole('list', { name: /room participants/i })).toBeDefined();
  });

  it('shows AI badge for AI participant', () => {
    render(<PresenceBar participants={[aiIdle]} />);
    expect(screen.getByTestId('ai-badge')).toBeDefined();
    expect(screen.getByTestId('ai-badge').textContent).toBe('AI');
  });

  it('does not show AI badge for human participants', () => {
    render(<PresenceBar participants={[humanAlice]} />);
    expect(screen.queryByTestId('ai-badge')).toBeNull();
  });

  it('shows AI working status when clarifying', () => {
    const aiWorking: PresenceParticipant = {
      ...aiIdle,
      aiStatus: 'clarifying',
    };
    render(<PresenceBar participants={[aiWorking]} />);
    expect(screen.getByTestId('ai-status').textContent).toBe('clarifying…');
  });

  it('shows AI working status when planning', () => {
    const aiWorking: PresenceParticipant = {
      ...aiIdle,
      aiStatus: 'planning',
    };
    render(<PresenceBar participants={[aiWorking]} />);
    expect(screen.getByTestId('ai-status').textContent).toBe('planning…');
  });

  it('shows AI working status when breaking-down', () => {
    const aiWorking: PresenceParticipant = {
      ...aiIdle,
      aiStatus: 'breaking-down',
    };
    render(<PresenceBar participants={[aiWorking]} />);
    expect(screen.getByTestId('ai-status').textContent).toBe('breaking-down…');
  });

  it('does not show AI status text when idle', () => {
    render(<PresenceBar participants={[aiIdle]} />);
    expect(screen.queryByTestId('ai-status')).toBeNull();
  });

  it('renders presence color dots', () => {
    render(<PresenceBar participants={[humanAlice, aiIdle]} />);
    const aliceDot = screen.getByTestId('presence-dot-conn_1');
    const aiDot = screen.getByTestId('presence-dot-ai_agent');
    expect(aliceDot.style.backgroundColor).toBe('#E4572E');
    expect(aiDot.style.backgroundColor).toBe('#2A9D8F');
  });

  it('keeps disconnected human visible for up to 5 seconds', () => {
    const disconnectedAlice: PresenceParticipant = {
      ...humanAlice,
      isConnected: false,
    };
    render(<PresenceBar participants={[disconnectedAlice, aiIdle]} />);

    // Alice should still be visible initially
    expect(screen.getByText('Alice')).toBeDefined();
  });

  it('removes disconnected human after 5 seconds', () => {
    const disconnectedAlice: PresenceParticipant = {
      ...humanAlice,
      isConnected: false,
    };
    render(<PresenceBar participants={[disconnectedAlice, aiIdle]} />);

    // Alice visible before timer
    expect(screen.getByText('Alice')).toBeDefined();

    // Advance past 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Alice should be removed
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('does not remove disconnected human before 5 seconds', () => {
    const disconnectedAlice: PresenceParticipant = {
      ...humanAlice,
      isConnected: false,
    };
    render(<PresenceBar participants={[disconnectedAlice, aiIdle]} />);

    // Advance only 4 seconds
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Alice should still be visible
    expect(screen.getByText('Alice')).toBeDefined();
  });

  it('distinguishes humans from AI with aria-labels', () => {
    const aiWorking: PresenceParticipant = {
      ...aiIdle,
      aiStatus: 'planning',
    };
    render(<PresenceBar participants={[humanAlice, aiWorking]} />);

    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);

    // Human has plain name label
    expect(items[0].getAttribute('aria-label')).toBe('Alice');
    // AI has status label
    expect(items[1].getAttribute('aria-label')).toBe('Sprint AI (planning)');
  });

  it('renders empty state gracefully', () => {
    render(<PresenceBar participants={[]} />);
    const list = screen.getByRole('list', { name: /room participants/i });
    expect(list.children.length).toBe(0);
  });
});
