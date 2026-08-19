import { useState } from 'react';
import { SIZE_CLASSES, type SizeClass } from '@/lib/types';
import { canPassThrough, formatBytes, savedLabel, type StagedFile } from './staging';
import { DAILY_WRITE_BUDGET } from './compressParams';

interface UploadTrayProps {
  staged: StagedFile[];
  publishing: boolean;
  onChange: (jobId: string, patch: Partial<StagedFile>) => void;
  /** Re-encodes that one file — the checkbox appears after the first pass has already run. */
  onHighFidelity: (jobId: string, value: boolean) => void;
  /** Small files only: upload the source bytes untouched, or run the ladder anyway. */
  onNoCompression: (jobId: string, value: boolean) => void;
  /** The tray's order becomes the gallery's order, so arranging here saves shuffling later. */
  onMove: (jobId: string, direction: -1 | 1) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (jobId: string) => void;
  onPublish: () => void;
  onCancel: () => void;
}

export function UploadTray({
  staged,
  publishing,
  onChange,
  onHighFidelity,
  onNoCompression,
  onMove,
  onReorder,
  onRemove,
  onPublish,
  onCancel,
}: UploadTrayProps) {
  const ready = staged.filter((file) => file.status === 'ready').length;
  const failed = staged.filter((file) => file.status === 'error').length;

  // Every variant is one storage write, and the free tier allows 1,000 a day. A batch that
  // would exceed it fails part way through with nothing to explain why, so say so first.
  const writes = staged
    .filter((file) => file.status === 'ready')
    .reduce((total, file) => total + file.variants.length, 0);
  const overBudget = writes > DAILY_WRITE_BUDGET;

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function endDrag() {
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <section className="tray" aria-label="Upload">
      <header className="tray-head">
        <strong>{staged.length} to publish</strong>
        <span className="tray-note">
          {ready} ready{failed > 0 ? ` · ${failed} failed` : ''}
        </span>
        <button type="button" className="tray-ghost" onClick={onCancel} disabled={publishing}>
          Discard
        </button>
        <button
          type="button"
          className="tray-primary"
          onClick={onPublish}
          disabled={publishing || ready === 0}
        >
          {publishing ? 'Publishing…' : `Publish ${ready}`}
        </button>
      </header>

      {overBudget ? (
        <p className="tray-budget" role="status">
          This batch is {writes} uploads and the free storage tier allows{' '}
          {DAILY_WRITE_BUDGET.toLocaleString('en-US')} a day. Publish some of it tomorrow, or
          the last images will fail with no explanation.
        </p>
      ) : null}

      <ul className="tray-list">
        {staged.map((file, index) => (
          <li
            key={file.jobId}
            className={
              'tray-item is-' +
              file.status +
              (dragOver === index && dragFrom !== null && dragFrom !== index
                ? dragFrom < index
                  ? ' is-drop-after'
                  : ' is-drop-before'
                : '')
            }
            onDragOver={(event) => {
              if (dragFrom === null) return;
              event.preventDefault();
              setDragOver(index);
            }}
            onDrop={(event) => {
              if (dragFrom === null) return;
              event.preventDefault();
              onReorder(dragFrom, index);
              endDrag();
            }}
          >
            {/*
              Only the HANDLE is draggable, not the whole row. Making the <li> draggable
              breaks text selection in the alt-text input inside it — you end up dragging
              the row when you meant to select a word.
            */}
            <div
              className="tray-order"
              draggable={!publishing}
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = 'move';
                // Drag the whole row as the ghost, not the little handle.
                const row = event.currentTarget.closest('li');
                if (row) event.dataTransfer.setDragImage(row, 24, 24);
              }}
              onDragEnd={endDrag}
              title="Drag to reorder"
            >
              <button
                type="button"
                onClick={() => onMove(file.jobId, -1)}
                disabled={publishing || index === 0}
                aria-label="Move up"
                title="Move earlier"
              >
                ↑
              </button>
              <span className="tray-position">{index + 1}</span>
              <button
                type="button"
                onClick={() => onMove(file.jobId, 1)}
                disabled={publishing || index === staged.length - 1}
                aria-label="Move down"
                title="Move later"
              >
                ↓
              </button>
            </div>

            <img className="tray-thumb" src={file.previewUrl} alt="" />

            <div className="tray-fields">
              <input
                className="tray-alt"
                value={file.alt}
                onChange={(event) => onChange(file.jobId, { alt: event.target.value })}
                placeholder="Alt text"
                disabled={publishing}
              />

              <div className="tray-row">
                <div className="tray-classes" role="group" aria-label="Size">
                  {SIZE_CLASSES.map((sizeClass: SizeClass) => (
                    <button
                      key={sizeClass}
                      type="button"
                      className={file.sizeClass === sizeClass ? 'is-active' : ''}
                      onClick={() => onChange(file.jobId, { sizeClass })}
                      disabled={publishing}
                    >
                      {sizeClass}
                    </button>
                  ))}
                </div>

                {/*
                  One checkbox, two meanings — and both are "compress this less", so the
                  direction stays consistent. It is per image and reversible; a GLOBAL
                  skip-compression switch stays rejected, because a non-technical user
                  turns that off "to be safe" and ships a 200MB page.
                  See docs/decisions/TUNING_LOG.md.
                */}
                {canPassThrough(file.file) ? (
                  <label
                    className="tray-fidelity"
                    title="Uploads the original bytes untouched — nothing is re-encoded"
                  >
                    <input
                      type="checkbox"
                      checked={file.noCompression}
                      onChange={(event) => onNoCompression(file.jobId, event.target.checked)}
                      disabled={publishing || file.status === 'compressing'}
                    />
                    No compression
                  </label>
                ) : (
                  <label
                    className="tray-fidelity"
                    title="Re-encodes this image at a higher quality and a larger byte budget"
                  >
                    <input
                      type="checkbox"
                      checked={file.highFidelity}
                      onChange={(event) => onHighFidelity(file.jobId, event.target.checked)}
                      disabled={publishing || file.status === 'compressing'}
                    />
                    High fidelity
                  </label>
                )}
              </div>
            </div>

            {/* Honest numbers, so he can trust his own eyes rather than a switch. */}
            <div className="tray-size">
              {file.status === 'compressing' ? (
                <span className="tray-progress">
                  {file.noCompression
                    ? 'reading…'
                    : `${file.highFidelity ? 're-encoding ' : ''}${
                        file.rung ? `${file.rung}px…` : 'reading…'
                      }`}
                </span>
              ) : file.status === 'error' ? (
                <span className="tray-error">{file.error}</span>
              ) : file.noCompression && file.compressedBytes > 0 ? (
                // Nothing was re-encoded, so a before/after would be theatre.
                <>
                  <span className="tray-after">{formatBytes(file.sourceBytes)}</span>
                  <span className="tray-untouched">untouched</span>
                </>
              ) : file.compressedBytes > 0 ? (
                <>
                  <span className="tray-before">{formatBytes(file.sourceBytes)}</span>
                  <span className="tray-arrow">→</span>
                  <span className="tray-after">{formatBytes(file.compressedBytes)}</span>
                  {/*
                    Signed inside, because this figure can legitimately go either way — a
                    source already smaller than the rung it is being compared against comes
                    out bigger, and that should not arrive dressed in the green of a win.
                  */}
                  <span
                    className={
                      'tray-saved' +
                      (file.compressedBytes > file.sourceBytes ? ' is-grown' : '')
                    }
                  >
                    {savedLabel(file.sourceBytes, file.compressedBytes)}
                  </span>
                </>
              ) : (
                <span className="tray-progress">queued</span>
              )}
            </div>

            <button
              type="button"
              className="tray-remove"
              onClick={() => onRemove(file.jobId)}
              disabled={publishing}
              aria-label="Remove"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
