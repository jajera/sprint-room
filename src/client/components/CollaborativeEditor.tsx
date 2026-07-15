import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import * as Y from 'yjs';
import type YPartyKitProvider from 'y-partykit/provider';

export interface CollaborativeEditorProps {
  doc: Y.Doc;
  provider: YPartyKitProvider;
}

/**
 * Custom awareness state filter that only shows carets for human participants.
 * The AI agent writes directly to Y types, not via the editor.
 */
export function humanOnlyAwarenessFilter(
  currentClientId: number,
  userClientId: number,
  awarenessState: { user?: { type?: string } }
): boolean {
  if (currentClientId === userClientId) return false;
  if (awarenessState?.user?.type === 'ai') return false;
  return true;
}

/**
 * TipTap extension that wraps y-prosemirror plugins for Yjs collaboration.
 * Provides:
 * - ySyncPlugin: binds editor content to Y.XmlFragment("notes")
 * - yCursorPlugin: shows colored cursors/selections for human participants
 * - yUndoPlugin: collaborative undo/redo (per-user undo stack)
 */
function createCollaborationExtension(
  fragment: Y.XmlFragment,
  provider: YPartyKitProvider
) {
  return Extension.create({
    name: 'yjsCollaboration',

    addProseMirrorPlugins() {
      return [
        ySyncPlugin(fragment),
        yCursorPlugin(provider.awareness, {
          awarenessStateFilter: humanOnlyAwarenessFilter,
        }),
        yUndoPlugin(),
      ];
    },
  });
}

/**
 * Collaborative freeform notes editor using TipTap + Yjs.
 *
 * Binds to Y.XmlFragment("notes") in the shared Y.Doc for real-time
 * multi-user editing with sub-second sync. Shows colored cursors and
 * selections for human participants only (AI writes directly to Y types,
 * not through the editor).
 *
 * Notes are supplementary — the Sprint Packet (Y.Map) is the export
 * source of truth, not this editor content.
 */
export function CollaborativeEditor({ doc, provider }: CollaborativeEditorProps) {
  const fragment = doc.getXmlFragment('notes');

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Disable built-in history — yUndoPlugin handles undo/redo
          history: false,
        }),
        createCollaborationExtension(fragment, provider),
      ],
      editorProps: {
        attributes: {
          class: 'collaborative-editor',
          'aria-label': 'Collaborative notes editor',
          role: 'textbox',
          'aria-multiline': 'true',
        },
      },
    },
    [fragment, provider]
  );

  return (
    <div className="collaborative-editor-wrapper">
      <EditorContent editor={editor} />
    </div>
  );
}
