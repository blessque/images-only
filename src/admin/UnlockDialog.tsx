import { useEffect, useRef, useState } from 'react';
import { checkSetup, claimSite, login, type SetupState } from './api';

interface UnlockDialogProps {
  onUnlocked: (token: string) => void;
  onCancel: () => void;
}

/**
 * One dialog, two jobs: log in, or claim a site that has no owner yet.
 *
 * The claim path exists because the owner is not technical. Setting the password used to
 * mean generating a PBKDF2 hash and getting it past a shell into `wrangler secret put`,
 * which is not a thing he can do — so a fresh deployment now ships unclaimed and asks here.
 * See docs/architecture/ADMIN_AUTH.md.
 */
export function UnlockDialog({ onUnlocked, onCancel }: UnlockDialogProps) {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
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

  useEffect(() => {
    let live = true;
    void checkSetup().then((state) => {
      if (live) setSetup(state);
    });
    return () => {
      live = false;
    };
  }, []);

  const claiming = setup !== null && !setup.claimed;
  const minimum = setup?.minPasswordLength ?? 12;

  // Deliberately permissive while `setup` is still loading: the ordinary login path must
  // not wait on a network round trip it does not need.
  const ready = claiming
    ? password.length >= minimum && confirm.length > 0 && (!setup?.codeRequired || code.length > 0)
    : password.length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;

    if (claiming && password !== confirm) {
      setError('The two passwords do not match.');
      setConfirm('');
      return;
    }

    setBusy(true);
    setError(null);
    // Whichever path, the check happens on the Worker. Nothing here compares anything — a
    // password or its hash in the bundle is readable by anyone who opens devtools.
    const result = claiming ? await claimSite(password, code) : await login(password);
    setBusy(false);

    if (result.token) {
      setPassword('');
      setConfirm('');
      setCode('');
      onUnlocked(result.token);
      return;
    }

    setError(result.error);
    setPassword('');
    setConfirm('');
    inputRef.current?.focus();
  }

  return (
    <div className="unlock-backdrop" onMouseDown={onCancel}>
      <form
        className="unlock"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={claiming ? 'Set up' : 'Admin'}
      >
        {claiming ? (
          <p className="unlock-note">
            Choose a password for this site. At least {minimum} characters. Write it down —
            there is no way to recover it, only to replace it.
          </p>
        ) : null}

        {claiming && setup?.codeRequired ? (
          <input
            className="unlock-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Setup code"
            autoComplete="off"
            disabled={busy}
          />
        ) : null}

        <input
          ref={inputRef}
          type="password"
          className="unlock-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete={claiming ? 'new-password' : 'current-password'}
          disabled={busy}
          aria-invalid={error !== null}
        />

        {claiming ? (
          <input
            type="password"
            className="unlock-input"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Repeat password"
            autoComplete="new-password"
            disabled={busy}
          />
        ) : null}

        <button type="submit" className="unlock-submit" disabled={busy || !ready}>
          {busy ? '…' : claiming ? 'Set password' : 'Unlock'}
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
