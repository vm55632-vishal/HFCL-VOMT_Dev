'use client';

import { TEAM_ROLES, type TeamRoleDef } from '../lib/team-structure';

export interface TeamPerson {
  name: string;
  email: string;
}
export interface TeamInfo {
  configured: boolean;
  team: Record<string, string | null>;
  /** Everyone who can be chosen for each role, keyed by role. */
  directory: Record<string, TeamPerson[]>;
}

/**
 * The team structure as one line per role: pick the person's email from a dropdown and their name
 * fills in beside it. Defaults come from the master table for the signed-in proposer; any change is
 * kept as an override (field -> value) and the default stays visible next to it.
 */
export function TeamStructureEditor({
  info,
  overrides,
  onChange,
}: {
  info: TeamInfo | null;
  overrides: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  if (!info) return <p className="muted">Loading your team structure…</p>;

  const base = info.team;
  const changedCount = Object.keys(overrides).length;
  const baseOf = (key: string | null) => (key ? (base[key] ?? '') : '');
  const valueOf = (key: string) => (key in overrides ? (overrides[key] ?? '') : baseOf(key));

  /** Everyone selectable for a role, plus the master default and current choice if they are not listed. */
  function optionsFor(r: TeamRoleDef): TeamPerson[] {
    const list = [...(info?.directory[r.role] ?? [])];
    const extras = [
      { name: baseOf(r.nameKey), email: baseOf(r.emailKey) },
      { name: r.nameKey ? valueOf(r.nameKey) : '', email: valueOf(r.emailKey) },
    ];
    for (const x of extras) {
      if (x.email && !list.some((p) => p.email.toLowerCase() === x.email.toLowerCase())) {
        list.push(x);
      }
    }
    return list;
  }
  function nameFor(r: TeamRoleDef, email: string): string {
    if (!email) return '';
    const hit = optionsFor(r).find((p) => p.email.toLowerCase() === email.toLowerCase());
    return hit?.name ?? '';
  }

  function pick(r: TeamRoleDef, email: string) {
    const next = { ...overrides };
    if (email.toLowerCase() === baseOf(r.emailKey).toLowerCase()) {
      delete next[r.emailKey];
      if (r.nameKey) delete next[r.nameKey];
    } else {
      next[r.emailKey] = email;
      if (r.nameKey) next[r.nameKey] = nameFor(r, email);
    }
    onChange(next);
  }
  function reset(r: TeamRoleDef) {
    const next = { ...overrides };
    delete next[r.emailKey];
    if (r.nameKey) delete next[r.nameKey];
    onChange(next);
  }
  function setDepartment(v: string) {
    const next = { ...overrides };
    if (v.trim() === baseOf('proposerDepartment')) delete next.proposerDepartment;
    else next.proposerDepartment = v;
    onChange(next);
  }

  return (
    <div className="tsl">
      <div className={`tsl__banner${info.configured ? '' : ' tsl__banner--warn'}`} role="status">
        <div>
          <strong>
            {info.configured
              ? 'Loaded from the team structure master'
              : 'No team structure is set up for you yet'}
          </strong>
          <span>
            {info.configured
              ? `Matched to your login, ${base.proposerEmail ?? ''}. Choose a different email on any line to change it for this case.`
              : 'Choose the email for each role below, and ask an administrator to add you to the master.'}
          </span>
        </div>
        {changedCount > 0 && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange({})}>
            Reset all changes
          </button>
        )}
      </div>

      <div className="tsl__list" role="group" aria-label="Team structure">
        <div className="tsl__row tsl__row--head" aria-hidden="true">
          <span>Role</span>
          <span>Email ID</span>
          <span>Name (fills in automatically)</span>
        </div>

        <div className="tsl__row">
          <span className="tsl__label">
            Proposer <em className="tsl__tag">From your login</em>
          </span>
          <span className="tsl__static">{base.proposerEmail || '—'}</span>
          <span className="tsl__name">{base.proposerName || '—'}</span>
        </div>

        <div className="tsl__row">
          <label className="tsl__label" htmlFor="ts-dept">
            Proposer Department
          </label>
          <input
            id="ts-dept"
            className="tsl__input"
            value={valueOf('proposerDepartment')}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setDepartment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          <span className="tsl__name">
            {'proposerDepartment' in overrides && (
              <>
                <em className="tsl__tag tsl__tag--edited">Edited</em>
                <small>Default: {baseOf('proposerDepartment') || 'none'}</small>
              </>
            )}
          </span>
        </div>

        {TEAM_ROLES.map((r) => {
          const email = valueOf(r.emailKey);
          const options = optionsFor(r);
          const selected =
            options.find((p) => p.email.toLowerCase() === email.toLowerCase())?.email ?? '';
          const name = r.nameKey ? valueOf(r.nameKey) || nameFor(r, email) : '';
          const changed = r.emailKey in overrides;
          const id = `ts-${r.role}`;
          return (
            <div className="tsl__row" key={r.role}>
              <label className="tsl__label" htmlFor={id}>
                {r.label}
              </label>
              <select
                id={id}
                className="tsl__select"
                value={selected}
                onChange={(e) => pick(r, e.target.value)}
              >
                <option value="">{selected ? 'Not applicable' : 'Select an email'}</option>
                {options.map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.email}
                  </option>
                ))}
              </select>
              <span className="tsl__name" aria-live="polite">
                <span>{r.nameKey ? name || '—' : email ? 'Team mailbox' : '—'}</span>
                {changed && (
                  <>
                    <em className="tsl__tag tsl__tag--edited">Edited</em>
                    <small>
                      Default: {baseOf(r.emailKey) || 'none'}{' '}
                      <button type="button" className="tsl__reset" onClick={() => reset(r)}>
                        Reset
                      </button>
                    </small>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
