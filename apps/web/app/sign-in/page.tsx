'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, oidcStartUrl } from '../../lib/api';
import { getSupabase, supabaseAuthEnabled } from '../../lib/supabase';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (supabaseAuthEnabled) {
        const supabase = getSupabase();
        if (!supabase) throw new Error('Supabase is not configured.');
        const { error: sbError } = await supabase.auth.signInWithPassword({ email, password });
        if (sbError) throw new Error(sbError.message);
      } else {
        await apiFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__head">
          <span className="brand-mark brand-mark--lg">VOP</span>
          <h1>Welcome back</h1>
          <p className="lead" style={{ margin: 0 }}>
            Sign in to the Vendor Onboarding Platform
          </p>
        </div>

        <div className="card">
          {!supabaseAuthEnabled && (
            <>
              <a className="btn btn--sso" href={oidcStartUrl}>
                Sign in with SSO
              </a>
              <div className="divider">or use a break-glass account</div>
            </>
          )}

          <form onSubmit={onSubmit}>
            <label className="field">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@corp.test"
                required
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn btn--block">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="faint" style={{ textAlign: 'center', fontSize: '0.8rem', marginTop: '18px' }}>
          {supabaseAuthEnabled ? 'Authenticated via Supabase. ' : ''}Protected system. Access is
          monitored and audited.
        </p>
      </div>
    </main>
  );
}
