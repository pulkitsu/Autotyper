import { useCallback, useRef, useState } from "react";

function copy(value) {
  return structuredClone(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Small, deliberately data-only undo/redo stack for the macro editor. Keeping
 * the snapshots outside React state prevents every historical revision from
 * being rendered, while the visible draft still updates predictably.
 */
export function useUndoableDraft(initialValue) {
  const initialRef = useRef(copy(initialValue));
  const presentRef = useRef(copy(initialValue));
  const historyRef = useRef({ past: [], future: [] });
  const [value, setValue] = useState(() => copy(initialValue));

  const commit = useCallback((nextValue) => {
    const next = copy(nextValue);
    const current = presentRef.current;
    if (same(current, next)) return current;

    historyRef.current.past.push(copy(current));
    // Keep enough room for a long editing session without retaining an
    // unbounded number of full macro/CSV snapshots.
    if (historyRef.current.past.length > 100) historyRef.current.past.shift();
    historyRef.current.future = [];
    presentRef.current = next;
    setValue(copy(next));
    return next;
  }, []);

  const update = useCallback((recipe) => {
    const current = copy(presentRef.current);
    return commit(typeof recipe === "function" ? recipe(current) : recipe);
  }, [commit]);

  const undo = useCallback(() => {
    const previous = historyRef.current.past.pop();
    if (!previous) return false;
    historyRef.current.future.unshift(copy(presentRef.current));
    presentRef.current = copy(previous);
    setValue(copy(previous));
    return true;
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.future.shift();
    if (!next) return false;
    historyRef.current.past.push(copy(presentRef.current));
    presentRef.current = copy(next);
    setValue(copy(next));
    return true;
  }, []);

  const replace = useCallback((nextValue) => {
    const next = copy(nextValue);
    presentRef.current = next;
    historyRef.current = { past: [], future: [] };
    setValue(copy(next));
  }, []);

  const reset = useCallback(() => replace(initialRef.current), [replace]);

  return {
    value,
    commit,
    update,
    replace,
    reset,
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
  };
}
