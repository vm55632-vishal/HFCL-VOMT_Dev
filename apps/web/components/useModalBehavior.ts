'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Standard dialog behaviour: move focus in, Esc to close, Tab kept inside the dialog, page scroll
 * locked behind it, and focus handed back to whatever opened it.
 *
 * Runs once on mount. `onClose` and `blocked` are read through refs so a parent re-render (a new
 * inline `onClose` each time) never re-runs the effect — which would re-steal focus and remember
 * the wrong element to return to. While `blocked` (e.g. a request is in flight) Esc does nothing.
 */
export function useModalBehavior({
  panelRef,
  initialFocusRef,
  onClose,
  blocked = false,
}: {
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  blocked?: boolean;
}) {
  const onCloseRef = useRef(onClose);
  const blockedRef = useRef(blocked);
  onCloseRef.current = onClose;
  blockedRef.current = blocked;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!blockedRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only (see above)
  }, []);
}
