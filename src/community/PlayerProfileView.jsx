import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildSocialPlayerPerformanceIndex } from './socialMatches.js';
import ErrorState from '../ui/ErrorState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import { getSocialPlayerProfile } from './profileApi.js';
import PlayerSocialStats from './PlayerSocialStats.jsx';
import SocialAvatar from './SocialAvatar.jsx';
import { formatUsername } from './usernames.js';

export function PlayerProfilePanel({ loading, error, payload, lineupSize, onBack, onRetry, onChangeLineupSize }) {
  const cloudIndex = useMemo(
    () => (payload?.matches ? buildSocialPlayerPerformanceIndex(payload) : null),
    [payload]
  );
  const profile = payload?.profile;
  const playerId = payload?.player?.id ?? profile?.playerId;

  if (loading) return <LoadingState label="Carregando perfil..." />;
  if (error || !profile) {
    return <ErrorState message={error || 'Perfil não encontrado.'} onBack={onBack} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-bold cursor-pointer"
          style={{ color: 'var(--primary)' }}
        >
          ← Voltar
        </button>
      ) : null}
      <header className="flex items-center gap-3">
        <SocialAvatar
          name={profile.displayName || profile.playerName}
          seed={profile.userId}
          avatarPath={profile.avatarPath}
          size={64}
        />
        <div className="min-w-0">
          <h2 className="text-h1 truncate">{profile.displayName || profile.playerName}</h2>
          <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
            {formatUsername(profile.username)} · Geral
          </p>
        </div>
      </header>
      {cloudIndex?.built?.ok && playerId ? (
        <PlayerSocialStats
          index={cloudIndex.built.index}
          playerId={playerId}
          lineupSize={lineupSize}
          onChangeLineupSize={onChangeLineupSize}
          contextLabel="Geral"
        />
      ) : (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          Ainda não há partidas válidas neste perfil.
        </p>
      )}
    </div>
  );
}

export default function PlayerProfileView({ playerId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [lineupSize, setLineupSize] = useState(null);

  const refresh = useCallback(async () => {
    if (!playerId) return;
    const result = await getSocialPlayerProfile(playerId);
    if (result.ok) {
      setPayload(result.payload);
      setError(null);
    } else {
      setPayload(null);
      setError(result.error?.message || 'Não foi possível abrir o perfil.');
    }
    setLoading(false);
  }, [playerId]);

  useEffect(() => {
    if (!playerId) return undefined;
    let cancelled = false;
    (async () => {
      const result = await getSocialPlayerProfile(playerId);
      if (cancelled) return;
      if (result.ok) setPayload(result.payload);
      else {
        setPayload(null);
        setError(result.error?.message || 'Não foi possível abrir o perfil.');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return (
    <PlayerProfilePanel
      loading={loading}
      error={error}
      payload={payload}
      lineupSize={lineupSize}
      onBack={onBack}
      onRetry={refresh}
      onChangeLineupSize={setLineupSize}
    />
  );
}
