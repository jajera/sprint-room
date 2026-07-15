import { useState, useEffect, useCallback, FormEvent } from 'react';
import * as Y from 'yjs';
import { nanoid } from 'nanoid';

export interface RawInputPanelProps {
  doc: Y.Doc;
  userId: string;
  userName: string;
}

interface RawInputItem {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
}

/**
 * Quick-add form for raw inputs (ideas, bugs, constraints).
 * Appends Y.Map entries to the shared Y.Array("rawInputs") so
 * concurrent submits from multiple clients merge conflict-free via CRDT.
 */
export default function RawInputPanel({ doc, userId, userName }: RawInputPanelProps) {
  const [inputText, setInputText] = useState('');
  const [items, setItems] = useState<RawInputItem[]>([]);

  const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');

  const syncItems = useCallback(() => {
    const current: RawInputItem[] = [];
    for (let i = 0; i < rawInputs.length; i++) {
      const map = rawInputs.get(i);
      current.push({
        id: map.get('id') as string,
        authorId: map.get('authorId') as string,
        authorName: map.get('authorName') as string,
        content: map.get('content') as string,
        timestamp: map.get('timestamp') as number,
      });
    }
    // Reverse chronological order (newest first)
    current.sort((a, b) => b.timestamp - a.timestamp);
    setItems(current);
  }, [rawInputs]);

  useEffect(() => {
    syncItems();
    rawInputs.observe(syncItems);
    return () => {
      rawInputs.unobserve(syncItems);
    };
  }, [rawInputs, syncItems]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const entry = new Y.Map<string | number>();
    entry.set('id', nanoid());
    entry.set('authorId', userId);
    entry.set('authorName', userName);
    entry.set('content', trimmed);
    entry.set('timestamp', Date.now());

    rawInputs.push([entry]);
    setInputText('');
  };

  return (
    <section aria-label="Raw inputs">
      <h2>Raw Inputs</h2>
      <form onSubmit={handleSubmit} aria-label="Add raw input">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Add idea, bug, or constraint…"
          aria-label="Raw input text"
        />
        <button type="submit" disabled={!inputText.trim()}>
          Add
        </button>
      </form>
      <ul aria-label="Submitted inputs">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.authorName}</strong>: {item.content}
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p>No inputs yet. Add ideas, bugs, or constraints to get started.</p>
      )}
    </section>
  );
}
