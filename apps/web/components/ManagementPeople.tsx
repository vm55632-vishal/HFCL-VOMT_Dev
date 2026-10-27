'use client';

import type { ReactNode } from 'react';
import {
  MANAGEMENT,
  PERSON_FIELD_LABELS,
  type ManagementRole,
  type PersonField,
} from '@vop/shared';

/** One proprietor / partner / director / Karta as typed on the form. */
export interface PersonRow {
  name: string;
  dob: string;
  maritalStatus: string;
  gender: string;
  fatherName: string;
  spouseName: string;
  pan: string;
  address: string;
  mobile: string;
  residencePhone: string;
  pincode: string;
  contact: string;
  officeAddress: string;
}
export const EMPTY_PERSON: PersonRow = {
  name: '',
  dob: '',
  maritalStatus: '',
  gender: '',
  fatherName: '',
  spouseName: '',
  pan: '',
  address: '',
  mobile: '',
  residencePhone: '',
  pincode: '',
  contact: '',
  officeAddress: '',
};

const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/** The input for one field of one person. */
function PersonInput({
  field,
  row,
  label,
  onChange,
}: {
  field: PersonField;
  row: PersonRow;
  label: string;
  onChange: (patch: Partial<PersonRow>) => void;
}) {
  const common = { 'aria-label': label, required: true };
  switch (field) {
    case 'dob':
      return (
        <input
          {...common}
          type="date"
          value={row.dob}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChange({ dob: e.target.value })}
        />
      );
    case 'maritalStatus':
      return (
        <select
          {...common}
          value={row.maritalStatus}
          onChange={(e) =>
            onChange({
              maritalStatus: e.target.value,
              ...(e.target.value !== 'Married' ? { spouseName: '' } : {}),
            })
          }
        >
          <option value="">Select</option>
          <option>Single</option>
          <option>Married</option>
          <option>Divorced</option>
          <option>Widowed</option>
        </select>
      );
    case 'gender':
      return (
        <select
          {...common}
          value={row.gender}
          onChange={(e) => onChange({ gender: e.target.value })}
        >
          <option value="">Select</option>
          <option>Male</option>
          <option>Female</option>
          <option>Other</option>
        </select>
      );
    case 'spouseName':
      return (
        <input
          aria-label={label}
          value={row.spouseName}
          maxLength={200}
          disabled={row.maritalStatus !== 'Married'}
          required={row.maritalStatus === 'Married'}
          placeholder={row.maritalStatus === 'Married' ? '' : 'n/a'}
          onChange={(e) => onChange({ spouseName: e.target.value })}
        />
      );
    case 'pan':
      return (
        <input
          {...common}
          value={row.pan}
          maxLength={10}
          pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]"
          title="PAN: five letters, four digits, one letter (e.g. ABCDE1234F)"
          autoComplete="off"
          onChange={(e) => onChange({ pan: e.target.value.toUpperCase() })}
        />
      );
    case 'address':
    case 'officeAddress':
      return (
        <textarea
          {...common}
          value={row[field]}
          rows={2}
          maxLength={500}
          onChange={(e) => onChange({ [field]: e.target.value })}
        />
      );
    case 'mobile':
      return (
        <input
          {...common}
          type="tel"
          inputMode="numeric"
          value={row.mobile}
          maxLength={10}
          pattern="[6-9][0-9]{9}"
          title="10-digit Indian mobile number"
          onChange={(e) => onChange({ mobile: digits(e.target.value, 10) })}
        />
      );
    case 'residencePhone':
    case 'contact':
      return (
        <input
          {...common}
          type="tel"
          inputMode="numeric"
          value={row[field]}
          maxLength={15}
          pattern="[0-9]{6,15}"
          title="Phone number with STD code, digits only"
          onChange={(e) => onChange({ [field]: digits(e.target.value, 15) })}
        />
      );
    case 'pincode':
      return (
        <input
          {...common}
          inputMode="numeric"
          value={row.pincode}
          maxLength={6}
          pattern="[0-9]{6}"
          title="6-digit pin code"
          onChange={(e) => onChange({ pincode: digits(e.target.value, 6) })}
        />
      );
    default:
      return (
        <input
          {...common}
          value={row[field]}
          maxLength={200}
          onChange={(e) => onChange({ [field]: e.target.value })}
        />
      );
  }
}

/**
 * The people of the management structure for the vendor's constitution: one proprietor or Karta
 * (a form), or a list of partners or directors (a table).
 */
export default function ManagementPeople({
  role,
  rows,
  onChange,
  onAdd,
  onRemove,
  photo,
}: {
  role: ManagementRole;
  rows: PersonRow[];
  onChange: (i: number, patch: Partial<PersonRow>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  /** Photograph upload, for a role that needs one. */
  photo?: ReactNode;
}) {
  const def = MANAGEMENT[role];
  const label = (k: PersonField) =>
    k === 'name'
      ? `Name of the ${role === 'karta' ? def.noun : def.noun.toLowerCase()}`
      : PERSON_FIELD_LABELS[k];

  if (def.single) {
    const row = rows[0] ?? EMPTY_PERSON;
    return (
      <div className="grid2">
        {def.fields.map((k) => (
          <label key={k} className={k === 'address' ? 'span2' : undefined}>
            {label(k)} {k === 'spouseName' ? '(if married)' : ''}
            <PersonInput
              field={k}
              row={row}
              label={`${def.noun} ${label(k).toLowerCase()}`}
              onChange={(patch) => onChange(0, patch)}
            />
          </label>
        ))}
        {photo}
      </div>
    );
  }

  return (
    <>
      {rows.length > 0 && (
        <div className="partners__scroll">
          <table className="partners__tbl">
            <thead>
              <tr>
                <th>#</th>
                {def.fields.map((k) => (
                  <th key={k}>{label(k)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td className="partners__n">{i + 1}</td>
                  {def.fields.map((k) => (
                    <td key={k}>
                      <PersonInput
                        field={k}
                        row={p}
                        label={`${def.noun} ${i + 1} ${label(k).toLowerCase()}`}
                        onChange={(patch) => onChange(i, patch)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      aria-label={`Remove ${def.noun.toLowerCase()} ${i + 1}`}
                      onClick={() => onRemove(i)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && (
        <p className="muted">No {def.noun.toLowerCase()}s added yet. Add at least one.</p>
      )}
      <div className="req__actions">
        <button type="button" className="btn btn--sm" onClick={onAdd}>
          + Add {def.noun.toLowerCase()}
        </button>
      </div>
    </>
  );
}
