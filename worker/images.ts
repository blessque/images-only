import type { ImageItem, Manifest, Settings, SizeClass } from '../src/lib/types';

/** Types only across this boundary — `worker/` and `src/` run in different runtimes. */

interface ImageRow {
  id: string;
  aspect: number;
  size_class: string;
  alt: string;
  max_rung: number;
  sort_order: number;
}

function toItem(row: ImageRow): ImageItem {
  return {
    id: row.id,
    aspect: row.aspect,
    sizeClass: row.size_class as SizeClass,
    alt: row.alt,
    maxRung: row.max_rung,
  };
}

export async function readManifest(db: D1Database): Promise<Manifest> {
  const [images, settings] = await Promise.all([
    db
      .prepare(
        `SELECT id, aspect, size_class, alt, max_rung, sort_order FROM images
         WHERE deleted_at IS NULL ORDER BY sort_order ASC`,
      )
      .all<ImageRow>(),
    db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>(),
  ]);

  const map = new Map(settings.results.map((row) => [row.key, row.value]));
  return {
    images: images.results.map(toItem),
    settings: {
      name: map.get('name') ?? '',
      contact: map.get('contact') ?? '',
    },
  };
}

export async function nextSortOrder(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM images')
    .first<{ max_order: number }>();
  return (row?.max_order ?? 0) + 1;
}

export async function insertImage(
  db: D1Database,
  item: ImageItem,
  sortOrder: number,
  now: number = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO images (id, aspect, size_class, alt, max_rung, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(item.id, item.aspect, item.sizeClass, item.alt, item.maxRung, sortOrder, now)
    .run();
}

export interface ImagePatch {
  alt?: string;
  sizeClass?: SizeClass;
  sortOrder?: number;
}

export async function updateImage(db: D1Database, id: string, patch: ImagePatch): Promise<boolean> {
  const assignments: string[] = [];
  const values: (string | number)[] = [];

  if (patch.alt !== undefined) {
    assignments.push('alt = ?');
    values.push(patch.alt);
  }
  if (patch.sizeClass !== undefined) {
    assignments.push('size_class = ?');
    values.push(patch.sizeClass);
  }
  if (patch.sortOrder !== undefined) {
    assignments.push('sort_order = ?');
    values.push(patch.sortOrder);
  }
  if (assignments.length === 0) return false;

  values.push(id);
  const result = await db
    .prepare(`UPDATE images SET ${assignments.join(', ')} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...values)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * SOFT delete. The R2 objects are deliberately left in place — undo must be able to bring
 * the image back, and orphan bytes are cheap and invisible where a missing image is not.
 */
export async function softDeleteImage(
  db: D1Database,
  id: string,
  now: number = Date.now(),
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE images SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(now, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function restoreImage(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE images SET deleted_at = NULL WHERE id = ?')
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Applies a whole ordering in one batch, so the grid can never render a half-reordered state. */
export async function reorderImages(db: D1Database, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const statement = db.prepare('UPDATE images SET sort_order = ? WHERE id = ?');
  await db.batch(orderedIds.map((id, index) => statement.bind(index + 1, id)));
}

export async function updateSettings(db: D1Database, patch: Partial<Settings>): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => typeof value === 'string');
  if (entries.length === 0) return;
  const statement = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  await db.batch(entries.map(([key, value]) => statement.bind(key, value)));
}
