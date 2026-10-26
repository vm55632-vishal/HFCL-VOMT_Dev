'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { setActiveEntity } from '../lib/entity';
import { Icon } from './icons';

interface Entity {
  id: string;
  code: string;
  name: string;
}
interface Me {
  activeEntity: Entity | null;
  entities: Entity[];
}

/**
 * ADR-0008: shows which group company the user is working in, and lets someone with access to
 * more than one switch. Switching reloads the app on the dashboard, so nothing on screen (a
 * half-filled form, a cached list) carries over from the previous company.
 */
export default function EntitySwitcher() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<Me>('/auth/me')
      .then((m) => !cancelled && setMe(m))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me?.activeEntity) return null;
  const active = me.activeEntity;

  if (me.entities.length < 2) {
    return (
      <span className="entity-switch entity-switch--static" title={active.name}>
        <Icon name="building" size={16} />
        <span className="entity-switch__name">{active.name}</span>
      </span>
    );
  }

  return (
    <label className="entity-switch" title="Switch company">
      <Icon name="building" size={16} />
      <span className="sr-only">Company</span>
      <select
        value={active.code}
        onChange={(e) => {
          if (e.target.value === active.code) return;
          setActiveEntity(e.target.value);
          window.location.assign('/dashboard');
        }}
      >
        {me.entities.map((e) => (
          <option key={e.code} value={e.code}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}
