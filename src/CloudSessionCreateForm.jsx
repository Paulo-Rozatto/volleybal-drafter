import { useState } from 'react';
import { localDateString } from './teamGameSessions.js';
import { createdCloudSessionId } from './cloudSessionPanel.js';
import { createCloudSession } from './supabase/sessionApi.js';

export default function CloudSessionCreateForm({
  user,
  groupId = null,
  heading = 'Novo encontro',
  onCreated,
}) {
  const [form, setForm] = useState(() => ({
    date: localDateString(),
    name: '',
    teamSize: 2,
    teamCount: 2,
  }));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setStatus('');
        try {
          const created = await createCloudSession({
            ...form,
            createdBy: user.id,
            groupId: groupId || null,
          });
          if (!created.ok) {
            setStatus(created.error?.message || 'Não foi possível criar o encontro.');
            return;
          }
          const sessionId = createdCloudSessionId(created);
          if (!sessionId) {
            setStatus('O encontro foi criado, mas o identificador não voltou no resultado.');
            return;
          }
          onCreated?.(sessionId);
        } catch (error) {
          setStatus(error?.message || 'Não foi possível criar o encontro.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="font-bold text-sm">{heading}</h3>
      <input
        type="date"
        value={form.date}
        onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
        className="w-full border p-2 rounded text-sm outline-none"
        style={{
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-main)',
          borderColor: 'var(--border-color)',
        }}
      />
      <input
        value={form.name}
        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        placeholder="Nome (opcional)"
        className="w-full border p-2 rounded text-sm outline-none"
        style={{
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-main)',
          borderColor: 'var(--border-color)',
        }}
      />
      <div className="flex gap-2">
        <select
          value={form.teamSize}
          onChange={(event) =>
            setForm((current) => ({ ...current, teamSize: Number(event.target.value) }))
          }
          className="flex-1 border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        >
          {[2, 3, 4, 5, 6].map((size) => (
            <option key={size} value={size}>
              {size}x{size}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="2"
          value={form.teamCount}
          onChange={(event) =>
            setForm((current) => ({ ...current, teamCount: Number(event.target.value) }))
          }
          className="w-24 border p-2 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full font-bold py-3 rounded-xl cursor-pointer disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        Criar encontro
      </button>
      {status ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}
    </form>
  );
}
