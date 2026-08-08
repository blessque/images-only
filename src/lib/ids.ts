/**
 * Image ids are minted on the CLIENT, because the R2 keys (`{id}/{rung}.webp`) must exist
 * before the variants can be uploaded — and the variants are uploaded before the metadata
 * row is written, so that an abandoned upload leaves orphan bytes rather than a manifest
 * row pointing at nothing. See docs/architecture/IMAGE_PIPELINE.md.
 *
 * 64 bits of `crypto.getRandomValues`. The Worker validates the shape and returns 409 on
 * the (astronomically unlikely) collision rather than letting a constraint error 500.
 */
export function newImageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Must match the Worker's route patterns exactly — both sides validate. */
export const IMAGE_ID_PATTERN = /^[a-f0-9]{16}$/;
