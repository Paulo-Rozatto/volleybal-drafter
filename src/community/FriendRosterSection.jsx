import { useEffect, useState } from 'react';
import Button from '../ui/Button.jsx';
import { friendDisplayName, listMyFriends } from './friendsApi.js';
import { isCommunityBetaEnabled } from './flags.js';
import SocialAvatar from './SocialAvatar.jsx';
import { formatUsername } from './usernames.js';

export default function FriendRosterSection({
  roster = [],
  onAddFriend,
  disabled = false,
}) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isCommunityBetaEnabled()) return undefined;
    let cancelled = false;
    (async () => {
      const result = await listMyFriends();
      if (cancelled) return;
      if (result.ok) setFriends(result.friends);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isCommunityBetaEnabled()) return null;

  const rosterIds = new Set(roster.map((player) => player.playerId));
  const rosterLinked = new Set(
    roster.map((player) => player.linkedUserId).filter(Boolean)
  );
  const available = friends.filter((friend) => {
    if (friend.playerId && rosterIds.has(friend.playerId)) return false;
    if (friend.userId && rosterLinked.has(friend.userId)) return false;
    return true;
  });

  return (
    <div className="space-y-2 pt-2">
      <h4 className="text-caption font-bold" style={{ color: 'var(--text-muted)' }}>
        Amigos
      </h4>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Adicionar ao elenco não dá acesso ao encontro. Convide à parte se quiser colaboração.
      </p>
      {loading ? (
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Carregando amigos...
        </p>
      ) : null}
      {!loading && available.length === 0 ? (
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Nenhum amigo disponível para incluir.
        </p>
      ) : null}
      {available.map((friend) => (
        <div key={friend.userId} className="flex items-center gap-2">
          <SocialAvatar
            name={friendDisplayName(friend)}
            seed={friend.userId}
            avatarPath={friend.avatarPath}
            size={28}
          />
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold truncate">{friendDisplayName(friend)}</p>
            <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
              {formatUsername(friend.username)}
              {friend.playerId ? '' : ' · sem jogador vinculado'}
            </p>
          </div>
          <Button
            disabled={disabled || !friend.playerId}
            onClick={() => onAddFriend?.(friend)}
          >
            Adicionar ao encontro
          </Button>
        </div>
      ))}
    </div>
  );
}
