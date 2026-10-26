// Minimal API client. Sends the session cookie (credentials: include) and, when Supabase Auth is
// configured, a Bearer access token so the API can verify the Supabase-issued JWT.
import { ENTITY_FORBIDDEN_MESSAGE, ENTITY_HEADER } from '@vop/shared';
import { getAccessToken, supabaseAuthEnabled } from './supabase';
import { getActiveEntity, onEntityChange, setActiveEntity } from './entity';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// "Who am I" is requested by the sidebar, the header and the page itself on almost every screen.
// Share one in-flight request and reuse the answer briefly. The cache is keyed on the login token,
// so signing in as a different user (new token) never sees the previous user's profile.
const ME_PATH = '/auth/me';
const ME_TTL_MS = 30_000;
let meCache: { key: string; at: number; value: unknown } | null = null;
let meInflight: { key: string; promise: Promise<unknown> } | null = null;

// Stale-while-revalidate for list screens: the last answer is shown at once while a fresh one is
// fetched. Answers are kept in memory only (never in browser storage) and are keyed on the login
// token, so a different person signing in on the same tab can never be shown someone else's list.
const swrStore = new Map<string, unknown>();
const swrInflight = new Map<string, Promise<unknown>>();

/** Forget every cached answer: they all belong to the company that was active. */
function clearCaches(): void {
  meCache = null;
  meInflight = null;
  swrStore.clear();
  swrInflight.clear();
}
// Answers cached for one company must never be shown while another is active.
if (typeof window !== 'undefined') onEntityChange(clearCaches);

export async function apiFetchSwr<T = unknown>(
  path: string,
  onCached?: (data: T) => void,
): Promise<T> {
  const token = supabaseAuthEnabled ? await getAccessToken() : null;
  // Without a per-login token there is nothing safe to key on, so no caching.
  const key = token ? `${token.slice(-24)}|${getActiveEntity() ?? ''}|${path}` : null;
  if (key && onCached && swrStore.has(key)) onCached(swrStore.get(key) as T);
  // Identical requests made at the same moment share one network call.
  let pending = key ? (swrInflight.get(key) as Promise<T> | undefined) : undefined;
  if (!pending) {
    pending = requestJson<T>(path, {}, token);
    if (key) {
      const p = pending;
      swrInflight.set(key, p);
      const done = () => swrInflight.get(key) === p && swrInflight.delete(key);
      p.then(done, done);
    }
  }
  const fresh = await pending;
  if (key) {
    swrStore.set(key, fresh);
    if (swrStore.size > 40) swrStore.delete(swrStore.keys().next().value as string);
  }
  return fresh;
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = supabaseAuthEnabled ? await getAccessToken() : null;
  const method = (options.method ?? 'GET').toUpperCase();
  const isMe = method === 'GET' && path === ME_PATH;
  const meKey = `${token ?? 'cookie-session'}|${getActiveEntity() ?? ''}`;

  if (method !== 'GET' && path.startsWith('/auth/')) {
    clearCaches(); // logout / auth changes: never serve a stale profile
  }
  if (isMe) {
    if (meCache && meCache.key === meKey && Date.now() - meCache.at < ME_TTL_MS) {
      return meCache.value as T;
    }
    if (meInflight && meInflight.key === meKey) return meInflight.promise as Promise<T>;
    const promise = requestJson<T>(path, options, token);
    meInflight = { key: meKey, promise };
    try {
      const value = await promise;
      // Remember the company the server picked, so every later request names it explicitly.
      const active = (value as { activeEntity?: { code?: string } | null })?.activeEntity?.code;
      if (active && active !== getActiveEntity()) setActiveEntity(active);
      meCache = { key: `${token ?? 'cookie-session'}|${active ?? ''}`, at: Date.now(), value };
      return value;
    } catch (err) {
      meCache = null;
      throw err;
    } finally {
      if (meInflight?.promise === promise) meInflight = null;
    }
  }
  return requestJson<T>(path, options, token);
}

async function requestJson<T>(
  path: string,
  options: RequestInit,
  token: string | null,
): Promise<T> {
  const entity = getActiveEntity();
  const res = await send(path, options, token, entity);
  // The saved company is no longer allowed (access removed, or another person signed in on this
  // browser): forget it and let the server pick the user's default company.
  if (res.status === 403 && entity) {
    const peek = await res.clone().text();
    if (peek.includes(ENTITY_FORBIDDEN_MESSAGE)) {
      setActiveEntity(null);
      return requestJson<T>(path, options, token);
    }
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (body && typeof body === 'object' && 'error' in body) {
      message = String((body as { error: unknown }).error);
    }
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function send(
  path: string,
  options: RequestInit,
  token: string | null,
  entity: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (entity) headers[ENTITY_HEADER] = entity;
  // Caller headers are applied first and can never remove the login token or the company.
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.headers as Record<string, string> | undefined), ...headers },
  });
}

export const oidcStartUrl = `${API_BASE}/auth/oidc/start`;
