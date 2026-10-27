'use client';

import { useMemo, useRef, useState } from 'react';
import {
  CASE_FILE_TYPES,
  DOCUMENT_COMMENT_MAX,
  DOCUMENT_SOURCE_LABELS,
  docTypeLabel,
  isDocumentSource,
} from '@vop/shared';
import { API_BASE, ApiError, apiUpload } from '../lib/api';
import { Icon } from './icons';
import { initials } from './DetailParts';

export interface CaseFile {
  id: string;
  docType: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  version: number;
  createdAt: string;
  source?: string | null;
  comment?: string | null;
  uploadedByName?: string | null;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png';

const SOURCE_ICON: Record<string, string> = {
  vendor_form: 'doc',
  case_files: 'folder',
  fcu_review: 'shield',
  infosec_review: 'lock',
  operation_review: 'briefcase',
  legal_review: 'receipt',
  sap_review: 'check',
  approval: 'check',
};

const sourceLabel = (s?: string | null) =>
  isDocumentSource(s) ? DOCUMENT_SOURCE_LABELS[s] : 'Case files';

const size = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * The case's Files tab: every document on the case with where it was uploaded from, who uploaded
 * it and when, and their comment; plus uploading straight from here (type + optional comment).
 * Files are validated by content and malware-scanned on the server.
 */
export default function CaseFiles({
  caseId,
  files,
  canUpload,
  onUploaded,
}: {
  caseId: string;
  files: CaseFile[];
  canUpload: boolean;
  onUploaded: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');

  const sources = useMemo(() => [...new Set(files.map((f) => f.source ?? 'case_files'))], [files]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter(
      (f) =>
        (source === 'all' || (f.source ?? 'case_files') === source) &&
        (!q ||
          [f.filename, docTypeLabel(f.docType), f.comment ?? '', f.uploadedByName ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
  }, [files, query, source]);

  return (
    <div className="cf">
      {canUpload && <Uploader caseId={caseId} onUploaded={onUploaded} />}

      <section className="cf-card">
        <div className="cf-head">
          <h2>
            Files <span className="cf-count">{files.length}</span>
          </h2>
          {files.length > 0 && (
            <div className="cf-tools">
              <label className="cf-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  placeholder="Search files"
                  aria-label="Search files"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        {sources.length > 1 && (
          <div className="cf-filters" role="group" aria-label="Uploaded from">
            {['all', ...sources].map((s) => (
              <button
                key={s}
                type="button"
                className={`cf-chip${source === s ? ' is-on' : ''}`}
                aria-pressed={source === s}
                onClick={() => setSource(s)}
              >
                {s === 'all' ? 'All' : sourceLabel(s)}
                <span>
                  {s === 'all'
                    ? files.length
                    : files.filter((f) => (f.source ?? 'case_files') === s).length}
                </span>
              </button>
            ))}
          </div>
        )}

        {files.length === 0 ? (
          <div className="cf-empty">
            <span aria-hidden="true">
              <Icon name="folder" size={28} />
            </span>
            <strong>No files yet</strong>
            <p className="muted">
              {canUpload
                ? 'Upload one above. Files from the vendor form and the reviewers also show up here.'
                : 'Files uploaded on the vendor form or by reviewers show up here.'}
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="cf-none muted">No files match.</p>
        ) : (
          <ul className="cf-list">
            {shown.map((f) => (
              <FileRow key={f.id} caseId={caseId} f={f} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FileRow({ caseId, f }: { caseId: string; f: CaseFile }) {
  const clean = f.status === 'CLEAN';
  const kind = f.fileType === 'pdf' ? 'PDF' : f.fileType.toUpperCase();
  return (
    <li className="cf-file">
      <span
        className={`cf-type cf-type--${f.fileType === 'pdf' ? 'pdf' : 'img'}`}
        aria-hidden="true"
      >
        {kind}
      </span>
      <div className="cf-main">
        <div className="cf-name">
          <strong title={f.filename}>{f.filename}</strong>
          {f.version > 1 && <span className="cf-ver">v{f.version}</span>}
        </div>
        <div className="cf-sub">
          <span className="cf-doctype">{docTypeLabel(f.docType)}</span>
          <span>{size(f.sizeBytes)}</span>
          <span title={`SHA-256 ${f.sha256}`}>#{f.sha256.slice(0, 8)}</span>
        </div>
        <dl className="cf-meta">
          <div>
            <dt>Uploaded from</dt>
            <dd>
              <Icon name={SOURCE_ICON[f.source ?? 'case_files'] ?? 'folder'} size={14} />
              {sourceLabel(f.source)}
            </dd>
          </div>
          <div>
            <dt>Uploaded by</dt>
            <dd>
              <span className="cf-avatar" aria-hidden="true">
                {initials(f.uploadedByName ?? '') || '?'}
              </span>
              {f.uploadedByName ?? 'Unknown user'}
            </dd>
          </div>
          <div>
            <dt>Uploaded on</dt>
            <dd>
              <Icon name="clock" size={14} />
              {when(f.createdAt)}
            </dd>
          </div>
        </dl>
        {f.comment && (
          <p className="cf-comment">
            <Icon name="doc" size={14} />
            <span>{f.comment}</span>
          </p>
        )}
      </div>
      <div className="cf-actions">
        <span className={`cf-status${clean ? ' is-clean' : ''}`}>
          <Icon name={clean ? 'shield' : 'alert'} size={14} />
          {clean ? 'Scanned clean' : f.status.toLowerCase()}
        </span>
        {clean && (
          <a
            className="btn btn--sm btn--ghost cf-dl"
            href={`${API_BASE}/cases/${caseId}/documents/${f.id}/download`}
            aria-label={`Download ${f.filename}`}
          >
            <Icon name="download" size={16} /> Download
          </a>
        )}
      </div>
    </li>
  );
}

/** Drag-and-drop (or browse) one file, pick its type, add an optional comment, upload. */
function Uploader({
  caseId,
  onUploaded,
}: {
  caseId: string;
  onUploaded: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>('');
  const [comment, setComment] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setNote(null);
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      setNote({ tone: 'error', text: 'Only PDF, JPG or PNG files can be uploaded.' });
      return;
    }
    setFile(f);
  }

  function reset() {
    setFile(null);
    setDocType('');
    setComment('');
  }

  async function upload() {
    if (!file || !docType || busy) return;
    setBusy(true);
    setNote(null);
    const form = new FormData();
    form.append('file', file);
    form.append('docType', docType);
    form.append('source', 'case_files');
    if (comment.trim()) form.append('comment', comment.trim());
    try {
      await apiUpload(`/cases/${caseId}/documents`, form);
      setNote({ tone: 'ok', text: `${file.name} uploaded and scanned clean.` });
      reset();
      await onUploaded();
    } catch (err) {
      setNote({
        tone: 'error',
        text: err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cf-card cf-up">
      <h2>Upload a file</h2>
      {!file ? (
        <label
          className={`cf-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
          <span className="cf-drop__icon" aria-hidden="true">
            <Icon name="upload" size={22} />
          </span>
          <span>
            <strong>Drag a file here</strong> or <u>browse</u>
          </span>
          <small>PDF, JPG or PNG · checked by content and scanned for malware</small>
        </label>
      ) : (
        <div className="cf-staged">
          <div className="cf-staged__file">
            <span
              className={`cf-type cf-type--${/\.pdf$/i.test(file.name) ? 'pdf' : 'img'}`}
              aria-hidden="true"
            >
              {/\.pdf$/i.test(file.name) ? 'PDF' : 'IMG'}
            </span>
            <div className="cf-main">
              <strong title={file.name}>{file.name}</strong>
              <span className="muted">{size(file.size)}</span>
            </div>
            <button
              type="button"
              className="cf-x"
              onClick={reset}
              disabled={busy}
              aria-label="Remove the file"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="cf-form">
            <label>
              <span>Document type</span>
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="">Select…</option>
                {CASE_FILE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {docTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="cf-form__wide">
              <span>
                Comment <em>optional</em>
              </span>
              <textarea
                rows={2}
                maxLength={DOCUMENT_COMMENT_MAX}
                placeholder="What is this file, or why is it being added?"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <small className="cf-counter">
                {comment.length}/{DOCUMENT_COMMENT_MAX}
              </small>
            </label>
          </div>
          <div className="cf-foot">
            <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void upload()}
              disabled={!docType || busy}
              title={docType ? undefined : 'Choose the document type first'}
            >
              <Icon name="upload" size={16} />
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}
      {note && (
        <p
          className={`cf-note cf-note--${note.tone}`}
          role={note.tone === 'error' ? 'alert' : 'status'}
        >
          <Icon name={note.tone === 'ok' ? 'check' : 'alert'} size={16} />
          {note.text}
        </p>
      )}
    </section>
  );
}
