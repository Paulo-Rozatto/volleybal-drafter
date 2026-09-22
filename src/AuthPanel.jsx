import React, { useState } from 'react';
import { signInWithMagicLink, signOut } from './supabase/auth.js';
import { rememberPendingCompetitionJoinCode, rememberPendingGroupJoinCode, rememberPendingJoinCode } from './supabase/joinCode.js';

export default function AuthPanel({
  configured,
  ready,
  user,
  pendingJoinCode,
  pendingGroupJoinCode,
  pendingCompetitionJoinCode,
  onSignedOut,
  onOpenMigration,
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <div
        className="p-4 rounded-xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Conta (Supabase)</h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para entrar e usar encontros,
          competições e grupos.
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Verificando sessão...
      </p>
    );
  }

  if (user) {
    return (
      <div
        className="p-4 rounded-xl border space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h3 className="font-bold text-sm">Conta</h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {user.email}
        </p>
        {onOpenMigration ? (
          <button
            type="button"
            onClick={onOpenMigration}
            className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
          >
            Importar dados antigos
          </button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            await signOut();
            setBusy(false);
            onSignedOut?.();
          }}
          disabled={busy}
          className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
        >
          Sair
        </button>
      </div>
    );
  }

  return (
    <form
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setStatus('');
        if (pendingJoinCode) rememberPendingJoinCode(pendingJoinCode);
        if (pendingGroupJoinCode) rememberPendingGroupJoinCode(pendingGroupJoinCode);
        if (pendingCompetitionJoinCode) rememberPendingCompetitionJoinCode(pendingCompetitionJoinCode);
        const result = await signInWithMagicLink(email, {
          joinCode: pendingGroupJoinCode || pendingCompetitionJoinCode ? undefined : pendingJoinCode,
          groupJoinCode: pendingGroupJoinCode,
          competitionJoinCode: pendingCompetitionJoinCode,
        });
        setBusy(false);
        setStatus(
          result.ok
            ? 'Enviamos um link de acesso para o seu e-mail.'
            : result.error?.message || 'Não foi possível enviar o link.'
        );
      }}
    >
      <h3 className="font-bold text-sm">Entrar</h3>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        A conta é necessária para encontros, competições, grupos e perfil. O sorteio rápido
        continua só neste aparelho.
      </p>
      {pendingJoinCode ? (
        <p className="text-sm font-semibold">
          Depois do login você entra no encontro {pendingJoinCode}.
        </p>
      ) : null}
      {pendingGroupJoinCode ? (
        <p className="text-sm font-semibold">
          Depois do login você entra no grupo {pendingGroupJoinCode}.
        </p>
      ) : null}
      {pendingCompetitionJoinCode ? (
        <p className="text-sm font-semibold">
          Depois do login você entra na competição {pendingCompetitionJoinCode}.
        </p>
      ) : null}
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="karen.d@example.net"
        className="w-full border p-2 rounded text-sm outline-none"
        style={{
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-main)',
          borderColor: 'var(--border-color)',
        }}
      />
      <button
        type="submit"
        disabled={busy}
        className="w-full font-bold py-2 rounded-lg text-sm cursor-pointer disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
      >
        {busy ? 'Enviando...' : 'Receber link de acesso'}
      </button>
      {status ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}
    </form>
  );
}
