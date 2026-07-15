import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type {
  ClarifyOutput,
  SprintPacket,
  BreakDownOutput,
  Task,
} from '../shared/types';
import {
  ClarifyOutputSchema,
  SprintPacketSchema,
  BreakDownOutputSchema,
} from './schemas';

/**
 * Max *unanswered* clarifications kept in the Y.Doc.
 * Answered questions are never deleted (Req 6.3 / session continuity).
 * Per clarify invocation Zod already caps new questions at 5.
 */
const MAX_UNANSWERED_CLARIFICATIONS = 8;

/**
 * Merges validated clarify output into the Y.Doc.
 *
 * - Validates output with Zod (double-check even if already validated upstream)
 * - Appends each question as a Y.Map to Y.Array("clarifications")
 * - Each entry has: questionId, question, questionContext, answer (null), answeredBy (null), timestamp
 * - Never removes answered clarifications; may drop oldest unanswered if over cap
 */
export function mergeClarifyOutput(doc: Y.Doc, output: ClarifyOutput): void {
  // Validate with Zod — reject if malformed
  const validated = ClarifyOutputSchema.parse(output);

  const clarifications = doc.getArray('clarifications');

  doc.transact(() => {
    // Append each question
    for (const q of validated.questions) {
      const entry = new Y.Map();
      entry.set('questionId', q.id);
      entry.set('question', q.question);
      entry.set('questionContext', q.context);
      entry.set('answer', null);
      entry.set('answeredBy', null);
      entry.set('timestamp', Date.now());
      clarifications.push([entry]);
    }

    // Drop oldest unanswered only — never answered entries
    const unansweredIndexes: number[] = [];
    for (let i = 0; i < clarifications.length; i++) {
      const map = clarifications.get(i) as Y.Map<unknown>;
      if (map.get('answer') == null) {
        unansweredIndexes.push(i);
      }
    }
    const excess = unansweredIndexes.length - MAX_UNANSWERED_CLARIFICATIONS;
    if (excess > 0) {
      const toDelete = unansweredIndexes.slice(0, excess);
      // Delete from the end so earlier indexes stay valid
      for (let i = toDelete.length - 1; i >= 0; i--) {
        clarifications.delete(toDelete[i]!, 1);
      }
    }
  });
}

/**
 * Merges validated plan output into the Y.Doc.
 *
 * - Validates output with Zod
 * - Writes to Y.Map("sprintPacket"): sprintGoal, inScope, outOfScope, tasks, risksAndDependencies, assumptions
 * - Preserves task IDs: when regenerating, if a task in the new output has the same title
 *   as an existing task, the existing ID is kept
 * - Clears old content before writing new (within a single transaction)
 */
export function mergePlanOutput(doc: Y.Doc, output: SprintPacket): void {
  // Validate with Zod
  const validated = SprintPacketSchema.parse(output);

  const sprintPacket = doc.getMap('sprintPacket');

  doc.transact(() => {
    // Build a title→id map from existing tasks for ID preservation
    const existingTitleToId = buildTitleToIdMap(sprintPacket);

    // Set sprint goal
    sprintPacket.set('sprintGoal', validated.sprintGoal);

    // Replace inScope
    replaceStringArray(sprintPacket, 'inScope', validated.inScope);

    // Replace outOfScope
    replaceStringArray(sprintPacket, 'outOfScope', validated.outOfScope);

    // Replace tasks (preserving IDs where titles match)
    const tasksArray = new Y.Array();
    for (const task of validated.tasks) {
      const preservedId = existingTitleToId.get(task.title) || task.id;
      tasksArray.push([taskToYMap({ ...task, id: preservedId })]);
    }
    sprintPacket.set('tasks', tasksArray);

    // Replace risksAndDependencies
    replaceStringArray(sprintPacket, 'risksAndDependencies', validated.risksAndDependencies);

    // Replace assumptions
    replaceStringArray(sprintPacket, 'assumptions', validated.assumptions || []);
  });
}

/**
 * Merges validated break-down output into the Y.Doc.
 *
 * - Finds the parent task in Y.Map("sprintPacket") → tasks array
 * - Sets `parentTaskId` on each subtask
 * - Appends subtasks to the parent task's subtasks array (or creates it)
 * - Keeps the parent task intact
 */
export function mergeBreakDownOutput(doc: Y.Doc, output: BreakDownOutput): void {
  // Validate with Zod
  const validated = BreakDownOutputSchema.parse(output);

  const sprintPacket = doc.getMap('sprintPacket');
  const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<any>> | undefined;

  if (!tasksArray || !(tasksArray instanceof Y.Array)) {
    throw new Error('No tasks array found in sprintPacket');
  }

  doc.transact(() => {
    // Find parent task by ID
    let parentTaskMap: Y.Map<any> | null = null;
    for (let i = 0; i < tasksArray.length; i++) {
      const task = tasksArray.get(i) as Y.Map<any>;
      if (task.get('id') === validated.parentTaskId) {
        parentTaskMap = task;
        break;
      }
    }

    if (!parentTaskMap) {
      throw new Error(`Parent task "${validated.parentTaskId}" not found in sprintPacket`);
    }

    // Get or create subtasks array on the parent
    let subtasksArray = parentTaskMap.get('subtasks') as Y.Array<Y.Map<any>> | undefined;
    if (!subtasksArray || !(subtasksArray instanceof Y.Array)) {
      subtasksArray = new Y.Array();
      parentTaskMap.set('subtasks', subtasksArray);
    }

    // Append each subtask with parentTaskId set
    for (const subtask of validated.subtasks) {
      const subtaskWithParent = { ...subtask, parentTaskId: validated.parentTaskId };
      subtasksArray.push([taskToYMap(subtaskWithParent)]);
    }
  });
}

/**
 * Error handling helper: appends a warning note to Y.XmlFragment("notes").
 */
export function handleMergeError(doc: Y.Doc, error: string): void {
  const notes = doc.getXmlFragment('notes');

  doc.transact(() => {
    const paragraph = new Y.XmlElement('p');
    const text = new Y.XmlText();
    text.insert(0, `⚠️ AI Error: ${error}`);
    paragraph.insert(0, [text]);
    notes.push([paragraph]);
  });
}

// --- Internal helpers ---

/**
 * Builds a map of task title → id from the existing sprintPacket tasks.
 * Used for preserving task IDs when regenerating a plan.
 */
function buildTitleToIdMap(sprintPacket: Y.Map<any>): Map<string, string> {
  const titleToId = new Map<string, string>();
  const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<any>> | undefined;

  if (!tasksArray || !(tasksArray instanceof Y.Array)) {
    return titleToId;
  }

  for (let i = 0; i < tasksArray.length; i++) {
    const task = tasksArray.get(i) as Y.Map<any>;
    const title = task.get('title') as string | undefined;
    const id = task.get('id') as string | undefined;
    if (title && id) {
      titleToId.set(title, id);
    }
  }

  return titleToId;
}

/**
 * Replaces a string array field in a Y.Map with new values.
 */
function replaceStringArray(map: Y.Map<any>, key: string, values: string[]): void {
  const newArray = new Y.Array<string>();
  if (values.length > 0) {
    newArray.push(values);
  }
  map.set(key, newArray);
}

/**
 * Converts a Task object to a Y.Map suitable for insertion into the Y.Doc.
 */
function taskToYMap(task: Task): Y.Map<any> {
  const map = new Y.Map();
  map.set('id', task.id);
  map.set('title', task.title);
  map.set('description', task.description);
  map.set('priority', task.priority);

  const acArray = new Y.Array<string>();
  if (task.acceptanceCriteria.length > 0) {
    acArray.push(task.acceptanceCriteria);
  }
  map.set('acceptanceCriteria', acArray);

  if (task.parentTaskId !== undefined && task.parentTaskId !== null) {
    map.set('parentTaskId', task.parentTaskId);
  }

  if (task.subtasks && task.subtasks.length > 0) {
    const subtasksArray = new Y.Array();
    for (const subtask of task.subtasks) {
      subtasksArray.push([taskToYMap(subtask)]);
    }
    map.set('subtasks', subtasksArray);
  }

  return map;
}
