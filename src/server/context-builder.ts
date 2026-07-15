import * as Y from 'yjs';
import type {
  RoomContext,
  RawInput,
  Clarification,
  SprintPacket,
  Task,
} from '../shared/types';

/** Default context size limit in characters (~12,000 for MVP) */
export const CONTEXT_LIMIT = 12_000;

/**
 * Builds a RoomContext from a Y.Doc for use in AI action prompts.
 *
 * Packing order (highest priority first):
 * 1. Answered clarifications
 * 2. Current sprint packet
 * 3. Raw inputs (newest first)
 * 4. Participant names
 * 5. TipTap notes (truncated last)
 *
 * Near the context limit: drop oldest raw inputs first, then truncate notes.
 * Never drop answered clarifications or the current packet.
 * If truncation occurs, an assumption noting what was truncated is added.
 */
export interface BuildContextOptions {
  /** Joined human names from room presence (preferred over raw-input authors alone) */
  participantNames?: string[];
}

export function buildContext(
  doc: Y.Doc,
  limit: number = CONTEXT_LIMIT,
  options: BuildContextOptions = {}
): RoomContext {
  // 1. Extract raw inputs from Y.Array
  const rawInputsArray = doc.getArray('rawInputs');
  const allRawInputs: (RawInput & { timestamp: number })[] = [];
  for (let i = 0; i < rawInputsArray.length; i++) {
    const item = rawInputsArray.get(i) as Y.Map<any>;
    allRawInputs.push({
      authorName: item.get('authorName') ?? '',
      content: item.get('content') ?? '',
      timestamp: item.get('timestamp') ?? 0,
    });
  }
  // Sort newest first
  allRawInputs.sort((a, b) => b.timestamp - a.timestamp);

  // 2. Extract clarifications from Y.Array
  const clarificationsArray = doc.getArray('clarifications');
  const allClarifications: Clarification[] = [];
  for (let i = 0; i < clarificationsArray.length; i++) {
    const item = clarificationsArray.get(i) as Y.Map<any>;
    allClarifications.push({
      question: item.get('question') ?? '',
      answer: item.get('answer') ?? null,
    });
  }

  // 3. Extract current sprint packet from Y.Map
  const currentPacket = extractSprintPacket(doc);

  // 4. Participant names: room joiners first, else unique raw-input authors
  const nameSet = new Set<string>();
  for (const n of options.participantNames ?? []) {
    if (n.trim()) nameSet.add(n.trim());
  }
  for (const input of allRawInputs) {
    if (input.authorName) {
      nameSet.add(input.authorName);
    }
  }
  const participantNames = Array.from(nameSet);

  // 5. Extract TipTap notes text
  const notesFragment = doc.getXmlFragment('notes');
  const notesText = xmlFragmentToText(notesFragment);

  // --- Packing with truncation ---
  // Estimate sizes for prioritized elements
  const answeredClarifications = allClarifications.filter((c) => c.answer !== null);
  const unansweredClarifications = allClarifications.filter((c) => c.answer === null);

  const answeredSize = estimateSize(answeredClarifications);
  const packetSize = currentPacket ? estimateSize(currentPacket) : 0;
  const namesSize = estimateSize(participantNames);

  // These are never dropped
  const fixedSize = answeredSize + packetSize;

  // Budget remaining for variable content
  let remainingBudget = limit - fixedSize;
  const assumptions: string[] = currentPacket?.assumptions ? [...currentPacket.assumptions] : [];
  let truncated = false;

  // Raw inputs (newest first) — drop oldest if over budget
  let includedRawInputs: RawInput[] = [];
  let rawInputsSize = 0;
  for (const input of allRawInputs) {
    const inputSize = estimateSize({ authorName: input.authorName, content: input.content });
    if (rawInputsSize + inputSize + namesSize <= remainingBudget) {
      includedRawInputs.push({ authorName: input.authorName, content: input.content });
      rawInputsSize += inputSize;
    } else {
      truncated = true;
    }
  }

  remainingBudget -= rawInputsSize;
  remainingBudget -= namesSize;

  // Notes — truncate if over remaining budget
  let includedNotes = notesText;
  if (notesText.length > 0 && remainingBudget > 0) {
    if (notesText.length > remainingBudget) {
      includedNotes = notesText.slice(0, Math.max(0, remainingBudget));
      truncated = true;
    }
  } else if (notesText.length > 0) {
    includedNotes = '';
    truncated = true;
  }

  // Record truncation in assumptions
  if (truncated) {
    const droppedInputs = allRawInputs.length - includedRawInputs.length;
    const parts: string[] = [];
    if (droppedInputs > 0) {
      parts.push(`${droppedInputs} oldest raw input(s) dropped`);
    }
    if (includedNotes.length < notesText.length) {
      parts.push('TipTap notes truncated');
    }
    if (parts.length > 0) {
      assumptions.push(`Context truncated: ${parts.join('; ')}`);
    }
  }

  // Build the final packet with updated assumptions if truncation occurred
  const finalPacket = currentPacket
    ? truncated
      ? { ...currentPacket, assumptions }
      : currentPacket
    : null;

  // Include all clarifications (answered + unanswered) in the result
  // The packing order prioritizes answered ones, but we include all for completeness
  const finalClarifications = [...answeredClarifications, ...unansweredClarifications];

  return {
    rawInputs: includedRawInputs,
    clarifications: finalClarifications,
    currentPacket: finalPacket,
    participantNames,
    ...(includedNotes.trim().length > 0 ? { notes: includedNotes } : {}),
  };
}

/**
 * Extracts a SprintPacket from the Y.Map("sprintPacket") in the doc.
 * Returns null if no sprint goal has been set (indicating no packet exists yet).
 */
function extractSprintPacket(doc: Y.Doc): SprintPacket | null {
  const packetMap = doc.getMap('sprintPacket');
  const sprintGoal = packetMap.get('sprintGoal') as string | undefined;

  // If there's no sprint goal, there's no packet yet
  if (!sprintGoal) {
    return null;
  }

  const inScope = yArrayToStringArray(packetMap.get('inScope') as Y.Array<string> | undefined);
  const outOfScope = yArrayToStringArray(packetMap.get('outOfScope') as Y.Array<string> | undefined);
  const tasks = extractTasks(packetMap.get('tasks') as Y.Array<Y.Map<any>> | undefined);
  const risksAndDependencies = yArrayToStringArray(
    packetMap.get('risksAndDependencies') as Y.Array<string> | undefined
  );
  const assumptions = yArrayToStringArray(
    packetMap.get('assumptions') as Y.Array<string> | undefined
  );

  return {
    sprintGoal,
    inScope,
    outOfScope,
    tasks,
    risksAndDependencies,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
  };
}

/** Convert a Y.Array<string> to a plain string array */
function yArrayToStringArray(arr: Y.Array<string> | undefined): string[] {
  if (!arr || !(arr instanceof Y.Array)) return [];
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr.get(i));
  }
  return result;
}

/** Extract tasks from Y.Array<Y.Map> */
function extractTasks(arr: Y.Array<Y.Map<any>> | undefined): Task[] {
  if (!arr || !(arr instanceof Y.Array)) return [];
  const tasks: Task[] = [];
  for (let i = 0; i < arr.length; i++) {
    const taskMap = arr.get(i) as Y.Map<any>;
    tasks.push(extractTask(taskMap));
  }
  return tasks;
}

/** Extract a single Task from a Y.Map */
function extractTask(taskMap: Y.Map<any>): Task {
  const subtasksArr = taskMap.get('subtasks') as Y.Array<Y.Map<any>> | undefined;
  const subtasks = subtasksArr ? extractTasks(subtasksArr) : undefined;

  return {
    id: taskMap.get('id') ?? '',
    title: taskMap.get('title') ?? '',
    description: taskMap.get('description') ?? '',
    priority: taskMap.get('priority') ?? 'medium',
    acceptanceCriteria: yArrayToStringArray(taskMap.get('acceptanceCriteria') as Y.Array<string> | undefined),
    ...(subtasks && subtasks.length > 0 ? { subtasks } : {}),
    ...(taskMap.get('parentTaskId') != null ? { parentTaskId: taskMap.get('parentTaskId') } : {}),
  };
}

/** Convert Y.XmlFragment to plain text */
function xmlFragmentToText(fragment: Y.XmlFragment): string {
  let text = '';
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    text += xmlNodeToText(child);
  }
  return text;
}

/** Recursively extract text from a Y.XmlElement or Y.XmlText */
function xmlNodeToText(node: any): string {
  if (node instanceof Y.XmlText) {
    return node.toString();
  }
  if (node instanceof Y.XmlElement) {
    let text = '';
    for (let i = 0; i < node.length; i++) {
      text += xmlNodeToText(node.get(i));
    }
    // Add newline after block elements
    const tag = node.nodeName;
    if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br'].includes(tag)) {
      text += '\n';
    }
    return text;
  }
  return '';
}

/** Rough character-count estimate for context size budgeting */
export function estimateSize(value: unknown): number {
  return JSON.stringify(value).length;
}
