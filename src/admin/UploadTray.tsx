import { useState } from 'react';
import { SIZE_CLASSES, type SizeClass } from '@/lib/types';
import { formatBytes, type StagedFile } from './staging';

interface UploadTrayProps {
  staged: StagedFile[];
  publishing: boolean;
  onChange: (jobId: string, patch: Partial<StagedFile>) => void;
  /** Re-encodes that one file — the checkbox appears after the first pass has already run. */
  onHighFidelity: (jobId: string, value: boolean) => void;
  /** The tray's order becomes the gallery's order, so arranging here saves shuffling later. */
  onMove: (jobId: string, direction: -1 | 1) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (jobId: string) => void;
  onPublish: () => void;
  onCancel: () => void;
}

function savedPercent(file: StagedFile): number {
  if (file.sourceBytes === 0 || file.compressedBytes === 0) return 0;
  return Math.round((1 - file.compressedBytes / file.sourceBytes) * 100);
}

export function UploadTray({
  staged,
  publishing,
  onChange,
  onHighFidelity,
  onMove,
  onReorder,
  onRemove,
  onPublish,
  onCancel,
}: UploadTrayProps) {
  const ready = staged.filter((file) => file.status === 'ready').length;
  const failed = staged.filter((file) => file.status === 'error').length;

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
                  The escape hatch, per image — never a global toggle. A non-technical user
                  offered a global "skip compression" switch turns it off "to be safe" and
                  ships a 200MB page. See docs/decisions/TUNING_LOG.md.
                */}
                <label className="tray-fidelity" title="Re-encodes this image at a larger byte budget">
                  <input
                    type="checkbox"
                    checked={file.highFidelity}
                    onChange={(event) => onHighFidelity(file.jobId, event.target.checked)}
                    disabled={publishing || file.status === 'compressing'}
                  />
                  High fidelity
                </label>
              </div>
            </div>

            {/* Honest numbers, so he can trust his own eyes rather than a switch. */}
            <div className="tray-size">
              {file.status === 'compressing' ? (
                <span className="tray-progress">
                  {file.highFidelity ? 're-encoding ' : ''}
                  {file.rung ? `${file.rung}px…` : 'reading…'}
                </span>
              ) : file.status === 'error' ? (
                <span className="tray-error">{file.error}</span>
              ) : file.compressedBytes > 0 ? (
                <>
                  <span className="tray-before">{formatBytes(file.sourceBytes)}</span>
                  <span className="tray-arrow">→</span>
                  <span className="tray-after">{formatBytes(file.compressedBytes)}</span>
                  <span className="tray-saved">−{savedPercent(file)}%</span>
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
