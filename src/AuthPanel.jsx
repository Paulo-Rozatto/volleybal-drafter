import React, { useState } from 'react';
import { signInWithMagicLink } from './supabase/auth.js';
import { rememberPendingCompetitionJoinCode, rememberPendingGroupJoinCode, rememberPendingJoinCode } from './supabase/joinCode.js';
import BrandLogo from './ui/BrandLogo.jsx';
import Button from './ui/Button.jsx';
import { BRAND_PITCH, BRAND_TAGLINE } from './ui/brand.js';

export default function AuthPanel({
  configured,
  ready,
  user,
  pendingJoinCode,
  pendingGroupJoinCode,
  pendingCompetitionJoinCode,
  variant = 'landing',
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const landing = variant === 'landing';

  if (user) return null;

  if (!configured) {
    return (
      <section
        className="p-5 rounded-2xl border space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <h2 className="text-h2">Entrar</h2>
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          O acesso por e-mail ainda não está configurado neste ambiente.
        </p>
      </section>
    );
  }

  if (!ready) {
    return (
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        Verificando sessão...
      </p>
    );
  }

  return (
    <form
      className="p-5 rounded-2xl border space-y-4"
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
      {landing ? (
        <div className="space-y-2 text-center">
          <BrandLogo size="lg" className="justify-center text-[var(--primary)]" />
          <p className="text-h3">{BRAND_TAGLINE}</p>
          <p className="text-small" style={{ color: 'var(--text-muted)' }}>
            {BRAND_PITCH}
          </p>
        </div>
      ) : (
        <h2 className="text-h2">Entrar</h2>
      )}
      {pendingJoinCode ? (
        <p className="text-small font-semibold">Depois do login você entra no encontro convidado.</p>
      ) : null}
      {pendingGroupJoinCode ? (
        <p className="text-small font-semibold">Depois do login você entra no grupo convidado.</p>
      ) : null}
      {pendingCompetitionJoinCode ? (
        <p className="text-small font-semibold">Depois do login você entra na competição convidada.</p>
      ) : null}
      <div className="space-y-2">
        <label htmlFor="padre-email" className="text-small font-semibold">
          E-mail
        </label>
        <input
          id="padre-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@email.com"
          className="w-full min-h-11 border px-3 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Enviando...' : 'Entrar'}
      </Button>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Enviaremos um link de acesso para seu e-mail.
      </p>
      {status ? (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}
    </form>
  );
}
