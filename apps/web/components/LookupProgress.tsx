'use client';

import { useEffect, useState } from 'react';

/**
 * A slim animated progress bar with a short status line that moves through the steps of a registry
 * lookup, so a wait of several seconds reads as progress rather than a frozen form. The steps are
 * timed hints only; the bar finishes when the lookup itself finishes and this is unmounted.
 */
export function LookupProgress({
  steps,
  stepMs = 1800,
  label,
}: {
  steps: string[];
  stepMs?: number;
  /** Read by screen readers instead of the changing step text. */
  label: string;
}) {
  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      setI(Math.min(steps.length - 1, Math.floor(ms / stepMs)));
    }, 250);
    return () => clearInterval(t);
  }, [steps.length, stepMs]);

  const secs = Math.floor(elapsed / 1000);
  return (
    <div className="lookup" role="status" aria-live="polite" aria-label={label}>
      <div className="lookup__track" aria-hidden="true">
        <span className="lookup__bar" />
      </div>
      <div className="lookup__text" aria-hidden="true">
        <span className="lookup__dot" />
        <span key={i} className="lookup__step">
          {steps[i]}
        </span>
        {secs >= 4 && <span className="lookup__secs">{secs}s</span>}
      </div>
    </div>
  );
}
