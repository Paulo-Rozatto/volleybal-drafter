import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCloudPlayerPerformanceIndex } from './supabase/cloudPerformance.js';
import EditSocialProfileForm from './community/EditSocialProfileForm.jsx';
import PlayerSocialStats from './community/PlayerSocialStats.jsx';
import SocialAvatar from './community/SocialAvatar.jsx';
import { getMySocialProfile } from './community/profileApi.js';
import { formatUsername } from './community/usernames.js';
import { isCommunityBetaEnabled } from './community/flags.js';
import {
  approveCloudPlayerLinkClaim,
  createAndLinkCloudPlayer,
  getMyCloudPerformanceMatches,
  linkCloudPlayer,
  listClaimableCloudPlayers,
  listLinkablePlayers,
  listMyCloudPlayerLinkClaims,
  rejectCloudPlayerLinkClaim,
  requestCloudPlayerLinkClaim,
} from './supabase/sessionApi.js';
import { translateClaimStatus } from './ui/labels.js';

const surfaceStyle = {
  backgroundColor: 'var(--bg-surface)',
  borderColor: 'var(--border-color)',
};

export default function CloudProfileView({ user }) {
  const [ownPlayers, setOwnPlayers] = useState([]);
  const [claimable, setClaimable] = useState([]);
  const [mine, setMine] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [payload, setPayload] = useState(null);
  const [social, setSocial] = useState(null);
  const [editing, setEditing] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const [ownResult, claimableResult, claimsResult, socialResult] = await Promise.all([
      listLinkablePlayers(user.id),
      listClaimableCloudPlayers(),
      listMyCloudPlayerLinkClaims(),
      isCommunityBetaEnabled() ? getMySocialProfile() : Promise.resolve({ ok: false }),
    ]);

    if (ownResult.ok) setOwnPlayers(ownResult.players);
    else setStatus(ownResult.error?.message || 'Não foi possível carregar seus jogadores.');

    if (claimableResult.ok) setClaimable(claimableResult.players);
    else setStatus(claimableResult.error?.message || 'Não foi possível carregar jogadores reivindicáveis.');

    if (claimsResult.ok) {
      setMine(claimsResult.mine);
      setInbox(claimsResult.inbox);
    } else {
      setStatus(claimsResult.error?.message || 'Não foi possível carregar os pedidos de vínculo.');
    }

    if (socialResult.ok) setSocial(socialResult.profile);

    const performance = await getMyCloudPerformanceMatches();
    if (performance.ok) setPayload(performance.payload);
    else if (performance.error?.code === 'PLAYER_NOT_LINKED') setPayload(null);
    else {
      setPayload(null);
      setStatus(performance.error?.message || 'Não foi possível carregar o desempenho.');
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const linked =
    payload?.player ??
    ownPlayers.find((player) => player.linked_user_id === user.id) ??
    null;
  const cloudIndex = useMemo(
    () => (payload ? buildCloudPlayerPerformanceIndex(payload) : null),
    [payload]
  );
  const built = cloudIndex?.built ?? null;

  async function run(action) {
    setBusy(true);
    setStatus('');
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error?.message || 'Não foi possível concluir a operação.');
      return;
    }
    await refresh();
  }

  const pendingInbox = inbox.filter((claim) => claim.status === 'pending');

  return (
    <section className="space-y-3">
      {social ? (
        <section className="p-4 rounded-xl border space-y-3" style={surfaceStyle}>
          <div className="flex items-center gap-3">
            <SocialAvatar
              name={social.displayName || linked?.name || 'Você'}
              seed={social.userId}
              avatarPath={social.avatarPath}
              size={64}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg truncate">{social.displayName || linked?.name || 'Seu perfil'}</h3>
              <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                {formatUsername(social.username)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing((open) => !open)}
              className="text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            >
              Editar perfil
            </button>
          </div>
          {editing ? (
            <EditSocialProfileForm
              profile={social}
              onSaved={(next) => {
                setSocial(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : null}
        </section>
      ) : null}

      <section
        className="p-4 rounded-xl border space-y-3"
        style={surfaceStyle}
      >
        <h3 className="font-bold text-sm">Seu jogador</h3>
        {linked ? (
          <p className="text-sm">Conta vinculada a {linked.name}.</p>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Vincule um jogador para ver estatísticas, parceiros e histórico. Só é possível
              vincular um jogador que você criou.
            </p>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                await run(() => createAndLinkCloudPlayer(playerName));
              }}
            >
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                placeholder="Nome do jogador"
                className="flex-1 border p-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)',
                  borderColor: 'var(--border-color)',
                }}
              />
              <button
                type="submit"
                disabled={busy}
                className="text-xs font-bold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
              >
                Criar e vincular
              </button>
            </form>
          </>
        )}
        <ul className="space-y-2">
          {ownPlayers.map((player) => (
            <li key={player.id} className="flex items-center justify-between gap-2">
              <span className="text-sm">{player.name}</span>
              {player.linked_user_id === user.id ? (
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Vinculado
                </span>
              ) : player.linked_user_id ? (
                <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Outra conta
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy || Boolean(linked)}
                  onClick={() => run(() => linkCloudPlayer(player.id))}
                  className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                >
                  Vincular a mim
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!linked ? (
        <section className="p-4 rounded-xl border space-y-3" style={surfaceStyle}>
          <h3 className="font-bold text-sm">Reivindicar jogador</h3>
          {claimable.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nenhum jogador visível de encontro compartilhado para reivindicar.
            </p>
          ) : (
            <ul className="space-y-2">
              {claimable.map((player) => (
                <li key={player.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{player.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => requestCloudPlayerLinkClaim(player.id))}
                    className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                  >
                    Pedir vínculo
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mine.length > 0 ? (
            <ul className="space-y-1">
              {mine.map((claim) => (
                <li key={claim.id} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {claim.player_name}: {translateClaimStatus(claim.status)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {pendingInbox.length > 0 ? (
        <section className="p-4 rounded-xl border space-y-3" style={surfaceStyle}>
          <h3 className="font-bold text-sm">Pedidos recebidos</h3>
          <ul className="space-y-2">
            {pendingInbox.map((claim) => (
              <li key={claim.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {claim.claimant_display_name || 'Jogador'} pediu {claim.player_name}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => approveCloudPlayerLinkClaim(claim.id))}
                    className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => rejectCloudPlayerLinkClaim(claim.id))}
                    className="text-xs font-bold px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    Recusar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {linked ? (
        <section className="p-4 rounded-xl border space-y-3" style={surfaceStyle}>
          <h3 className="font-bold text-sm">Desempenho</h3>
          {!built?.ok ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {(built?.errors ?? []).map((item) => item.message).join(' ') ||
                'Não foi possível calcular o desempenho.'}
            </p>
          ) : (
            <PlayerSocialStats
              index={built.index}
              playerId={linked.id}
              contextLabel="Geral"
            />
          )}
        </section>
      ) : null}

      {status ? (
        <p className="text-xs font-semibold text-red-500">{status}</p>
      ) : null}
    </section>
  );
}
