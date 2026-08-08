import { SIZE_CLASSES, type SizeClass } from '@/lib/types';
import { formatBytes, type StagedFile } from './staging';

interface UploadTrayProps {
  staged: StagedFile[];
  publishing: boolean;
  onChange: (jobId: string, patch: Partial<StagedFile>) => void;
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
  onRemove,
  onPublish,
  onCancel,
}: UploadTrayProps) {
  const ready = staged.filter((file) => file.status === 'ready').length;
  const failed = staged.filter((file) => file.status === 'error').length;

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
        {staged.map((file) => (
          <li key={file.jobId} className={`tray-item is-${file.status}`}>
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
                <label className="tray-fidelity">
                  <input
                    type="checkbox"
                    checked={file.highFidelity}
                    onChange={(event) =>
                      onChange(file.jobId, { highFidelity: event.target.checked })
                    }
                    disabled={publishing}
                  />
                  High fidelity
                </label>
              </div>
            </div>

            {/* Honest numbers, so he can trust his own eyes rather than a switch. */}
            <div className="tray-size">
              {file.status === 'compressing' ? (
                <span className="tray-progress">{file.rung ? `${file.rung}px…` : 'reading…'}</span>
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
