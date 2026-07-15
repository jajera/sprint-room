import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import ExportControls from './ExportControls';
import * as exportService from '../export';

vi.mock('../export', async () => {
  const actual = await vi.importActual('../export') as typeof exportService;
  return {
    ...actual,
    download: vi.fn(),
  };
});

/** Helper: create a Y.Doc with standard sprintPacket structure */
function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('sprintPacket');
  doc.getXmlFragment('notes');
  return doc;
}

/** Helper: seed a sprint packet with a goal and basic data */
function seedPacket(doc: Y.Doc) {
  const packetMap = doc.getMap('sprintPacket');
  doc.transact(() => {
    packetMap.set('sprintGoal', 'Deliver MVP');
    const inScope = new Y.Array<string>();
    inScope.push(['Feature A']);
    packetMap.set('inScope', inScope);
    const outOfScope = new Y.Array<string>();
    outOfScope.push(['Feature B']);
    packetMap.set('outOfScope', outOfScope);
    const tasks = new Y.Array();
    packetMap.set('tasks', tasks);
    const risks = new Y.Array<string>();
    risks.push(['Timeline risk']);
    packetMap.set('risksAndDependencies', risks);
    const assumptions = new Y.Array<string>();
    packetMap.set('assumptions', assumptions);
  });
}

describe('ExportControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no sprint packet exists', () => {
    it('renders disabled Markdown button', () => {
      const doc = createDoc();
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as markdown/i });
      expect(btn).toHaveProperty('disabled', true);
    });

    it('renders disabled JSON button', () => {
      const doc = createDoc();
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as json/i });
      expect(btn).toHaveProperty('disabled', true);
    });

    it('shows explanation message', () => {
      const doc = createDoc();
      render(<ExportControls doc={doc} />);

      expect(screen.getByText(/generate a sprint packet first/i)).toBeDefined();
    });
  });

  describe('when sprint packet exists', () => {
    it('renders enabled Markdown button', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as markdown/i });
      expect(btn).toHaveProperty('disabled', false);
    });

    it('renders enabled JSON button', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as json/i });
      expect(btn).toHaveProperty('disabled', false);
    });

    it('does not show explanation message', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      expect(screen.queryByText(/generate a sprint packet first/i)).toBeNull();
    });

    it('calls download with markdown format on Markdown button click', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as markdown/i });
      fireEvent.click(btn);

      expect(exportService.download).toHaveBeenCalledWith(
        'markdown',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        undefined
      );
    });

    it('calls download with json format on JSON button click', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as json/i });
      fireEvent.click(btn);

      expect(exportService.download).toHaveBeenCalledWith(
        'json',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        undefined
      );
    });

    it('exposes PRD, GitHub Issues, and Checklist export buttons', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<ExportControls doc={doc} />);

      fireEvent.click(screen.getByRole('button', { name: /export as prd outline/i }));
      expect(exportService.download).toHaveBeenCalledWith(
        'prd',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        undefined
      );

      fireEvent.click(screen.getByRole('button', { name: /export as github issues/i }));
      expect(exportService.download).toHaveBeenCalledWith(
        'issues',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        undefined
      );

      fireEvent.click(screen.getByRole('button', { name: /export as sprint checklist/i }));
      expect(exportService.download).toHaveBeenCalledWith(
        'checklist',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        undefined
      );
    });

    it('includes notes in markdown export when notes fragment has content', () => {
      const doc = createDoc();
      seedPacket(doc);
      const notesFragment = doc.getXmlFragment('notes');
      const textNode = new Y.XmlText('Some meeting notes');
      notesFragment.insert(0, [textNode]);

      render(<ExportControls doc={doc} />);

      const btn = screen.getByRole('button', { name: /export as markdown/i });
      fireEvent.click(btn);

      expect(exportService.download).toHaveBeenCalledWith(
        'markdown',
        expect.objectContaining({ sprintGoal: 'Deliver MVP' }),
        expect.any(String)
      );
    });
  });

  describe('real-time sync', () => {
    it('enables buttons when packet is added after mount', () => {
      const doc = createDoc();
      render(<ExportControls doc={doc} />);

      // Initially disabled
      expect(screen.getByRole('button', { name: /export as markdown/i })).toHaveProperty('disabled', true);

      // Add packet externally
      act(() => {
        seedPacket(doc);
      });

      // Now enabled
      expect(screen.getByRole('button', { name: /export as markdown/i })).toHaveProperty('disabled', false);
      expect(screen.getByRole('button', { name: /export as json/i })).toHaveProperty('disabled', false);
    });

    it('hides explanation when packet is added', () => {
      const doc = createDoc();
      render(<ExportControls doc={doc} />);

      expect(screen.getByText(/generate a sprint packet first/i)).toBeDefined();

      act(() => {
        seedPacket(doc);
      });

      expect(screen.queryByText(/generate a sprint packet first/i)).toBeNull();
    });
  });
});
