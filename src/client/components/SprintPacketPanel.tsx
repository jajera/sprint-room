import { useState, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
import * as Y from 'yjs';

export interface SprintPacketPanelProps {
  doc: Y.Doc;
  onSelectTask?: (taskId: string | null) => void;
  selectedTaskId?: string | null;
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  acceptanceCriteria: string[];
  subtasks: TaskItem[];
  parentTaskId: string | null;
}

/**
 * SprintPacketPanel — editable panel bound to Y.Map("sprintPacket").
 *
 * This is the source of truth for export (not TipTap notes).
 * All human edits write directly back to Y types for real-time sync.
 */
export default function SprintPacketPanel({
  doc,
  onSelectTask,
  selectedTaskId,
}: SprintPacketPanelProps) {
  const [sprintGoal, setSprintGoal] = useState('');
  const [inScope, setInScope] = useState<string[]>([]);
  const [outOfScope, setOutOfScope] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [risksAndDependencies, setRisksAndDependencies] = useState<string[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);

  const sprintPacket = doc.getMap('sprintPacket');

  const readTasks = useCallback((tasksArray: Y.Array<Y.Map<unknown>>): TaskItem[] => {
    const result: TaskItem[] = [];
    for (let i = 0; i < tasksArray.length; i++) {
      const taskMap = tasksArray.get(i);
      const acArray = taskMap.get('acceptanceCriteria') as Y.Array<string> | undefined;
      const subtasksArray = taskMap.get('subtasks') as Y.Array<Y.Map<unknown>> | undefined;

      result.push({
        id: (taskMap.get('id') as string) || '',
        title: (taskMap.get('title') as string) || '',
        description: (taskMap.get('description') as string) || '',
        priority: (taskMap.get('priority') as 'high' | 'medium' | 'low') || 'medium',
        acceptanceCriteria: acArray ? acArray.toArray() : [],
        subtasks: subtasksArray ? readTasks(subtasksArray) : [],
        parentTaskId: (taskMap.get('parentTaskId') as string | null) || null,
      });
    }
    return result;
  }, []);

  const readArray = useCallback((arr: unknown): string[] => {
    if (arr instanceof Y.Array) {
      return arr.toArray() as string[];
    }
    return [];
  }, []);

  const syncState = useCallback(() => {
    setSprintGoal((sprintPacket.get('sprintGoal') as string) || '');
    setInScope(readArray(sprintPacket.get('inScope')));
    setOutOfScope(readArray(sprintPacket.get('outOfScope')));
    setRisksAndDependencies(readArray(sprintPacket.get('risksAndDependencies')));
    setAssumptions(readArray(sprintPacket.get('assumptions')));

    const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>> | undefined;
    if (tasksArray) {
      setTasks(readTasks(tasksArray));
    } else {
      setTasks([]);
    }
  }, [sprintPacket, readArray, readTasks]);

  useEffect(() => {
    syncState();

    const observeDeep = () => syncState();
    sprintPacket.observeDeep(observeDeep);
    return () => {
      sprintPacket.unobserveDeep(observeDeep);
    };
  }, [sprintPacket, syncState]);

  const hasPacket = !!sprintGoal;

  // --- Sprint Goal ---
  const handleGoalChange = (value: string) => {
    setSprintGoal(value);
    sprintPacket.set('sprintGoal', value);
  };

  // --- Array field helpers ---
  const getYArray = (field: string): Y.Array<string> => {
    let arr = sprintPacket.get(field) as Y.Array<string> | undefined;
    if (!arr) {
      arr = new Y.Array<string>();
      sprintPacket.set(field, arr);
    }
    return arr;
  };

  const handleArrayItemEdit = (field: string, index: number, value: string) => {
    const arr = getYArray(field);
    if (index < arr.length) {
      doc.transact(() => {
        arr.delete(index, 1);
        arr.insert(index, [value]);
      });
    }
  };

  const handleArrayItemAdd = (field: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const arr = getYArray(field);
    arr.push([trimmed]);
  };

  const handleArrayItemDelete = (field: string, index: number) => {
    const arr = getYArray(field);
    if (index < arr.length) {
      arr.delete(index, 1);
    }
  };

  // --- Task selection ---
  const handleSelectTask = (taskId: string) => {
    const newId = selectedTaskId === taskId ? null : taskId;
    onSelectTask?.(newId);
  };

  // --- Task field edits ---
  const handleTaskTitleEdit = (taskIndex: number, value: string) => {
    const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>> | undefined;
    if (tasksArray && taskIndex < tasksArray.length) {
      const taskMap = tasksArray.get(taskIndex);
      taskMap.set('title', value);
    }
  };

  const handleTaskDescriptionEdit = (taskIndex: number, value: string) => {
    const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>> | undefined;
    if (tasksArray && taskIndex < tasksArray.length) {
      const taskMap = tasksArray.get(taskIndex);
      taskMap.set('description', value);
    }
  };

  const handleTaskACEdit = (taskIndex: number, acIndex: number, value: string) => {
    const tasksArray = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>> | undefined;
    if (tasksArray && taskIndex < tasksArray.length) {
      const taskMap = tasksArray.get(taskIndex);
      const acArray = taskMap.get('acceptanceCriteria') as Y.Array<string> | undefined;
      if (acArray && acIndex < acArray.length) {
        doc.transact(() => {
          acArray.delete(acIndex, 1);
          acArray.insert(acIndex, [value]);
        });
      }
    }
  };

  if (!hasPacket) {
    return (
      <section aria-label="Sprint packet">
        <h2>Sprint Packet</h2>
        <p>No sprint packet yet. Use the AI Plan action to generate one, or start writing below.</p>
        <label htmlFor="sprint-goal-input">Sprint Goal</label>
        <input
          id="sprint-goal-input"
          type="text"
          placeholder="Enter sprint goal…"
          value={sprintGoal}
          onChange={(e) => handleGoalChange(e.target.value)}
          aria-label="Sprint goal"
        />
      </section>
    );
  }

  return (
    <section aria-label="Sprint packet">
      <h2>Sprint Packet</h2>

      {/* Sprint Goal */}
      <div>
        <label htmlFor="sprint-goal-input">Sprint Goal</label>
        <input
          id="sprint-goal-input"
          type="text"
          value={sprintGoal}
          onChange={(e) => handleGoalChange(e.target.value)}
          aria-label="Sprint goal"
        />
      </div>

      {/* In Scope */}
      <EditableList
        label="In Scope"
        items={inScope}
        onEdit={(i, v) => handleArrayItemEdit('inScope', i, v)}
        onAdd={(v) => handleArrayItemAdd('inScope', v)}
        onDelete={(i) => handleArrayItemDelete('inScope', i)}
      />

      {/* Out of Scope */}
      <EditableList
        label="Out of Scope"
        items={outOfScope}
        onEdit={(i, v) => handleArrayItemEdit('outOfScope', i, v)}
        onAdd={(v) => handleArrayItemAdd('outOfScope', v)}
        onDelete={(i) => handleArrayItemDelete('outOfScope', i)}
      />

      {/* Tasks */}
      <div>
        <h3>Tasks</h3>
        {tasks.length === 0 && <p>No tasks yet.</p>}
        <ul aria-label="Sprint tasks">
          {tasks.map((task, taskIndex) => (
            <li key={task.id}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selectedTaskId === task.id}
                onClick={() => handleSelectTask(task.id)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectTask(task.id);
                  }
                }}
                aria-label={`Select task: ${task.title}`}
                style={{
                  cursor: 'pointer',
                  background: selectedTaskId === task.id ? '#e0f2fe' : 'transparent',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
              >
                <span aria-label="Priority">[{task.priority}]</span>{' '}
                <input
                  type="text"
                  value={task.title}
                  onChange={(e) => handleTaskTitleEdit(taskIndex, e.target.value)}
                  aria-label={`Task title: ${task.title}`}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <textarea
                value={task.description}
                onChange={(e) => handleTaskDescriptionEdit(taskIndex, e.target.value)}
                aria-label={`Task description: ${task.title}`}
                onClick={(e) => e.stopPropagation()}
              />
              <ul aria-label={`Acceptance criteria for ${task.title}`}>
                {task.acceptanceCriteria.map((ac, acIndex) => (
                  <li key={acIndex}>
                    <input
                      type="text"
                      value={ac}
                      onChange={(e) => handleTaskACEdit(taskIndex, acIndex, e.target.value)}
                      aria-label={`Acceptance criterion ${acIndex + 1}`}
                    />
                  </li>
                ))}
              </ul>
              {task.subtasks.length > 0 && (
                <ul aria-label={`Subtasks for ${task.title}`}>
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id}>
                      <span>[{subtask.priority}]</span> {subtask.title}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Risks and Dependencies */}
      <EditableList
        label="Risks & Dependencies"
        items={risksAndDependencies}
        onEdit={(i, v) => handleArrayItemEdit('risksAndDependencies', i, v)}
        onAdd={(v) => handleArrayItemAdd('risksAndDependencies', v)}
        onDelete={(i) => handleArrayItemDelete('risksAndDependencies', i)}
      />

      {/* Assumptions */}
      <EditableList
        label="Assumptions"
        items={assumptions}
        onEdit={(i, v) => handleArrayItemEdit('assumptions', i, v)}
        onAdd={(v) => handleArrayItemAdd('assumptions', v)}
        onDelete={(i) => handleArrayItemDelete('assumptions', i)}
      />
    </section>
  );
}

// --- EditableList sub-component ---
interface EditableListProps {
  label: string;
  items: string[];
  onEdit: (index: number, value: string) => void;
  onAdd: (value: string) => void;
  onDelete: (index: number) => void;
}

function EditableList({ label, items, onEdit, onAdd, onDelete }: EditableListProps) {
  const [newItem, setNewItem] = useState('');

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (newItem.trim()) {
      onAdd(newItem.trim());
      setNewItem('');
    }
  };

  return (
    <div>
      <h3>{label}</h3>
      <ul aria-label={label}>
        {items.map((item, index) => (
          <li key={index}>
            <input
              type="text"
              value={item}
              onChange={(e) => onEdit(index, e.target.value)}
              aria-label={`${label} item ${index + 1}`}
            />
            <button
              onClick={() => onDelete(index)}
              aria-label={`Delete ${label} item ${index + 1}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} aria-label={`Add ${label} item`}>
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={`Add ${label.toLowerCase()} item…`}
          aria-label={`New ${label.toLowerCase()} item`}
        />
        <button type="submit" disabled={!newItem.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
