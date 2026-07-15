import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { CollaborativeEditor, humanOnlyAwarenessFilter } from './CollaborativeEditor';

// Create a minimal mock of YPartyKitProvider with awareness
function createMockProvider() {
  const awareness = {
    clientID: 1,
    getLocalState: vi.fn(() => ({})),
    setLocalStateField: vi.fn(),
    getStates: vi.fn(() => new Map()),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    awareness,
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

describe('CollaborativeEditor', () => {
  let doc: Y.Doc;
  let provider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getXmlFragment('notes');
    provider = createMockProvider();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('renders the editor wrapper', () => {
    const { container } = render(
      <CollaborativeEditor doc={doc} provider={provider} />
    );
    const wrapper = container.querySelector('.collaborative-editor-wrapper');
    expect(wrapper).not.toBeNull();
  });

  it('renders a contenteditable element with proper aria attributes', () => {
    render(<CollaborativeEditor doc={doc} provider={provider} />);
    const editor = screen.getByRole('textbox');
    expect(editor).toBeDefined();
    expect(editor.getAttribute('aria-multiline')).toBe('true');
    expect(editor.getAttribute('aria-label')).toBe('Collaborative notes editor');
  });

  it('binds to Y.XmlFragment("notes")', () => {
    const fragment = doc.getXmlFragment('notes');
    // Insert content into the fragment before rendering
    const el = new Y.XmlElement('paragraph');
    el.insert(0, [new Y.XmlText('Hello from Yjs')]);
    fragment.insert(0, [el]);

    render(<CollaborativeEditor doc={doc} provider={provider} />);
    const editor = screen.getByRole('textbox');
    expect(editor.textContent).toContain('Hello from Yjs');
  });

  describe('humanOnlyAwarenessFilter', () => {
    it('hides the local client caret', () => {
      expect(
        humanOnlyAwarenessFilter(1, 1, { user: { type: 'human' } })
      ).toBe(false);
    });

    it('hides AI awareness carets', () => {
      expect(
        humanOnlyAwarenessFilter(1, 2, { user: { type: 'ai' } })
      ).toBe(false);
    });

    it('shows other human carets', () => {
      expect(
        humanOnlyAwarenessFilter(1, 3, { user: { type: 'human' } })
      ).toBe(true);
    });
  });
});
