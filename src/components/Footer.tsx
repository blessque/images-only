import { useEffect, useState } from 'react';
import type { Settings } from '@/lib/types';
import { useAdminHooks } from '@/lib/adminContext';
import './footer.css';

interface FooterProps {
  settings: Settings;
  onUnlock?: () => void;
}

/**
 * The only chrome on the public page. At the document end, NOT sticky — full-bleed is the
 * point, and Option+\ is the real admin entry; the lock is the discoverable one, not the
 * fast one. See docs/decisions/TUNING_LOG.md.
 *
 * In admin mode the two texts become inputs in place, rather than opening a settings
 * panel. They are the only copy on the site; a panel would be more UI than content.
 */
export function Footer({ settings, onUnlock }: FooterProps) {
  const { editSettings } = useAdminHooks();
  const [draft, setDraft] = useState(settings);
  const year = new Date().getFullYear();

  // Adopt server state whenever it changes underneath (e.g. after a manifest refresh),
  // but never while the field is being typed into — see the blur-to-save below.
  useEffect(() => setDraft(settings), [settings]);

  if (editSettings) {
    return (
      <footer className="footer is-editing">
        <span className="footer-copy">© {year}</span>
        <input
          className="footer-field"
          value={draft.name}
          placeholder="Name"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          onBlur={() => editSettings({ name: draft.name })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <input
          className="footer-field footer-field-wide"
          value={draft.contact}
          placeholder="Contact"
          onChange={(event) => setDraft((current) => ({ ...current, contact: event.target.value }))}
          onBlur={() => editSettings({ contact: draft.contact })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </footer>
    );
  }

  return (
    <footer className="footer">
      <span className="footer-copy">
        © {year} {settings.name}
      </span>

      <span className="footer-contact">{settings.contact}</span>

      <button
        type="button"
        className="footer-lock"
        onClick={onUnlock}
        aria-label="Admin"
        title="Admin"
      >
        <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true">
          <path
            d="M2.5 5.5V3.5a3 3 0 0 1 6 0v2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <rect
            x="0.5"
            y="5.5"
            width="10"
            height="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
    </footer>
  );
}
