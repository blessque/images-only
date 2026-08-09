import type { ImageItem, Manifest, Settings, SizeClass } from '@/lib/types';

const JSON_HEADERS = { 'content-type': 'application/json' };

export interface LoginResult {
  token: string | null;
  error: string | null;
}

export async function login(password: string): Promise<LoginResult> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ password }),
  });

  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after') ?? '900');
    const minutes = Math.ceil(seconds / 60);
    return { token: null, error: `Too many attempts. Try again in ${minutes} min.` };
  }

  const data = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || !data.token) {
    return { token: null, error: data.error ?? 'Incorrect password' };
  }
  return { token: data.token, error: null };
}

/** Thrown when the Worker rejects the token — the session simply ended. */
export class SessionExpired extends Error {
  constructor() {
    super('Session expired. Unlock again.');
  }
}

export class AdminApi {
  constructor(private readonly token: string) {}

  private auth(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, ...extra };
  }

  private async send(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(path, init);
    if (response.status === 401) throw new SessionExpired();
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `${init.method ?? 'GET'} ${path} failed (${response.status})`);
    }
    return response.json().catch(() => ({}));
  }

  uploadVariant(id: string, rung: number, blob: Blob): Promise<unknown> {
    return this.send(`/api/upload/${id}/${rung}.webp`, {
      method: 'PUT',
      headers: this.auth(),
      body: blob,
    });
  }

  /** A passthrough image: one object, the source bytes, under its own extension. */
  uploadOriginal(id: string, format: string, blob: Blob): Promise<unknown> {
    return this.send(`/api/upload/${id}/full.${format}`, {
      method: 'PUT',
      headers: this.auth(),
      body: blob,
    });
  }

  createImage(item: ImageItem): Promise<unknown> {
    return this.send('/api/images', {
      method: 'POST',
      headers: this.auth(JSON_HEADERS),
      body: JSON.stringify(item),
    });
  }

  patchImage(id: string, patch: { alt?: string; sizeClass?: SizeClass }): Promise<unknown> {
    return this.send(`/api/images/${id}`, {
      method: 'PATCH',
      headers: this.auth(JSON_HEADERS),
      body: JSON.stringify(patch),
    });
  }

  deleteImage(id: string): Promise<unknown> {
    return this.send(`/api/images/${id}`, { method: 'DELETE', headers: this.auth() });
  }

  restoreImage(id: string): Promise<unknown> {
    return this.send(`/api/images/${id}/restore`, { method: 'POST', headers: this.auth() });
  }

  reorder(ids: string[]): Promise<unknown> {
    return this.send('/api/reorder', {
      method: 'POST',
      headers: this.auth(JSON_HEADERS),
      body: JSON.stringify({ ids }),
    });
  }

  patchSettings(patch: Partial<Settings>): Promise<unknown> {
    return this.send('/api/settings', {
      method: 'PATCH',
      headers: this.auth(JSON_HEADERS),
      body: JSON.stringify(patch),
    });
  }

  async manifest(): Promise<Manifest> {
    const response = await fetch('/api/images', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not reload the gallery');
    return (await response.json()) as Manifest;
  }
}
