export interface AIActionBarProps {
  onAction: (action: 'clarify' | 'plan' | 'break-down', targetTaskId?: string) => void;
  isAIWorking: boolean;
  selectedTaskId?: string;
}

/**
 * AIActionBar — exposes Clarify, Plan, and Break Down actions to all participants.
 *
 * All actions stay in the same room view (no navigation).
 * Buttons are disabled while the AI is processing.
 * Break Down is additionally disabled when no task is selected.
 */
export default function AIActionBar({
  onAction,
  isAIWorking,
  selectedTaskId,
}: AIActionBarProps) {
  return (
    <section aria-label="AI actions">
      <h3>AI Actions</h3>

      {isAIWorking && (
        <p aria-live="polite" role="status">
          AI is working…
        </p>
      )}

      <div role="group" aria-label="AI action buttons">
        <button
          onClick={() => onAction('clarify')}
          disabled={isAIWorking}
          aria-disabled={isAIWorking}
        >
          Clarify
        </button>

        <button
          onClick={() => onAction('plan')}
          disabled={isAIWorking}
          aria-disabled={isAIWorking}
        >
          Plan
        </button>

        <button
          onClick={() => onAction('break-down', selectedTaskId)}
          disabled={isAIWorking || !selectedTaskId}
          aria-disabled={isAIWorking || !selectedTaskId}
        >
          Break Down
        </button>
      </div>
    </section>
  );
}
