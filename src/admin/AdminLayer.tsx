import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdminContext, type AdminHooks } from '@/lib/adminContext';
import { newImageId } from '@/lib/ids';
import type { ImageItem, Manifest, SizeClass } from '@/lib/types';
import { AdminApi, SessionExpired } from './api';
import { UnlockDialog } from './UnlockDialog';
import { UploadTray } from './UploadTray';
import { TileControls } from './TileControls';
import { useCompressor } from './useCompressor';
import {
  altFromFilename,
  canPassThrough,
  isAcceptedImage,
  totalBytes,
  type StagedFile,
} from './staging';
import { formatFor } from './compressParams';
import { buildGalleryZip, galleryFilename, saveBlob } from './download';
import './admin.css';

interface AdminLayerProps {
  manifest: Manifest;
  onManifest: (manifest: Manifest) => void;
  onClose: () => void;
  children: ReactNode;
}

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

export default function AdminLayer({ manifest, onManifest, onClose, children }: AdminLayerProps) {
  // IN MEMORY ONLY — never localStorage. Reload ends the session, which is both the
  // requested behaviour and the secure one. See docs/architecture/ADMIN_AUTH.md.
  const [token, setToken] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const compress = useCompressor();

  // Mirrors `staged` so callbacks can read the current list without taking it as a
  // dependency — otherwise every keystroke in an alt field rebuilds them.
  const stagedRef = useRef<StagedFile[]>([]);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);
  const api = useMemo(() => (token ? new AdminApi(token) : null), [token]);

  const notify = useCallback((message: string, undo?: () => void) => {
    setToast({ id: Date.now(), message, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * Downloads the whole gallery as a zip — the same bytes `npm run export` produces.
   *
   * Reads only public routes, so it needs no token: the photographs are already served to
   * anyone who visits. It lives behind the lock because it is an owner's action, not
   * because the bytes are secret.
   */
  const downloadEverything = useCallback(async () => {
    if (downloading !== null) return;
    if (manifest.images.length === 0) {
      notify('Nothing to download yet.');
      return;
    }

    setDownloading('Preparing…');
    try {
      const result = await buildGalleryZip(manifest, ({ done, total }) => {
        setDownloading(`${done} / ${total}`);
      });
      saveBlob(result.blob, galleryFilename());
      notify(
        result.missing.length > 0
          ? `Downloaded ${result.files} files — ${result.missing.length} could not be read.`
          : `Downloaded ${result.files} files.`,
      );
    } catch (error) {
      notify(error instanceof Error ? `Download failed: ${error.message}` : 'Download failed.');
    } finally {
      setDownloading(null);
    }
  }, [downloading, manifest, notify]);

  const handleFailure = useCallback(
    (cause: unknown) => {
      if (cause instanceof SessionExpired) {
        setToken(null);
        notify('Session expired. Unlock again.');
      } else {
        notify(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [notify],
  );

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      onManifest(await api.manifest());
    } catch (cause) {
      handleFailure(cause);
    }
  }, [api, onManifest, handleFailure]);

  // ── Staging ───────────────────────────────────────────────────────────────
  const patchStaged = useCallback((jobId: string, patch: Partial<StagedFile>) => {
    setStaged((files) =>
      files.map((file) => (file.jobId === jobId ? { ...file, ...patch } : file)),
    );
  }, []);

  const runCompression = useCallback(
    async (jobId: string, file: File, options: { highFidelity: boolean; noCompression: boolean }) => {
      patchStaged(jobId, { status: 'compressing', rung: null, error: undefined });
      try {
        const outcome = await compress(
          jobId,
          file,
          {
            mode: options.noCompression ? 'passthrough' : 'ladder',
            highFidelity: options.highFidelity,
            format: formatFor(file) ?? 'webp',
          },
          (rung) => patchStaged(jobId, { rung }),
        );
        patchStaged(jobId, {
          status: 'ready',
          aspect: outcome.aspect,
          variants: outcome.variants,
          compressedBytes: totalBytes(outcome.variants),
          format: outcome.format,
          rung: null,
        });
      } catch (cause) {
        patchStaged(jobId, {
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [compress, patchStaged],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const images = incoming.filter(isAcceptedImage);
      if (images.length === 0) return;

      const entries: StagedFile[] = images.map((file) => ({
        jobId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: 'queued',
        rung: null,
        aspect: 1,
        sizeClass: 'tight',
        alt: altFromFilename(file.name),
        highFidelity: false,
        // Pre-checked for anything already small enough that re-encoding it would only
        // cost quality. The user can uncheck it to run the ladder anyway.
        noCompression: canPassThrough(file),
        format: formatFor(file) ?? 'webp',
        variants: [],
        sourceBytes: file.size,
        compressedBytes: 0,
        previewUrl: URL.createObjectURL(file),
      }));
      setStaged((files) => [...files, ...entries]);

      // Sequential on purpose: twenty concurrent decodes of 10MB photographs is how a
      // responsive-looking tray runs the machine out of memory.
      for (const entry of entries) {
        await runCompression(entry.jobId, entry.file, {
          highFidelity: entry.highFidelity,
          noCompression: entry.noCompression,
        });
      }
    },
    [runCompression],
  );

  /**
   * High fidelity RE-ENCODES that one file.
   *
   * The checkbox only appears after the first pass has already run, so toggling it has to
   * redo the work — otherwise it is a control that visibly does nothing, which is worse
   * than not offering it. Still per-image and reversible; never a global switch.
   */
  const setHighFidelity = useCallback(
    (jobId: string, highFidelity: boolean) => {
      const entry = stagedRef.current.find((file) => file.jobId === jobId);
      if (!entry) return;
      patchStaged(jobId, { highFidelity });
      void runCompression(jobId, entry.file, { highFidelity, noCompression: false });
    },
    [patchStaged, runCompression],
  );

  /**
   * "No compression" — upload the source bytes untouched.
   *
   * Unchecking it runs the normal ladder, which is the only reason it is a checkbox rather
   * than an automatic rule: a small file that IS worth re-encoding (a 120KB PNG that would
   * halve as WebP) stays the user's call.
   */
  const setNoCompression = useCallback(
    (jobId: string, noCompression: boolean) => {
      const entry = stagedRef.current.find((file) => file.jobId === jobId);
      if (!entry) return;
      patchStaged(jobId, { noCompression });
      void runCompression(jobId, entry.file, {
        highFidelity: entry.highFidelity,
        noCompression,
      });
    },
    [patchStaged, runCompression],
  );

  /**
   * Reorder inside the tray, before anything is published.
   *
   * `publish` walks `staged` in array order and `sort_order` is assigned on insert, so the
   * tray's order IS the gallery's order — arranging here saves shuffling afterwards.
   */
  const reorderStaged = useCallback((from: number, to: number) => {
    setStaged((files) => {
      if (from < 0 || to < 0 || from >= files.length || to >= files.length || from === to) {
        return files;
      }
      const next = [...files];
      const [moved] = next.splice(from, 1);
      if (!moved) return files;
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const moveStaged = useCallback(
    (jobId: string, direction: -1 | 1) => {
      const from = stagedRef.current.findIndex((file) => file.jobId === jobId);
      if (from >= 0) reorderStaged(from, from + direction);
    },
    [reorderStaged],
  );

  const discard = useCallback(() => {
    setStaged((files) => {
      for (const file of files) URL.revokeObjectURL(file.previewUrl);
      return [];
    });
  }, []);

  const publish = useCallback(async () => {
    if (!api) return;
    setPublishing(true);
    let published = 0;

    for (const file of staged) {
      if (file.status !== 'ready') continue;
      const id = newImageId();
      try {
        patchStaged(file.jobId, { status: 'uploading' });
        // Every rung lands in R2 BEFORE the metadata row is written, so an abandoned
        // upload orphans bytes rather than pointing the manifest at a missing image.
        const passthrough = file.noCompression;
        await Promise.all(
          file.variants.map((variant) =>
            passthrough
              ? api.uploadOriginal(id, file.format, variant.blob)
              : api.uploadVariant(id, variant.rung, variant.blob),
          ),
        );
        const item: ImageItem = {
          id,
          aspect: file.aspect,
          sizeClass: file.sizeClass,
          alt: file.alt,
          // The largest rung the encoder actually produced. A source smaller than the top
          // of the ladder stops part way up, and srcset must not claim otherwise.
          // Meaningless for a passthrough — there is one object and no ladder.
          maxRung: passthrough ? 400 : Math.max(...file.variants.map((variant) => variant.rung)),
          passthrough,
          format: file.format,
        };
        await api.createImage(item);
        patchStaged(file.jobId, { status: 'done' });
        published += 1;
      } catch (cause) {
        patchStaged(file.jobId, {
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
        handleFailure(cause);
      }
    }

    setPublishing(false);
    if (published > 0) {
      discard();
      await refresh();
      notify(`Published ${published}.`);
    }
  }, [api, staged, patchStaged, discard, refresh, notify, handleFailure]);

  // ── Editing ───────────────────────────────────────────────────────────────
  // Auto-save per action with an undo toast: a non-technical user should never wonder
  // whether he saved, nor lose work to a misclick.
  const move = useCallback(
    async (id: string, direction: -1 | 1) => {
      if (!api) return;
      const images = manifest.images;
      const from = images.findIndex((image) => image.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= images.length) return;

      const next = [...images];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);

      onManifest({ ...manifest, images: next }); // optimistic
      try {
        await api.reorder(next.map((image) => image.id));
      } catch (cause) {
        onManifest({ ...manifest, images });
        handleFailure(cause);
      }
    },
    [api, manifest, onManifest, handleFailure],
  );

  const patchImage = useCallback(
    async (id: string, patch: { sizeClass?: SizeClass; alt?: string }) => {
      if (!api) return;
      const before = manifest.images;
      onManifest({
        ...manifest,
        images: before.map((image) => (image.id === id ? { ...image, ...patch } : image)),
      });
      try {
        await api.patchImage(id, patch);
      } catch (cause) {
        onManifest({ ...manifest, images: before });
        handleFailure(cause);
      }
    },
    [api, manifest, onManifest, handleFailure],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!api) return;
      const before = manifest.images;
      onManifest({ ...manifest, images: before.filter((image) => image.id !== id) });
      try {
        await api.deleteImage(id);
        // Soft delete keeps the R2 bytes, so undo genuinely restores the image.
        notify('Deleted.', async () => {
          try {
            await api.restoreImage(id);
            await refresh();
            setToast(null);
          } catch (cause) {
            handleFailure(cause);
          }
        });
      } catch (cause) {
        onManifest({ ...manifest, images: before });
        handleFailure(cause);
      }
    },
    [api, manifest, onManifest, notify, refresh, handleFailure],
  );

  // ── Input ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (typing) return;
      if (event.key === 'Escape') setSelectedId(null);
      if (selectedId && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        void move(selectedId, event.key === 'ArrowLeft' ? -1 : 1);
      }
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void addFiles([...(event.dataTransfer?.files ?? [])]);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [token, selectedId, move, addFiles]);

  const editSettings = useCallback(
    async (patch: Partial<Manifest['settings']>) => {
      if (!api) return;
      const before = manifest.settings;
      if (Object.entries(patch).every(([key, value]) => before[key as 'name'] === value)) return;

      onManifest({ ...manifest, settings: { ...before, ...patch } });
      try {
        await api.patchSettings(patch);
      } catch (cause) {
        onManifest({ ...manifest, settings: before });
        handleFailure(cause);
      }
    },
    [api, manifest, onManifest, handleFailure],
  );

  const hooks = useMemo<AdminHooks>(
    () =>
      token
        ? {
            adminActive: true,
            editSettings: (patch) => void editSettings(patch),
            renderTileOverlay: (item, index) => (
              <div
                className={selectedId === item.id ? 'tc-wrap is-selected' : 'tc-wrap'}
                onClick={() => setSelectedId(item.id)}
              >
                <TileControls
                  item={item}
                  index={index}
                  total={manifest.images.length}
                  onMove={move}
                  onSizeClass={(id, sizeClass) => void patchImage(id, { sizeClass })}
                  onAlt={(id, alt) => void patchImage(id, { alt })}
                  onDelete={(id) => void remove(id)}
                />
              </div>
            ),
          }
        : {},
    [token, selectedId, manifest.images.length, move, patchImage, remove, editSettings],
  );

  if (!token) {
    return (
      <>
        {children}
        <UnlockDialog onUnlocked={setToken} onCancel={onClose} />
      </>
    );
  }

  return (
    <AdminContext.Provider value={hooks}>
      {children}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void addFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />

      {dragging ? <div className="drop-overlay">Drop photographs to add them</div> : null}

      {staged.length > 0 ? (
        <UploadTray
          staged={staged}
          publishing={publishing}
          onChange={patchStaged}
          onHighFidelity={setHighFidelity}
          onNoCompression={setNoCompression}
          onMove={moveStaged}
          onReorder={reorderStaged}
          onRemove={(jobId) => {
            setStaged((files) => files.filter((file) => file.jobId !== jobId));
          }}
          onPublish={() => void publish()}
          onCancel={discard}
        />
      ) : null}

      <div className="admin-bar">
        <span className="admin-dot" aria-hidden="true" />
        <span>Admin</span>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Add photos ⌘I
        </button>
        <button type="button" onClick={downloadEverything} disabled={downloading !== null}>
          {downloading === null ? 'Download everything' : `Downloading ${downloading}`}
        </button>
        <span className="admin-hint">
          Click an image, then ← → to reorder. Reloading the page locks it again.
        </span>
        <button type="button" onClick={onClose}>
          Lock
        </button>
      </div>

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo ? (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </AdminContext.Provider>
  );
}
