import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import ClarificationsPanel from './ClarificationsPanel';

function createDoc(): Y.Doc {
  return new Y.Doc();
}

function addClarification(
  doc: Y.Doc,
  opts: {
    questionId: string;
    question: string;
    questionContext?: string;
    answer?: string | null;
    answeredBy?: string | null;
    timestamp?: number;
  }
) {
  const clarifications = doc.getArray<Y.Map<string | number | null>>('clarifications');
  doc.transact(() => {
    const map = new Y.Map<string | number | null>();
    map.set('questionId', opts.questionId);
    map.set('question', opts.question);
    map.set('questionContext', opts.questionContext || '');
    map.set('answer', opts.answer ?? null);
    map.set('answeredBy', opts.answeredBy ?? null);
    map.set('timestamp', opts.timestamp ?? Date.now());
    clarifications.push([map]);
  });
}

describe('ClarificationsPanel', () => {
  it('renders heading and empty state when no clarifications exist', () => {
    const doc = createDoc();
    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByRole('heading', { name: /clarifications/i })).toBeDefined();
    expect(screen.getByText(/no clarification questions yet/i)).toBeDefined();
  });

  it('displays clarification questions from Y.Doc', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What is the target audience?',
      questionContext: 'Helps scope the MVP features',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByText('What is the target audience?')).toBeDefined();
    expect(screen.getByText('Helps scope the MVP features')).toBeDefined();
  });

  it('shows answer input for unanswered questions', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What is the deadline?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByLabelText(/answer for: what is the deadline\?/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /submit/i })).toBeDefined();
  });

  it('disables submit button when answer input is empty', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What integrations are needed?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const button = screen.getByRole('button', { name: /submit/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('enables submit button when answer text is entered', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What is the budget?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/answer for: what is the budget\?/i);
    fireEvent.change(input, { target: { value: 'Under 10k' } });

    const button = screen.getByRole('button', { name: /submit/i });
    expect(button).toHaveProperty('disabled', false);
  });

  it('writes answer and answeredBy to Y.Doc on submit', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'Who owns deployment?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/answer for: who owns deployment\?/i);
    fireEvent.change(input, { target: { value: 'DevOps team' } });
    fireEvent.submit(screen.getByRole('form', { name: /answer question: who owns deployment\?/i }));

    const clarifications = doc.getArray<Y.Map<string | number | null>>('clarifications');
    const map = clarifications.get(0);
    expect(map.get('answer')).toBe('DevOps team');
    expect(map.get('answeredBy')).toBe('Alice');
  });

  it('displays answered questions as read-only', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What platforms to support?',
      answer: 'Web and mobile',
      answeredBy: 'Bob',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByText('What platforms to support?')).toBeDefined();
    expect(screen.getByText(/answered by bob/i)).toBeDefined();
    expect(screen.getByText(/web and mobile/i)).toBeDefined();
    // No input field for answered question
    expect(screen.queryByLabelText(/answer for: what platforms to support\?/i)).toBeNull();
  });

  it('sorts unanswered questions before answered ones', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'Answered question',
      answer: 'Yes',
      answeredBy: 'Bob',
      timestamp: 1000,
    });
    addClarification(doc, {
      questionId: 'q2',
      question: 'Unanswered question',
      timestamp: 2000,
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0].textContent).toContain('Unanswered question');
    expect(listItems[1].textContent).toContain('Answered question');
  });

  it('reacts to external Y.Doc changes (AI adding new questions)', () => {
    const doc = createDoc();
    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    // Initially empty
    expect(screen.getByText(/no clarification questions yet/i)).toBeDefined();

    // Simulate AI adding a question
    act(() => {
      addClarification(doc, {
        questionId: 'q-new',
        question: 'What is the primary user persona?',
        questionContext: 'Needed for feature prioritization',
      });
    });

    expect(screen.getByText('What is the primary user persona?')).toBeDefined();
    expect(screen.getByText('Needed for feature prioritization')).toBeDefined();
  });

  it('clears draft input after submitting an answer', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'What is the scope?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/answer for: what is the scope\?/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'MVP only' } });
    fireEvent.submit(screen.getByRole('form', { name: /answer question: what is the scope\?/i }));

    // After submitting, the question becomes answered — no input field
    expect(screen.queryByLabelText(/answer for: what is the scope\?/i)).toBeNull();
  });

  it('does not submit whitespace-only answers', () => {
    const doc = createDoc();
    addClarification(doc, {
      questionId: 'q1',
      question: 'Any constraints?',
    });

    render(<ClarificationsPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/answer for: any constraints\?/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form', { name: /answer question: any constraints\?/i }));

    const clarifications = doc.getArray<Y.Map<string | number | null>>('clarifications');
    const map = clarifications.get(0);
    expect(map.get('answer')).toBeNull();
  });
});
