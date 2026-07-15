import { useState, useEffect } from 'react';
import * as Y from 'yjs';
import { hasPacket, extractPacketFromDoc, download, type ExportFormat } from '../export';

export interface ExportControlsProps {
  doc: Y.Doc;
}

const EXPORT_BUTTONS: Array<{ format: ExportFormat; label: string; aria: string }> = [
  { format: 'markdown', label: 'Markdown', aria: 'Export as Markdown' },
  { format: 'json', label: 'JSON', aria: 'Export as JSON' },
  { format: 'prd', label: 'PRD', aria: 'Export as PRD outline' },
  { format: 'issues', label: 'GitHub Issues', aria: 'Export as GitHub issues' },
  { format: 'checklist', label: 'Checklist', aria: 'Export as sprint checklist' },
];

/**
 * Export controls — same sprint packet, multiple useful artifact shapes.
 */
export default function ExportControls({ doc }: ExportControlsProps) {
  const [packetExists, setPacketExists] = useState(() => hasPacket(doc));

  useEffect(() => {
    const packetMap = doc.getMap('sprintPacket');

    const observer = () => {
      setPacketExists(hasPacket(doc));
    };

    packetMap.observeDeep(observer);
    return () => {
      packetMap.unobserveDeep(observer);
    };
  }, [doc]);

  const handleExport = (format: ExportFormat) => {
    const packet = extractPacketFromDoc(doc);
    if (!packet) return;

    let notes: string | undefined;
    if (format === 'markdown' || format === 'prd') {
      const notesFragment = doc.getXmlFragment('notes');
      const notesText = notesFragment.toString();
      if (notesText.trim().length > 0) {
        notes = notesText;
      }
    }

    download(format, packet, notes);
  };

  return (
    <section aria-label="Export controls">
      <h3>Export</h3>
      <div>
        {EXPORT_BUTTONS.map(({ format, label, aria }) => (
          <button
            key={format}
            onClick={() => handleExport(format)}
            disabled={!packetExists}
            aria-label={aria}
          >
            {label}
          </button>
        ))}
      </div>
      {!packetExists && <p>Generate a sprint packet first</p>}
    </section>
  );
}
