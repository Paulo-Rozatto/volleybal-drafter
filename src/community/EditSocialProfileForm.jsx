import { useState } from 'react';
import Button from '../ui/Button.jsx';
import { formatUsername, isValidUsername, normalizeUsernameInput } from './usernames.js';
import { updateMySocialProfile, uploadMyAvatar } from './profileApi.js';

export default function EditSocialProfileForm({ profile, onSaved, onCancel }) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const normalized = normalizeUsernameInput(username);
        if (!isValidUsername(normalized)) {
          setStatus('Username: 3 a 24 caracteres, só letras minúsculas, números e _.');
          return;
        }
        setBusy(true);
        setStatus('');
        const result = await updateMySocialProfile({
          displayName: displayName.trim(),
          username: normalized,
        });
        setBusy(false);
        if (!result.ok) {
          setStatus(result.error?.message || 'Não foi possível salvar.');
          return;
        }
        onSaved?.(result.profile);
      }}
    >
      <label className="block space-y-1">
        <span className="text-caption font-semibold">Nome</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="w-full border p-2 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-caption font-semibold">Username</span>
        <input
          value={username}
          onChange={(event) => setUsername(normalizeUsernameInput(event.target.value))}
          className="w-full border p-2 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Público no PaDre: {formatUsername(username) || '@'}
        </span>
      </label>
      <label className="block space-y-1">
        <span className="text-caption font-semibold">Foto</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setStatus('');
            const uploaded = await uploadMyAvatar(file);
            setBusy(false);
            event.target.value = '';
            if (!uploaded.ok) {
              setStatus(uploaded.error?.message || 'Não foi possível enviar a foto.');
              return;
            }
            onSaved?.(uploaded.profile);
          }}
        />
        <span className="text-caption" style={{ color: 'var(--text-muted)' }}>
          JPEG, PNG ou WebP até 512 KB. Substitui a foto anterior.
        </span>
      </label>
      {status ? <p className="text-caption font-semibold text-red-500">{status}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Salvar
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        O nome do perfil é identidade social. O nome do jogador nas partidas antigas não muda.
      </p>
    </form>
  );
}
