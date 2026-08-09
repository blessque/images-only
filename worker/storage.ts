/**
 * Where image bytes live.
 *
 * One interface, two implementations, chosen by which binding is configured. This exists
 * because R2 requires a credit card on the account and Workers KV does not — but the R2
 * path is kept, working, so re-enabling it later is a config change and not a merge.
 *
 * Everything the rest of the Worker knows about storage is these two functions. Adding a
 * third backend — a filesystem, for a self-hosted Node deployment on a Russian VPS — means
 * implementing them again and nothing else. See docs/architecture/OVERVIEW.md.
 */

export interface StorageEnv {
  /** Present only when R2 is enabled on the account. Preferred when it is. */
  BUCKET?: R2Bucket;
  IMAGES: KVNamespace;
}

export interface StoredObject {
  body: ReadableStream | null;
  etag: string;
}

/**
 * KV has no ETag of its own, so we derive one from the key.
 *
 * That is CORRECT here rather than a fudge: keys are immutable by construction — a key is
 * written once and "replace image" mints a new id — so a key identifies its bytes for
 * ever. See docs/architecture/IMAGE_PIPELINE.md.
 */
function keyEtag(key: string): string {
  return `W/"${key}"`;
}

export async function getObject(env: StorageEnv, key: string): Promise<StoredObject | null> {
  if (env.BUCKET) {
    const object = await env.BUCKET.get(key);
    return object ? { body: object.body, etag: object.httpEtag } : null;
  }

  const body = await env.IMAGES.get(key, 'stream');
  return body ? { body, etag: keyEtag(key) } : null;
}

/**
 * Takes an ArrayBuffer rather than a stream, deliberately.
 *
 * Uploads are capped at 8MB and are usually well under 1MB, so buffering costs nothing —
 * and it lets the caller enforce that cap on the ACTUAL bytes instead of trusting a
 * client-supplied `content-length` header, which is a small correctness win we get for
 * free. KV's own value ceiling is 25MB, far above ours.
 */
export async function putObject(
  env: StorageEnv,
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
  cacheControl: string,
): Promise<void> {
  if (env.BUCKET) {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType, cacheControl } });
    return;
  }

  // KV stores no content type; the Worker derives it from the path on the way out, which
  // is the same source of truth the upload route validates against.
  await env.IMAGES.put(key, bytes);
}

/** Which backend is actually in use — for the deploy smoke test and for honest logs. */
export function storageBackend(env: StorageEnv): 'r2' | 'kv' {
  return env.BUCKET ? 'r2' : 'kv';
}
