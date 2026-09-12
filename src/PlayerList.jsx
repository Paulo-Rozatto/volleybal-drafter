import React, { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import { DELETE_PLAYER_CONFIRMATION_MESSAGE } from './players.js';

const emptyForm = () => ({
  name: '',
  score: 3,
  height: 'short',
  gender: 'F',
});

function fieldErrorsFromResult(result) {
  const byField = {};
  for (const item of result?.errors ?? []) {
    if (item?.field && item?.message && !byField[item.field]) {
      byField[item.field] = item.message;
    }
  }
  return byField;
}

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-semibold text-red-500">{message}</p>;
}

function PlayerFields({ idPrefix, form, onChange, inputStyle, fieldErrors = {} }) {
  return (
    <>
      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-name`} style={{ color: 'var(--text-main)' }}>
          Nome
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          className="mt-1 w-full border rounded-lg p-2 text-sm outline-none font-semibold"
          style={inputStyle}
          placeholder="Nome do jogador"
        />
        <FieldError message={fieldErrors.name} />
      </div>
      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-score`} style={{ color: 'var(--text-main)' }}>
          Nível
        </label>
        <select
          id={`${idPrefix}-score`}
          value={form.score}
          onChange={(event) => onChange({ ...form, score: Number(event.target.value) })}
          className="mt-1 w-full border text-sm rounded-lg px-2 py-2 outline-none font-bold"
          style={{ ...inputStyle, color: 'var(--accent)' }}
        >
          {[5, 4, 3, 2, 1].map((star) => (
            <option key={star} value={star}>
              {star} ⭐
            </option>
          ))}
        </select>
        <FieldError message={fieldErrors.score} />
      </div>
      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-height`} style={{ color: 'var(--text-main)' }}>
          Altura
        </label>
        <select
          id={`${idPrefix}-height`}
          value={form.height || 'short'}
          onChange={(event) => onChange({ ...form, height: event.target.value })}
          className="mt-1 w-full border text-sm rounded-lg px-2 py-2 outline-none font-medium"
          style={inputStyle}
        >
          <option value="tall">📏 Alto</option>
          <option value="short">📐 Baixo</option>
        </select>
        <FieldError message={fieldErrors.height} />
      </div>
      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-gender`} style={{ color: 'var(--text-main)' }}>
          Gênero
        </label>
        <select
          id={`${idPrefix}-gender`}
          value={form.gender}
          onChange={(event) => onChange({ ...form, gender: event.target.value })}
          className="mt-1 w-full border text-sm rounded-lg px-2 py-2 outline-none font-medium"
          style={inputStyle}
        >
          <option value="F">👩 Fem</option>
          <option value="M">👨 Masc</option>
        </select>
        <FieldError message={fieldErrors.gender} />
      </div>
    </>
  );
}

export default function PlayerList({
  players = [],
  variant = 'roster',
  onCreatePlayer,
  onUpdatePlayer,
  onDeletePlayer,
}) {
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createError, setCreateError] = useState(null);
  const [createFieldErrors, setCreateFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editError, setEditError] = useState(null);
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const createToggleRef = useRef(null);
  const deleteButtonRefs = useRef({});
  const deleteOpenerRef = useRef(null);

  const sortedPlayers = [...players].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  );

  const inputStyle = {
    backgroundColor: 'var(--bg-app)',
    color: 'var(--text-main)',
    borderColor: 'var(--border-color)',
  };

  const closeCreate = () => {
    setCreating(false);
    setCreateForm(emptyForm());
    setCreateError(null);
    setCreateFieldErrors({});
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm());
    setEditError(null);
    setEditFieldErrors({});
  };

  const handleCreate = (event) => {
    event.preventDefault();
    const result = onCreatePlayer?.(createForm);
    if (result?.ok === false) {
      const byField = fieldErrorsFromResult(result);
      setCreateFieldErrors(byField);
      setCreateError(
        Object.keys(byField).length > 0
          ? null
          : result.errors?.[0]?.message || 'Não foi possível criar o jogador.'
      );
      return;
    }
    closeCreate();
  };

  const handleSaveEdit = (event) => {
    event.preventDefault();
    const result = onUpdatePlayer?.(editingId, editForm);
    if (result?.ok === false) {
      const byField = fieldErrorsFromResult(result);
      setEditFieldErrors(byField);
      setEditError(
        Object.keys(byField).length > 0
          ? null
          : result.errors?.[0]?.message || 'Não foi possível salvar o jogador.'
      );
      return;
    }
    closeEdit();
  };

  if (variant === 'session') {
    if (!players || players.length === 0) {
      return (
        <div
          className="text-center py-8 rounded-xl border border-dashed text-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Nenhum jogador encontrado.
        </div>
      );
    }

    return (
      <div
        className="w-full overflow-hidden rounded-xl border shadow-sm"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
          {sortedPlayers.map((player, index) => (
            <div
              key={player.id}
              className="flex p-2.5 items-center text-sm gap-1"
              style={{ backgroundColor: index % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}
            >
              <div className="flex-1 font-semibold pl-1">{player.name}</div>
              <div className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                {player.score}⭐
              </div>
              {onDeletePlayer && (
                <button
                  type="button"
                  onClick={() => onDeletePlayer(player.id)}
                  className="text-gray-400 hover:text-red-500 font-bold p-1 transition-colors text-sm"
                  title="Remover da mesa"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!creating && (
        <button
          ref={createToggleRef}
          type="button"
          onClick={() => {
            setCreating(true);
            setCreateForm(emptyForm());
            setCreateError(null);
            setCreateFieldErrors({});
          }}
          className="px-3 py-2 rounded-xl font-bold text-sm shadow-md cursor-pointer"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          Novo jogador
        </button>
      )}

      {creating && (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-xl border space-y-3"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <PlayerFields
            idPrefix="create-player"
            form={createForm}
            onChange={(next) => {
              setCreateForm(next);
              setCreateError(null);
              setCreateFieldErrors({});
            }}
            inputStyle={inputStyle}
            fieldErrors={createFieldErrors}
          />
          {createError && <p className="text-xs font-semibold text-red-500">{createError}</p>}
          <div className="flex gap-2 text-sm">
            <button
              type="submit"
              className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Criar jogador
            </button>
            <button
              type="button"
              onClick={closeCreate}
              className="flex-1 font-bold py-3 rounded-xl border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-main)',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!players || players.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl border border-dashed text-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Nenhum jogador encontrado.
        </div>
      ) : (
        <div
          className="w-full overflow-hidden rounded-xl border shadow-sm"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <div
            className="flex text-xs font-bold uppercase tracking-wider p-3 items-center border-b"
            style={{ backgroundColor: 'var(--secondary)', color: '#ffffff', borderColor: 'var(--border-color)' }}
          >
            <div className="w-4/12 pl-1">Jogador</div>
            <div className="w-3/12 text-center">Nível</div>
            <div className="w-2/12 text-center">Altura</div>
            <div className="w-2/12 text-center">Gênero</div>
            <div className="w-1/12 text-right pr-1"></div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {sortedPlayers.map((player, index) => {
              const isEven = index % 2 === 0;
              if (editingId === player.id) {
                return (
                  <form
                    key={player.id}
                    onSubmit={handleSaveEdit}
                    className="p-3 space-y-3"
                    style={{ backgroundColor: isEven ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}
                  >
                    <PlayerFields
                      idPrefix={`edit-player-${player.id}`}
                      form={editForm}
                      onChange={(next) => {
                        setEditForm(next);
                        setEditError(null);
                        setEditFieldErrors({});
                      }}
                      inputStyle={inputStyle}
                      fieldErrors={editFieldErrors}
                    />
                    {editError && <p className="text-xs font-semibold text-red-500">{editError}</p>}
                    <div className="flex gap-2 text-sm">
                      <button
                        type="submit"
                        className="flex-1 font-bold py-2 rounded-xl shadow-md cursor-pointer"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={closeEdit}
                        className="flex-1 font-bold py-2 rounded-xl border cursor-pointer"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border-color)',
                          color: 'var(--text-main)',
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div
                  key={player.id}
                  className="flex p-2.5 items-center text-sm gap-1"
                  style={{ backgroundColor: isEven ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}
                >
                  <div className="w-4/12 pl-1 font-semibold">{player.name}</div>
                  <div className="w-3/12 text-center font-bold" style={{ color: 'var(--accent)' }}>
                    {player.score} ⭐
                  </div>
                  <div className="w-2/12 text-center text-xs">{player.height === 'tall' ? 'Alto' : 'Baixo'}</div>
                  <div className="w-2/12 text-center text-xs">{player.gender === 'F' ? 'Fem' : 'Masc'}</div>
                  <div className="w-1/12 text-right pr-1 flex flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(player.id);
                        setEditForm({
                          name: player.name,
                          score: player.score,
                          height: player.height || 'short',
                          gender: player.gender,
                        });
                        setEditError(null);
                        setEditFieldErrors({});
                      }}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                    >
                      Editar
                    </button>
                    {onDeletePlayer && (
                      <button
                        ref={(node) => {
                          deleteButtonRefs.current[player.id] = node;
                        }}
                        type="button"
                        onClick={() => {
                          deleteOpenerRef.current = deleteButtonRefs.current[player.id];
                          setPendingDelete(player);
                        }}
                        className="text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer underline"
                        style={{ color: 'var(--text-main)' }}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          titleId="delete-player-title"
          title="Excluir jogador"
          message={DELETE_PLAYER_CONFIRMATION_MESSAGE}
          confirmLabel="Excluir do elenco"
          destructive
          openerRef={deleteOpenerRef}
          onConfirm={() => {
            const result = onDeletePlayer?.(pendingDelete.id);
            if (result?.ok === false) return;
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
