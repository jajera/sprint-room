import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import RawInputPanel from './RawInputPanel';

function createDoc(): Y.Doc {
  return new Y.Doc();
}

describe('RawInputPanel', () => {
  it('renders the heading and empty state', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByRole('heading', { name: /raw inputs/i })).toBeDefined();
    expect(screen.getByText(/no inputs yet/i)).toBeDefined();
  });

  it('renders the quick-add form with input and button', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    expect(screen.getByLabelText(/raw input text/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /add/i })).toBeDefined();
  });

  it('disables submit button when input is empty', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const button = screen.getByRole('button', { name: /add/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('enables submit button when input has text', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/raw input text/i);
    fireEvent.change(input, { target: { value: 'A new feature idea' } });

    const button = screen.getByRole('button', { name: /add/i });
    expect(button).toHaveProperty('disabled', false);
  });

  it('adds a raw input to Y.Doc on submit', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/raw input text/i);
    fireEvent.change(input, { target: { value: 'Fix login bug' } });
    fireEvent.submit(screen.getByRole('form', { name: /add raw input/i }));

    const rawInputs = doc.getArray('rawInputs');
    expect(rawInputs.length).toBe(1);

    const entry = rawInputs.get(0) as Y.Map<string | number>;
    expect(entry.get('authorId')).toBe('user-1');
    expect(entry.get('authorName')).toBe('Alice');
    expect(entry.get('content')).toBe('Fix login bug');
    expect(entry.get('id')).toBeDefined();
    expect(entry.get('timestamp')).toBeDefined();
  });

  it('clears input field after submit', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/raw input text/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Constraint: no auth' } });
    fireEvent.submit(screen.getByRole('form', { name: /add raw input/i }));

    expect(input.value).toBe('');
  });

  it('displays submitted inputs with author name', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/raw input text/i);
    fireEvent.change(input, { target: { value: 'Add dark mode' } });
    fireEvent.submit(screen.getByRole('form', { name: /add raw input/i }));

    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText(/add dark mode/i)).toBeDefined();
  });

  it('does not submit empty or whitespace-only input', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const input = screen.getByLabelText(/raw input text/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form', { name: /add raw input/i }));

    const rawInputs = doc.getArray('rawInputs');
    expect(rawInputs.length).toBe(0);
  });

  it('displays multiple inputs in reverse chronological order', () => {
    const doc = createDoc();
    const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');

    // Pre-seed two entries with known timestamps
    doc.transact(() => {
      const entry1 = new Y.Map<string | number>();
      entry1.set('id', 'id-1');
      entry1.set('authorId', 'user-1');
      entry1.set('authorName', 'Alice');
      entry1.set('content', 'First input');
      entry1.set('timestamp', 1000);
      rawInputs.push([entry1]);

      const entry2 = new Y.Map<string | number>();
      entry2.set('id', 'id-2');
      entry2.set('authorId', 'user-2');
      entry2.set('authorName', 'Bob');
      entry2.set('content', 'Second input');
      entry2.set('timestamp', 2000);
      rawInputs.push([entry2]);
    });

    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBe(2);
    // Newest first
    expect(listItems[0].textContent).toContain('Bob');
    expect(listItems[0].textContent).toContain('Second input');
    expect(listItems[1].textContent).toContain('Alice');
    expect(listItems[1].textContent).toContain('First input');
  });

  it('reacts to external Y.Doc changes (concurrent submits)', () => {
    const doc = createDoc();
    render(<RawInputPanel doc={doc} userId="user-1" userName="Alice" />);

    // Simulate another client pushing an input directly to the doc
    const rawInputs = doc.getArray<Y.Map<string | number>>('rawInputs');
    act(() => {
      doc.transact(() => {
        const entry = new Y.Map<string | number>();
        entry.set('id', 'remote-id');
        entry.set('authorId', 'user-2');
        entry.set('authorName', 'Bob');
        entry.set('content', 'Remote input');
        entry.set('timestamp', Date.now());
        rawInputs.push([entry]);
      });
    });

    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText(/remote input/i)).toBeDefined();
  });
});
