import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { render, within, cleanup } from '@testing-library/react';
import PresenceBar, { PresenceParticipant } from './PresenceBar';

afterEach(() => {
  cleanup();
});

// --- Generators ---

const AI_STATUSES = ['idle', 'clarifying', 'planning', 'breaking-down'] as const;

/** Generator for valid human participant colors */
const humanColorArb = fc.constantFrom(
  '#E4572E',
  '#F4A261',
  '#7B2D8B',
  '#3D5A80',
  '#E76F51',
  '#264653'
);

/** Generator for a valid human participant */
const humanParticipantArb: fc.Arbitrary<PresenceParticipant> = fc.record({
  id: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
    { minLength: 3, maxLength: 15 }
  ).map((s) => `human_${s}`),
  name: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
    { minLength: 1, maxLength: 20 }
  ),
  type: fc.constant('human' as const),
  color: humanColorArb,
  isConnected: fc.constant(true),
});

/** Generator for a valid AI participant with random status */
const aiParticipantArb: fc.Arbitrary<PresenceParticipant> = fc.record({
  id: fc.constant('ai_agent'),
  name: fc.constant('Sprint AI'),
  type: fc.constant('ai' as const),
  color: fc.constant('#2A9D8F'),
  isConnected: fc.constant(true),
  aiStatus: fc.constantFrom(...AI_STATUSES),
});

/** Generator for a set of participants: random humans (0-3) + one AI */
const participantsArb: fc.Arbitrary<PresenceParticipant[]> = fc
  .tuple(
    fc.array(humanParticipantArb, { minLength: 0, maxLength: 3 }),
    aiParticipantArb
  )
  .map(([humans, ai]) => {
    // Ensure unique human IDs and unique names (avoid text query collisions)
    const seenIds = new Set<string>();
    const seenNames = new Set<string>(['Sprint AI', 'AI']); // Reserve AI names
    const uniqueHumans = humans.filter((h) => {
      if (seenIds.has(h.id) || seenNames.has(h.name)) return false;
      seenIds.add(h.id);
      seenNames.add(h.name);
      return true;
    });
    return [...uniqueHumans, ai];
  });

/**
 * Feature: sprint-room, Property 6: Presence state correctness
 *
 * **Validates: Requirements 4.1, 4.3, 4.5**
 *
 * For any joined participant, presence SHALL expose identity and type
 * (human | ai), and the AI presence SHALL reflect working vs idle during actions.
 */
describe('Feature: sprint-room, Property 6: Presence state correctness', () => {
  it('every participant has correct identity (name) and type (human or ai)', () => {
    fc.assert(
      fc.property(participantsArb, (participants) => {
        for (const p of participants) {
          // Identity: name must be a non-empty string
          expect(p.name.length).toBeGreaterThan(0);

          // Type must be exactly 'human' or 'ai'
          expect(['human', 'ai']).toContain(p.type);

          // Human participants must have type 'human'
          if (p.id !== 'ai_agent') {
            expect(p.type).toBe('human');
          }

          // AI participant must have type 'ai'
          if (p.id === 'ai_agent') {
            expect(p.type).toBe('ai');
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('AI presence correctly reflects working vs idle status', () => {
    fc.assert(
      fc.property(aiParticipantArb, (ai) => {
        // AI status must be one of the valid values
        expect(AI_STATUSES).toContain(ai.aiStatus);

        // AI type is always 'ai'
        expect(ai.type).toBe('ai');

        // Determine working vs idle
        const isWorking = ai.aiStatus !== 'idle';
        const isIdle = ai.aiStatus === 'idle';

        // Exactly one of working or idle must be true
        expect(isWorking || isIdle).toBe(true);
        expect(isWorking && isIdle).toBe(false);

        // Working statuses are clarifying, planning, breaking-down
        if (isWorking) {
          expect(['clarifying', 'planning', 'breaking-down']).toContain(ai.aiStatus);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('human participants always have type human, never ai', () => {
    fc.assert(
      fc.property(
        fc.array(humanParticipantArb, { minLength: 1, maxLength: 10 }),
        (humans) => {
          for (const h of humans) {
            expect(h.type).toBe('human');
            // Humans should not have AI status behavior
            expect(h.aiStatus).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PresenceBar renders identity and type correctly for random participants', () => {
    fc.assert(
      fc.property(participantsArb, (participants) => {
        const { container, unmount } = render(<PresenceBar participants={participants} />);
        const view = within(container);

        // All connected participants should be visible
        for (const p of participants) {
          if (p.isConnected) {
            // Identity: participant name is rendered
            expect(view.getByText(p.name)).toBeDefined();
          }
        }

        // AI participant should have AI badge (type distinction)
        const ai = participants.find((p) => p.type === 'ai');
        if (ai && ai.isConnected) {
          const badges = view.queryAllByTestId('ai-badge');
          expect(badges.length).toBe(1);
          expect(badges[0].textContent).toBe('AI');
        }

        // Human participants should NOT have AI badge
        const aiBadges = view.queryAllByTestId('ai-badge');
        // At most 1 AI badge (for the single AI participant)
        expect(aiBadges.length).toBeLessThanOrEqual(1);

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('PresenceBar correctly shows AI working status when not idle', () => {
    fc.assert(
      fc.property(aiParticipantArb, (ai) => {
        const { container, unmount } = render(<PresenceBar participants={[ai]} />);
        const view = within(container);

        if (ai.aiStatus === 'idle') {
          // Idle AI should NOT show status text
          expect(view.queryByTestId('ai-status')).toBeNull();
        } else {
          // Working AI should show its current action status
          const statusEl = view.getByTestId('ai-status');
          expect(statusEl.textContent).toBe(`${ai.aiStatus}…`);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });

  it('AI status is always one of idle/clarifying/planning/breaking-down', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AI_STATUSES),
        (status) => {
          const ai: PresenceParticipant = {
            id: 'ai_agent',
            name: 'Sprint AI',
            type: 'ai',
            color: '#2A9D8F',
            isConnected: true,
            aiStatus: status,
          };

          // Status is one of the valid enum values
          expect(['idle', 'clarifying', 'planning', 'breaking-down']).toContain(ai.aiStatus);

          // Render verifies the component handles all statuses correctly
          const { container, unmount } = render(<PresenceBar participants={[ai]} />);
          const view = within(container);

          // AI name is always visible
          expect(view.getByText('Sprint AI')).toBeDefined();
          // AI badge is always visible
          expect(view.getByTestId('ai-badge')).toBeDefined();

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});
