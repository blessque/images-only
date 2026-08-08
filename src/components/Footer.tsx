import type { Settings } from '@/lib/types';
import './footer.css';

interface FooterProps {
  settings: Settings;
  /** Wired to the admin unlock in Phase 4. */
  onUnlock?: () => void;
}

/**
 * The only chrome on the public page. At the document end, NOT sticky — full-bleed is the
 * point, and Option+\ is the real admin entry; the lock is the discoverable one, not the
 * fast one. See docs/decisions/TUNING_LOG.md.
 */
export function Footer({ settings, onUnlock }: FooterProps) {
  const year = new Date().getFullYear();

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
          <rect x="0.5" y="5.5" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </footer>
  );
}
