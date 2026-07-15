import { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';

export interface ClarificationsPanelProps {
  doc: Y.Doc;
  userId: string;
  userName: string;
}

interface ClarificationItem {
  questionId: string;
  question: string;
  questionContext: string;
  answer: string | null;
  answeredBy: string | null;
  timestamp: number;
}

/**
 * Displays AI-generated clarification questions and allows participants
 * to answer them. Answers are written back into the Y.Doc so they become
 * part of the shared context for subsequent AI actions.
 *
 * Binds to Y.Array("clarifications") — each entry is a Y.Map with:
 * questionId, question, questionContext, answer, answeredBy, timestamp.
 */
export default function ClarificationsPanel({ doc, userId, userName }: ClarificationsPanelProps) {
  const [items, setItems] = useState<ClarificationItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const clarifications = doc.getArray<Y.Map<string | number | null>>('clarifications');

  const syncItems = useCallback(() => {
    const current: ClarificationItem[] = [];
    for (let i = 0; i < clarifications.length; i++) {
      const map = clarifications.get(i);
      current.push({
        questionId: map.get('questionId') as string,
        question: map.get('question') as string,
        questionContext: (map.get('questionContext') as string) || '',
        answer: (map.get('answer') as string | null) ?? null,
        answeredBy: (map.get('answeredBy') as string | null) ?? null,
        timestamp: (map.get('timestamp') as number) || 0,
      });
    }
    // Sort: unanswered first, then answered
    current.sort((a, b) => {
      if (a.answer === null && b.answer !== null) return -1;
      if (a.answer !== null && b.answer === null) return 1;
      return a.timestamp - b.timestamp;
    });
    setItems(current);
  }, [clarifications]);

  useEffect(() => {
    syncItems();

    // Observe the array itself (additions/removals)
    clarifications.observe(syncItems);

    // Also observe deep changes (answer written into a Y.Map)
    clarifications.observeDeep(syncItems);

    return () => {
      clarifications.unobserve(syncItems);
      clarifications.unobserveDeep(syncItems);
    };
  }, [clarifications, syncItems]);

  const handleDraftChange = (questionId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleSubmitAnswer = (questionId: string) => {
    const answer = (drafts[questionId] || '').trim();
    if (!answer) return;

    // Find the Y.Map in the array and write the answer
    for (let i = 0; i < clarifications.length; i++) {
      const map = clarifications.get(i);
      if (map.get('questionId') === questionId) {
        doc.transact(() => {
          map.set('answer', answer);
          map.set('answeredBy', userName);
        });
        break;
      }
    }

    // Clear draft
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  return (
    <section aria-label="Clarifications">
      <h2>Clarifications</h2>
      {items.length === 0 && (
        <p>No clarification questions yet. Trigger the Clarify action to generate questions.</p>
      )}
      <ul aria-label="Clarification questions">
        {items.map((item) => (
          <li key={item.questionId} data-testid={`clarification-${item.questionId}`}>
            <p><strong>{item.question}</strong></p>
            {item.questionContext && (
              <p className="question-context" aria-label="Question context">
                {item.questionContext}
              </p>
            )}
            {item.answer === null ? (
              <form
                aria-label={`Answer question: ${item.question}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmitAnswer(item.questionId);
                }}
              >
                <input
                  type="text"
                  value={drafts[item.questionId] || ''}
                  onChange={(e) => handleDraftChange(item.questionId, e.target.value)}
                  placeholder="Type your answer…"
                  aria-label={`Answer for: ${item.question}`}
                />
                <button
                  type="submit"
                  disabled={!(drafts[item.questionId] || '').trim()}
                >
                  Submit
                </button>
              </form>
            ) : (
              <p aria-label="Answer">
                <em>Answered by {item.answeredBy}:</em> {item.answer}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
