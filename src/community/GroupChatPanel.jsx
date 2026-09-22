import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import ErrorState from '../ui/ErrorState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import Button from '../ui/Button.jsx';
import {
  deleteGroupMessage,
  editGroupMessage,
  listGroupMessages,
  sendGroupMessage,
} from './chatApi.js';
import useGroupChatRealtime from './chatRealtime.js';
import { mergeGroupMessage } from './mappers.js';
import SocialAvatar from './SocialAvatar.jsx';
import { formatUsername } from './usernames.js';

function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function profilesFromGroup(group) {
  const map = {};
  for (const member of group?.members ?? []) {
    map[member.userId] = {
      displayName: member.displayName,
      username: member.username,
      avatarPath: member.avatarPath,
    };
  }
  return map;
}

export default function GroupChatPanel({ group, user }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );
  const scrollerRef = useRef(null);
  const profilesByUserId = profilesFromGroup(group);

  const refresh = useCallback(async () => {
    if (!group?.id) return;
    const result = await listGroupMessages(group.id, { profilesByUserId: profilesFromGroup(group) });
    if (result.ok) setMessages(result.messages);
    else setError(result.error?.message || 'Não foi possível carregar o chat.');
    setLoading(false);
  }, [group]);

  useEffect(() => {
    if (!group?.id) return undefined;
    let cancelled = false;
    (async () => {
      const result = await listGroupMessages(group.id, { profilesByUserId: profilesFromGroup(group) });
      if (cancelled) return;
      if (result.ok) setMessages(result.messages);
      else setError(result.error?.message || 'Não foi possível carregar o chat.');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [group]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    globalThis.addEventListener?.('online', on);
    globalThis.addEventListener?.('offline', off);
    return () => {
      globalThis.removeEventListener?.('online', on);
      globalThis.removeEventListener?.('offline', off);
    };
  }, []);

  useGroupChatRealtime(group?.id, setMessages, profilesByUserId);

  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  async function handleSend(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy || offline) return;
    setBusy(true);
    setError(null);
    const sent = await sendGroupMessage(group.id, text);
    setBusy(false);
    if (!sent.ok) {
      setError(sent.error?.message || 'Não foi possível enviar.');
      return;
    }
    const profile = profilesByUserId[user.id] ?? {
      displayName: user.email,
      username: '',
      avatarPath: null,
    };
    setMessages((current) =>
      mergeGroupMessage(current, {
        ...sent.message,
        senderName: profile.displayName || 'Você',
        senderUsername: profile.username,
        senderAvatarPath: profile.avatarPath,
      })
    );
    setBody('');
  }

  async function handleEdit(message) {
    const next = globalThis.prompt?.('Editar mensagem', message.body);
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed) return;
    setEditingId(message.id);
    const edited = await editGroupMessage(message.id, trimmed);
    setEditingId(null);
    if (!edited.ok) {
      setError(edited.error?.message || 'Não foi possível editar.');
      return;
    }
    setMessages((current) => mergeGroupMessage(current, { ...message, ...edited.message }));
  }

  async function handleDelete(message) {
    setEditingId(message.id);
    const deleted = await deleteGroupMessage(message.id);
    setEditingId(null);
    if (!deleted.ok) {
      setError(deleted.error?.message || 'Não foi possível remover.');
      return;
    }
    setMessages((current) => mergeGroupMessage(current, { ...message, ...deleted.message, deleted: true, body: '' }));
  }

  if (loading) return <LoadingState label="Carregando chat..." />;
  if (error && messages.length === 0) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  return (
    <section className="space-y-3">
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Combine horário, local e jogos. Mensagens só para quem participa deste grupo.
      </p>
      {offline ? (
        <p className="text-caption font-semibold" style={{ color: 'var(--warning)' }}>
          Sem conexão. O chat precisa da internet e não guarda mensagens para enviar depois.
        </p>
      ) : null}
      {error ? <p className="text-caption font-semibold text-red-500">{error}</p> : null}
      <div
        ref={scrollerRef}
        className="rounded-2xl border p-3 space-y-3 max-h-[28rem] overflow-y-auto"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        {messages.length === 0 ? (
          <EmptyState
            title="Nenhuma mensagem ainda"
            description="Escreva para combinar o próximo jogo."
          />
        ) : (
          messages.map((message) => {
            const mine = message.senderUserId === user.id;
            return (
              <article key={message.id} className="flex gap-2 items-start">
                <SocialAvatar
                  name={message.senderName}
                  seed={message.senderUserId}
                  avatarPath={message.senderAvatarPath}
                  size={32}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-caption font-semibold">
                    {message.senderName}
                    {message.senderUsername ? ` ${formatUsername(message.senderUsername)}` : ''}
                    <span className="font-medium" style={{ color: 'var(--text-muted)' }}>
                      {' · '}
                      {formatStamp(message.createdAt)}
                      {message.editedAt && !message.deleted ? ' · editada' : ''}
                    </span>
                  </p>
                  {message.deleted ? (
                    <p className="text-small italic" style={{ color: 'var(--text-muted)' }}>
                      Mensagem removida
                    </p>
                  ) : (
                    <p className="text-small whitespace-pre-wrap break-words">{message.body}</p>
                  )}
                  {mine && !message.deleted ? (
                    <p className="flex gap-2">
                      <button
                        type="button"
                        disabled={editingId === message.id}
                        onClick={() => handleEdit(message)}
                        className="text-caption font-bold cursor-pointer"
                        style={{ color: 'var(--primary)' }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={editingId === message.id}
                        onClick={() => handleDelete(message)}
                        className="text-caption font-bold cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                      >
                        Apagar
                      </button>
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
      <form className="flex gap-2" onSubmit={handleSend}>
        <input
          value={body}
          maxLength={500}
          disabled={offline || busy}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Escreva uma mensagem"
          className="flex-1 border p-2 rounded-xl text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
        <Button type="submit" disabled={offline || busy || !body.trim()}>
          Enviar
        </Button>
      </form>
    </section>
  );
}
