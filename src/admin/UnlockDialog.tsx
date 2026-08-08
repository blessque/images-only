import { useEffect, useRef, useState } from 'react';
import { login } from './api';

interface UnlockDialogProps {
  onUnlocked: (token: string) => void;
  onCancel: () => void;
}

export function UnlockDialog({ onUnlocked, onCancel }: UnlockDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;

    setBusy(true);
    setError(null);
    // The check happens on the Worker. Nothing here compares anything — a password or
    // its hash in the bundle is readable by anyone. See docs/architecture/ADMIN_AUTH.md.
    const result = await login(password);
    setBusy(false);

    if (result.token) {
      setPassword('');
      onUnlocked(result.token);
    } else {
      setError(result.error);
      setPassword('');
      inputRef.current?.focus();
    }
  }

  return (
    <div className="unlock-backdrop" onMouseDown={onCancel}>
      <form
        className="unlock"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label="Admin"
      >
        <input
          ref={inputRef}
          type="password"
          className="unlock-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          disabled={busy}
          aria-invalid={error !== null}
        />
        <button type="submit" className="unlock-submit" disabled={busy || password.length === 0}>
          {busy ? '…' : 'Unlock'}
        </button>
        {error ? (
          <p className="unlock-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
