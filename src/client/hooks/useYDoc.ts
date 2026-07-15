import { useMemo } from 'react';
import * as Y from 'yjs';

/**
 * Creates and returns a stable Y.Doc instance with the Sprint Room
 * document structure initialized:
 * - Y.Map("meta")       — roomId, createdAt, status
 * - Y.Array("rawInputs")    — participant raw inputs
 * - Y.Array("clarifications") — AI questions + team answers
 * - Y.Map("sprintPacket")   — structured sprint output
 * - Y.XmlFragment("notes")  — TipTap collaborative freeform notes
 *
 * The doc is created once and remains stable across renders.
 */
export function useYDoc(): Y.Doc {
  const doc = useMemo(() => {
    const ydoc = new Y.Doc();

    // Initialize top-level shared types by accessing them.
    // Yjs creates shared types lazily on first access.
    ydoc.getMap('meta');
    ydoc.getArray('rawInputs');
    ydoc.getArray('clarifications');

    // Sprint packet map with nested Y.Array fields
    const sprintPacket = ydoc.getMap('sprintPacket');

    // Pre-initialize nested arrays within the sprint packet map
    // so consumers can rely on them existing.
    ydoc.transact(() => {
      if (!sprintPacket.has('inScope')) {
        sprintPacket.set('inScope', new Y.Array<string>());
      }
      if (!sprintPacket.has('outOfScope')) {
        sprintPacket.set('outOfScope', new Y.Array<string>());
      }
      if (!sprintPacket.has('tasks')) {
        sprintPacket.set('tasks', new Y.Array());
      }
      if (!sprintPacket.has('risksAndDependencies')) {
        sprintPacket.set('risksAndDependencies', new Y.Array<string>());
      }
      if (!sprintPacket.has('assumptions')) {
        sprintPacket.set('assumptions', new Y.Array<string>());
      }
    });

    // Initialize TipTap-bound XML fragment
    ydoc.getXmlFragment('notes');

    return ydoc;
  }, []);

  return doc;
}
