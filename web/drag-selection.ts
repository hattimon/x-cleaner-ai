import { useEffect, useRef } from 'react';
import type { Dispatch, PointerEvent, SetStateAction } from 'react';

type Stroke = { pointer: number; ids: string[]; index: number; value: boolean; started: boolean; x: number; y: number; label: HTMLLabelElement };

export function useDragSelection(ids: string[], selected: Set<string>, update: Dispatch<SetStateAction<Set<string>>>, onStroke: () => void) {
  const active = useRef<Stroke | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);

  const stop = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    active.current?.label.closest('.table-scroll')?.classList.remove('painting');
    active.current = undefined;
  };
  useEffect(() => stop, []);

  const paint = (stroke: Stroke) => {
    const hit = document.elementFromPoint(stroke.x, Math.max(0, Math.min(stroke.y, window.innerHeight - 1)))
      ?.closest<HTMLTableRowElement>('[data-selection-row]');
    const next = hit && stroke.label.closest('table') === hit.closest('table') ? stroke.ids.indexOf(hit.dataset.selectionRow ?? '') : -1;
    if (next < 0 || next === stroke.index) return;
    const first = Math.min(stroke.index, next);
    const last = Math.max(stroke.index, next);
    if (!stroke.started) {
      stroke.started = true;
      suppressClick.current = true;
      stroke.label.closest('.table-scroll')?.classList.add('painting');
      onStroke();
    }
    const value = stroke.value;
    update(current => {
      const set = new Set(current);
      for (let index = first; index <= last; index++) {
        if (value) set.add(stroke.ids[index]);
        else set.delete(stroke.ids[index]);
      }
      return set;
    });
    stroke.index = next;
  };

  const begin = (event: PointerEvent<HTMLLabelElement>, id: string) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (active.current) stop();
    suppressClick.current = false;
    const label = event.currentTarget;
    active.current = { pointer: event.pointerId, ids, index: ids.indexOf(id), value: !selected.has(id), started: false, x: event.clientX, y: event.clientY, label };
    label.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLLabelElement>) => {
    const stroke = active.current;
    if (!stroke || stroke.pointer !== event.pointerId) return;
    stroke.x = event.clientX; stroke.y = event.clientY;
    paint(stroke);
    if (!stroke.started || frame.current !== undefined) return;
    const scroll = () => {
      if (active.current !== stroke) return;
      const offset = stroke.y < 65 ? -12 : stroke.y > window.innerHeight - 65 ? 12 : 0;
      if (offset) { window.scrollBy(0, offset); paint(stroke); }
      frame.current = requestAnimationFrame(scroll);
    };
    frame.current = requestAnimationFrame(scroll);
  };
  const end = (event: PointerEvent<HTMLLabelElement>) => {
    const stroke = active.current;
    if (stroke && stroke.pointer === event.pointerId) {
      stroke.x = event.clientX; stroke.y = event.clientY; paint(stroke);
    }
    stop();
  };
  return { begin, move, end, stop, suppressClick };
}
