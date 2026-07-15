import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIActionBar from './AIActionBar';

describe('AIActionBar', () => {
  describe('rendering', () => {
    it('renders all three action buttons', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} />);

      expect(screen.getByRole('button', { name: /clarify/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /plan/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /break down/i })).toBeDefined();
    });

    it('renders with accessible section label', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} />);

      expect(screen.getByRole('region', { name: /ai actions/i })).toBeDefined();
    });

    it('does not show working indicator when AI is idle', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} />);

      expect(screen.queryByText(/ai is working/i)).toBeNull();
    });

    it('shows working indicator when AI is processing', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={true} />);

      expect(screen.getByText(/ai is working/i)).toBeDefined();
    });
  });

  describe('disabled state — AI working', () => {
    it('disables all buttons when isAIWorking is true', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={true} />);

      expect(screen.getByRole('button', { name: /clarify/i })).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: /plan/i })).toHaveProperty('disabled', true);
      expect(screen.getByRole('button', { name: /break down/i })).toHaveProperty('disabled', true);
    });

    it('enables Clarify and Plan when isAIWorking is false', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} selectedTaskId="task-1" />);

      expect(screen.getByRole('button', { name: /clarify/i })).toHaveProperty('disabled', false);
      expect(screen.getByRole('button', { name: /plan/i })).toHaveProperty('disabled', false);
    });
  });

  describe('disabled state — Break Down without selected task', () => {
    it('disables Break Down when no selectedTaskId is provided', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} />);

      expect(screen.getByRole('button', { name: /break down/i })).toHaveProperty('disabled', true);
    });

    it('enables Break Down when selectedTaskId is provided', () => {
      render(<AIActionBar onAction={vi.fn()} isAIWorking={false} selectedTaskId="task-1" />);

      expect(screen.getByRole('button', { name: /break down/i })).toHaveProperty('disabled', false);
    });
  });

  describe('action callbacks', () => {
    it('calls onAction with "clarify" when Clarify is clicked', () => {
      const onAction = vi.fn();
      render(<AIActionBar onAction={onAction} isAIWorking={false} />);

      fireEvent.click(screen.getByRole('button', { name: /clarify/i }));

      expect(onAction).toHaveBeenCalledWith('clarify');
    });

    it('calls onAction with "plan" when Plan is clicked', () => {
      const onAction = vi.fn();
      render(<AIActionBar onAction={onAction} isAIWorking={false} />);

      fireEvent.click(screen.getByRole('button', { name: /plan/i }));

      expect(onAction).toHaveBeenCalledWith('plan');
    });

    it('calls onAction with "break-down" and targetTaskId when Break Down is clicked', () => {
      const onAction = vi.fn();
      render(<AIActionBar onAction={onAction} isAIWorking={false} selectedTaskId="task-42" />);

      fireEvent.click(screen.getByRole('button', { name: /break down/i }));

      expect(onAction).toHaveBeenCalledWith('break-down', 'task-42');
    });

    it('does not call onAction when a disabled button is clicked', () => {
      const onAction = vi.fn();
      render(<AIActionBar onAction={onAction} isAIWorking={true} />);

      fireEvent.click(screen.getByRole('button', { name: /clarify/i }));
      fireEvent.click(screen.getByRole('button', { name: /plan/i }));
      fireEvent.click(screen.getByRole('button', { name: /break down/i }));

      expect(onAction).not.toHaveBeenCalled();
    });
  });
});
