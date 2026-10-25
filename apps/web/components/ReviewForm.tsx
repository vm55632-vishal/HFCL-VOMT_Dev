'use client';

// Form controls for the reviewer screens: a segmented (radio) control, a drag-and-drop file area,
// and a completion meter. Native inputs underneath, so keyboard and screen readers work normally.

import { useState, type ReactNode } from 'react';
import { Icon } from './icons';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  /** Colour when selected: green, amber or red. Omit for a neutral raised segment. */
  tone?: 'ok' | 'warn' | 'bad';
}

/** A radio group drawn as a segmented toggle (e.g. Yes | No). */
export function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T | '';
  options: SegOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={`seg__opt${o.tone ? ` seg__opt--${o.tone}` : ''}`}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Click-or-drop file area. Calls `onFile` with the chosen file; the caller does the upload. */
export function Dropzone({
  onFile,
  busy,
  invalid,
  accept,
  hint,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  invalid?: boolean;
  accept: string;
  hint: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dz${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}${invalid ? ' is-invalid' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy) onFile(file);
      }}
    >
      <input
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.currentTarget.value = ''; // allow re-selecting the same file
        }}
      />
      <span className="dz__icon">
        <Icon name="upload" size={22} />
      </span>
      <span className="dz__title">
        {busy ? (
          'Uploading and scanning…'
        ) : (
          <>
            <u>Choose a file</u> or drag it here
          </>
        )}
      </span>
      <span className="dz__hint">{hint}</span>
    </label>
  );
}

/** "3 of 4 required" with a progress bar. */
export function Meter({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="fcu-meter">
      <div
        className="fcu-meter__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Required items completed"
      >
        <span className="fcu-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="fcu-meter__txt">
        {done} of {total} required
      </span>
    </div>
  );
}

/** One question tile: label (+ hint or "Required" error) on the left, the control on the right. */
export function Question({
  title,
  hint,
  done,
  invalid,
  children,
}: {
  title: string;
  hint?: string;
  done?: boolean;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`fcu-q${done ? ' is-done' : ''}${invalid ? ' is-invalid' : ''}`}>
      <div className="fcu-q__label">
        <span className="fcu-q__title">{title}</span>
        {invalid ? (
          <span className="fcu-q__err" role="alert">
            Required
          </span>
        ) : hint ? (
          <span className="fcu-q__hint">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
