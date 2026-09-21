import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getBestPartner,
  getHardestOpponents,
  getPlayerMatchHistory,
  getPlayerPerformance,
} from './domain/playerPerformance.js';
import {
  formatHistoryDiagnostics,
  formatMatchHistoryDate,
  formatMatchHistoryResult,
  formatMatchHistoryScoreline,
  formatMatchHistorySource,
  formatWinRatePercent,
} from './performancePresentation.js';
import { buildCloudPlayerPerformanceIndex } from './supabase/cloudPerformance.js';
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

const surfaceStyle = {
  backgroundColor: 'var(--bg-surface)',
  borderColor: 'var(--border-color)',
};

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border p-3" style={surfaceStyle}>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

export default function CloudProfileView({ user }) {
  const [ownPlayers, setOwnPlayers] = useState([]);
  const [claimable, setClaimable] = useState([]);
  const [mine, setMine] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [payload, setPayload] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const [ownResult, claimableResult, claimsResult] = await Promise.all([
      listLinkablePlayers(user.id),
      listClaimableCloudPlayers(),
      listMyCloudPlayerLinkClaims(),
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
  const summary =
    built?.ok && linked?.id ? getPlayerPerformance(built.index, linked.id) : null;
  const bestPartner =
    built?.ok && linked?.id ? getBestPartner(built.index, linked.id) : null;
  const hardestOpponents =
    built?.ok && linked?.id ? getHardestOpponents(built.index, linked.id).slice(0, 3) : [];
  const history =
    built?.ok && linked?.id ? getPlayerMatchHistory(built.index, linked.id) : [];
  const recentHistory = [...history].reverse();
  const diagnostics = built?.ok ? formatHistoryDiagnostics(built.index) : null;

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
              Só é possível vincular um jogador que você criou. Participar do mesmo encontro não
              comprova identidade. Jogadores de outra pessoa exigem um pedido de reivindicação.
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
                  {claim.player_name}: {claim.status}
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
          <h3 className="font-bold text-sm">Desempenho online</h3>
          {!built?.ok ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {(built?.errors ?? []).map((item) => item.message).join(' ') ||
                'Não foi possível calcular o desempenho.'}
            </p>
          ) : summary && summary.matches === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Ainda não há partidas válidas neste perfil.
            </p>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <StatCard label="Jogos" value={summary.matches} />
                <StatCard label="Vitórias" value={summary.wins} />
                <StatCard label="Derrotas" value={summary.losses} />
                <StatCard
                  label="Aproveitamento"
                  value={formatWinRatePercent(summary.winRate, summary.matches)}
                />
                <StatCard label="Pontos pró" value={summary.pointsFor} />
                <StatCard label="Pontos contra" value={summary.pointsAgainst} />
              </div>
              {bestPartner ? (
                <p className="text-sm">
                  Melhor parceiro: {bestPartner.partnerName} ({bestPartner.wins}V/{bestPartner.losses}D)
                </p>
              ) : null}
              {hardestOpponents.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    Adversários mais difíceis
                  </p>
                  <ul className="text-sm space-y-1">
                    {hardestOpponents.map((opponent) => (
                      <li key={opponent.opponentId}>
                        {opponent.opponentName} ({opponent.wins}V/{opponent.losses}D)
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Histórico recente
                </p>
                {recentHistory.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Nenhuma partida neste recorte.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {recentHistory.map((match) => (
                      <li
                        key={`${match.sourceType}:${match.sourceId}:${match.roundId}:${match.matchId}`}
                        className="rounded-lg border p-2 space-y-1"
                        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-app)' }}
                      >
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                          {formatMatchHistoryDate(match.sessionDate)}
                        </p>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                          {formatMatchHistorySource(match)}
                        </p>
                        <p className="text-sm font-bold">{formatMatchHistoryScoreline(match)}</p>
                        <p className="text-xs font-semibold">{formatMatchHistoryResult(match.result)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {diagnostics ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {diagnostics.includedLabel}; {diagnostics.pendingLabel}; {diagnostics.invalidLabel}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {status ? (
        <p className="text-xs font-semibold text-red-500">{status}</p>
      ) : null}
    </section>
  );
}
