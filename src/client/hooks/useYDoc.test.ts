import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useYDoc } from './useYDoc';

describe('useYDoc', () => {
  it('returns a Y.Doc instance', () => {
    const { result } = renderHook(() => useYDoc());
    expect(result.current).toBeInstanceOf(Y.Doc);
  });

  it('returns a stable reference across renders', () => {
    const { result, rerender } = renderHook(() => useYDoc());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('initializes meta map', () => {
    const { result } = renderHook(() => useYDoc());
    const meta = result.current.getMap('meta');
    expect(meta).toBeInstanceOf(Y.Map);
  });

  it('initializes rawInputs array', () => {
    const { result } = renderHook(() => useYDoc());
    const rawInputs = result.current.getArray('rawInputs');
    expect(rawInputs).toBeInstanceOf(Y.Array);
  });

  it('initializes clarifications array', () => {
    const { result } = renderHook(() => useYDoc());
    const clarifications = result.current.getArray('clarifications');
    expect(clarifications).toBeInstanceOf(Y.Array);
  });

  it('initializes sprintPacket map with nested arrays', () => {
    const { result } = renderHook(() => useYDoc());
    const packet = result.current.getMap('sprintPacket');
    expect(packet).toBeInstanceOf(Y.Map);

    expect(packet.get('inScope')).toBeInstanceOf(Y.Array);
    expect(packet.get('outOfScope')).toBeInstanceOf(Y.Array);
    expect(packet.get('tasks')).toBeInstanceOf(Y.Array);
    expect(packet.get('risksAndDependencies')).toBeInstanceOf(Y.Array);
    expect(packet.get('assumptions')).toBeInstanceOf(Y.Array);
  });

  it('initializes notes XmlFragment', () => {
    const { result } = renderHook(() => useYDoc());
    const notes = result.current.getXmlFragment('notes');
    expect(notes).toBeInstanceOf(Y.XmlFragment);
  });

  it('nested sprint packet arrays start empty', () => {
    const { result } = renderHook(() => useYDoc());
    const packet = result.current.getMap('sprintPacket');

    expect((packet.get('inScope') as Y.Array<string>).length).toBe(0);
    expect((packet.get('outOfScope') as Y.Array<string>).length).toBe(0);
    expect((packet.get('tasks') as Y.Array<unknown>).length).toBe(0);
    expect((packet.get('risksAndDependencies') as Y.Array<string>).length).toBe(0);
    expect((packet.get('assumptions') as Y.Array<string>).length).toBe(0);
  });
});
