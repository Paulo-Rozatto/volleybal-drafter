import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import ErrorState from '../ui/ErrorState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  friendDisplayName,
  listMyFriendRequests,
  listMyFriends,
  rejectFriendRequest,
  removeFriendship,
  searchUsersForFriendship,
  sendFriendRequest,
} from './friendsApi.js';
import SocialAvatar from './SocialAvatar.jsx';
import { formatUsername } from './usernames.js';

function FriendRow({ person, actions, onOpenProfile }) {
  return (
    <div className="flex items-center gap-3">
      <SocialAvatar
        name={friendDisplayName(person)}
        seed={person.userId}
        avatarPath={person.avatarPath}
      />
      <button
        type="button"
        className="flex-1 min-w-0 text-left cursor-pointer"
        onClick={() => person.playerId && onOpenProfile?.(person.playerId)}
      >
        <p className="text-small font-bold truncate">{friendDisplayName(person)}</p>
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          {formatUsername(person.username)}
        </p>
      </button>
      {actions}
    </div>
  );
}

export default function FriendsView({ onOpenPlayer }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [friendsResult, requestsResult] = await Promise.all([
      listMyFriends(),
      listMyFriendRequests(),
    ]);
    if (friendsResult.ok) setFriends(friendsResult.friends);
    else setError(friendsResult.error?.message || 'Não foi possível carregar amigos.');
    if (requestsResult.ok) {
      setIncoming(requestsResult.incoming);
      setOutgoing(requestsResult.outgoing);
    } else {
      setError(requestsResult.error?.message || 'Não foi possível carregar pedidos.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [friendsResult, requestsResult] = await Promise.all([
        listMyFriends(),
        listMyFriendRequests(),
      ]);
      if (cancelled) return;
      if (friendsResult.ok) setFriends(friendsResult.friends);
      else setError(friendsResult.error?.message || 'Não foi possível carregar amigos.');
      if (requestsResult.ok) {
        setIncoming(requestsResult.incoming);
        setOutgoing(requestsResult.outgoing);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    const result = await searchUsersForFriendship(query);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error?.message || 'Não foi possível buscar.');
      return;
    }
    setResults(result.users);
    if (result.users.length === 0) setStatus('Nenhum usuário encontrado.');
  }

  async function run(action) {
    setBusy(true);
    setStatus('');
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error?.message || 'Não foi possível concluir.');
      return;
    }
    setResults([]);
    await refresh();
  }

  if (loading) return <LoadingState label="Carregando amigos..." />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={runSearch}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por @username ou nome"
          className="flex-1 border p-2 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <Button type="submit" disabled={busy}>
          Buscar
        </Button>
      </form>
      {status ? (
        <p className="text-caption font-semibold" style={{ color: 'var(--text-muted)' }}>
          {status}
        </p>
      ) : null}

      {results.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-h3">Resultados</h3>
          {results.map((person) => (
            <FriendRow
              key={person.userId}
              person={person}
              onOpenProfile={onOpenPlayer}
              actions={
                person.friendshipState === 'none' ? (
                  <Button disabled={busy} onClick={() => run(() => sendFriendRequest(person.userId))}>
                    Pedir amizade
                  </Button>
                ) : (
                  <span className="text-caption font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {person.friendshipState === 'friends'
                      ? 'Amigos'
                      : person.friendshipState === 'outgoing_pending'
                        ? 'Pedido enviado'
                        : 'Pedido recebido'}
                  </span>
                )
              }
            />
          ))}
        </section>
      ) : null}

      {incoming.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-h3">Pedidos recebidos</h3>
          {incoming.map((person) => (
            <FriendRow
              key={person.requestId || person.userId}
              person={person}
              onOpenProfile={onOpenPlayer}
              actions={
                <span className="flex gap-2">
                  <Button disabled={busy} onClick={() => run(() => acceptFriendRequest(person.requestId))}>
                    Aceitar
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => rejectFriendRequest(person.requestId))}
                  >
                    Recusar
                  </Button>
                </span>
              }
            />
          ))}
        </section>
      ) : null}

      {outgoing.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-h3">Pedidos enviados</h3>
          {outgoing.map((person) => (
            <FriendRow
              key={person.requestId || person.userId}
              person={person}
              onOpenProfile={onOpenPlayer}
              actions={
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => cancelFriendRequest(person.requestId))}
                >
                  Cancelar
                </Button>
              }
            />
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-h3">Amigos</h3>
        {friends.length === 0 ? (
          <EmptyState
            title="Nenhum amigo ainda"
            description="Busque pelo @username para enviar um pedido. Amizade não abre encontros nem grupos automaticamente."
          />
        ) : (
          friends.map((person) => (
            <FriendRow
              key={person.userId}
              person={person}
              onOpenProfile={onOpenPlayer}
              actions={
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => removeFriendship(person.userId))}
                >
                  Remover
                </Button>
              }
            />
          ))
        )}
      </section>
    </div>
  );
}
