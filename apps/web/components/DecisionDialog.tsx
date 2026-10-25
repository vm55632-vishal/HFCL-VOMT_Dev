'use client';

import { useRef, useState } from 'react';
import { Icon } from './icons';
import { useModalBehavior } from './useModalBehavior';

const MAX = 2000;

/**
 * Confirmation dialog for the two decisions that need an explanation: sending a case back to the
 * proposer, and rejecting it. A remark is required for both (the API enforces this too). The
 * remark is stored with the decision and shown to the proposer.
 *
 * `onSubmit` resolves to an error message to show inside the dialog (it stays open), or `null`
 * on success (the caller then closes it).
 */
export default function DecisionDialog({
  kind,
  vendor,
  team,
  onCancel,
  onSubmit,
}: {
  kind: 'sendback' | 'reject';
  vendor: string;
  /** The reviewing team, e.g. "FCU" — only that team's review reopens on a send-back. */
  team?: string;
  onCancel: () => void;
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useModalBehavior({ panelRef, initialFocusRef: noteRef, onClose: onCancel, blocked: busy });

  const reject = kind === 'reject';
  const copy = reject
    ? {
        title: 'Reject this case?',
        text: (
          <>
            Are you sure you want to reject <strong>{vendor}</strong>? This stops the onboarding for
            every team, and the proposer will see your comment.
          </>
        ),
        label: 'Reason for rejection',
        placeholder: 'Why is this vendor being rejected?',
        required: 'Please enter a reason before rejecting.',
        confirm: 'Yes, reject case',
        busy: 'Rejecting…',
      }
    : {
        title: 'Send back to proposer',
        text: (
          <>
            Tell the proposer what needs to change on <strong>{vendor}</strong>. They will see your
            remark when they open the case, and can edit and resubmit.
            {team
              ? ` Only the ${team} review reopens; other teams' decisions stay as they are.`
              : ''}
          </>
        ),
        label: 'Remark for the proposer',
        placeholder: 'What needs to be corrected or clarified?',
        required: 'Please enter a remark before sending back.',
        confirm: 'Send back to proposer',
        busy: 'Sending…',
      };

  async function submit() {
    if (busy) return;
    const text = note.trim();
    if (!text) {
      setMissing(true);
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    setServerError(null);
    const error = await onSubmit(text);
    // On success the caller unmounts us; on failure stay open so the remark isn't lost.
    if (error) {
      setServerError(error);
      setBusy(false);
    }
  }

  return (
    <div
      className="vdm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="vdm__panel dlg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-text"
      >
        <div className="vdm__grab" aria-hidden="true" />
        <div className="dlg__body">
          <span className={`dlg__icon dlg__icon--${reject ? 'bad' : 'warn'}`} aria-hidden="true">
            <Icon name={reject ? 'alert' : 'undo'} size={24} />
          </span>
          <h2 id="dlg-title">{copy.title}</h2>
          <p id="dlg-text" className="dlg__text">
            {copy.text}
          </p>

          <label htmlFor="dlg-note" className="dlg__label">
            {copy.label}
            <span className="rv-tag rv-tag--req">Required</span>
          </label>
          <textarea
            id="dlg-note"
            ref={noteRef}
            className="rv-text"
            rows={5}
            maxLength={MAX}
            value={note}
            disabled={busy}
            placeholder={copy.placeholder}
            aria-invalid={missing}
            aria-describedby={missing ? 'dlg-required' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              if (missing && e.target.value.trim()) setMissing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="dlg__meta">
            {missing ? (
              <span id="dlg-required" className="fcu-q__err" role="alert">
                {copy.required}
              </span>
            ) : (
              <span />
            )}
            <span className="rv-count" style={{ margin: 0 }}>
              {note.length} / {MAX}
            </span>
          </div>

          {serverError && (
            <div className="rv-alert rv-alert--warn" role="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" size={18} />
              <span>{serverError}</span>
            </div>
          )}
        </div>

        <div className="dlg__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${reject ? 'btn--destructive' : ''}`}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? copy.busy : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
