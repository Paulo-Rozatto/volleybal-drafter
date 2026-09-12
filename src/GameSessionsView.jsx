import React, { useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';
import GameSessionDetail from './GameSessionDetail.jsx';
import { validateDate } from './domain/sessionValidation.js';
import { parseSessionFormatInput } from './teamFormationUi.js';
import {
  SESSION_FORMAT_OPTIONS,
  formatTeamCountPhrase,
  resolveTeamSize,
} from './teamPresentation.js';
import {
  DELETE_FINISHED_TEAM_SESSION_WARNING,
  DELETE_TEAM_SESSION_CONFIRMATION_MESSAGE,
  DELETE_TEAM_SESSION_SIDE_EFFECTS_WARNING,
  FORMAT_CHANGE_CONFIRMATION_MESSAGE,
  FORMAT_CHANGE_CONFIRMATION_REQUIRED,
  deleteTeamSession,
  formatSessionDate,
  localDateString,
  sessionDisplayName,
  sessionListStats,
  sessionsForDisplay,
  translateSessionStatus,
  updateTeamSessionDetails,
} from './teamGameSessions.js';

function emptyForm() {
  return {
    date: localDateString(),
    name: '',
    teamSize: 2,
    teamCount: 2,
  };
}

function formFromSession(session) {
  return {
    date: session.date,
    name: session.name ?? '',
    teamSize: session.format?.teamSize ?? 2,
    teamCount: session.format?.teamCount ?? 2,
  };
}

function SessionDeleteDialog({ session, openerRef, onConfirm, onCancel }) {
  if (!session) return null;

  return (
    <ConfirmDialog
      titleId="delete-session-title"
      title="Excluir encontro"
      message={DELETE_TEAM_SESSION_CONFIRMATION_MESSAGE}
      confirmLabel={
        session.status === 'finished' ? 'Excluir encontro finalizado' : 'Excluir encontro'
      }
      destructive
      openerRef={openerRef}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="text-sm font-semibold">{sessionDisplayName(session)}</p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {formatSessionDate(session.date)} · {translateSessionStatus(session.status)} ·{' '}
        {sessionListStats(session).matchCount}{' '}
        {sessionListStats(session).matchCount === 1 ? 'partida' : 'partidas'}
      </p>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {session.status === 'finished'
          ? DELETE_FINISHED_TEAM_SESSION_WARNING
          : DELETE_TEAM_SESSION_SIDE_EFFECTS_WARNING}
      </p>
    </ConfirmDialog>
  );
}

function SessionDetailsForm({
  idPrefix,
  submitLabel,
  form,
  setForm,
  dateError,
  teamSizeError,
  teamCountError,
  formatLocked,
  submitRef,
  onSubmit,
  onCancel,
}) {
  const inputStyle = {
    backgroundColor: 'var(--bg-app)',
    color: 'var(--text-main)',
    borderColor: 'var(--border-color)',
  };

  return (
    <form
      onSubmit={onSubmit}
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-date`} style={{ color: 'var(--text-main)' }}>
          Data
        </label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          required
          value={form.date}
          onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
          className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
          style={inputStyle}
        />
        {dateError && <p className="mt-1 text-xs font-semibold text-red-500">{dateError}</p>}
      </div>

      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-format`} style={{ color: 'var(--text-main)' }}>
          Formato
        </label>
        <select
          id={`${idPrefix}-format`}
          required
          value={form.teamSize}
          disabled={formatLocked}
          onChange={(event) =>
            setForm((current) => ({ ...current, teamSize: Number(event.target.value) }))
          }
          className="mt-1 w-full border rounded-lg p-2 text-sm outline-none disabled:opacity-60"
          style={inputStyle}
        >
          {SESSION_FORMAT_OPTIONS.map((option) => (
            <option key={option.teamSize} value={option.teamSize}>
              {option.label}
            </option>
          ))}
        </select>
        {teamSizeError && <p className="mt-1 text-xs font-semibold text-red-500">{teamSizeError}</p>}
      </div>

      <div>
        <label
          className="block text-sm font-bold"
          htmlFor={`${idPrefix}-team-count`}
          style={{ color: 'var(--text-main)' }}
        >
          Quantidade de times
        </label>
        <input
          id={`${idPrefix}-team-count`}
          type="number"
          required
          min="2"
          step="1"
          value={form.teamCount}
          disabled={formatLocked}
          onChange={(event) => setForm((current) => ({ ...current, teamCount: event.target.value }))}
          className="mt-1 w-full border rounded-lg p-2 text-sm outline-none disabled:opacity-60"
          style={inputStyle}
        />
        {teamCountError && <p className="mt-1 text-xs font-semibold text-red-500">{teamCountError}</p>}
        {formatLocked && (
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            O formato não pode mudar após a geração dos jogos.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-bold" htmlFor={`${idPrefix}-name`} style={{ color: 'var(--text-main)' }}>
          Nome (opcional)
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Sábado na Arena"
          className="mt-1 w-full border rounded-lg p-2 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="flex gap-2 text-sm">
        <button
          ref={submitRef}
          type="submit"
          className="flex-1 font-bold py-3 rounded-xl shadow-md cursor-pointer"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
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
  );
}

export default function GameSessionsView({
  sessions = [],
  players = [],
  cacheInvalid = false,
  cacheError = null,
  onCreateSession,
  onApplyOperation,
  syncPanel,
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [dateError, setDateError] = useState(null);
  const [teamSizeError, setTeamSizeError] = useState(null);
  const [teamCountError, setTeamCountError] = useState(null);
  const [openSessionId, setOpenSessionId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingFormatChange, setPendingFormatChange] = useState(null);
  const deleteButtonRefs = useRef({});
  const detailEditRef = useRef(null);
  const detailDeleteRef = useRef(null);
  const saveButtonRef = useRef(null);
  const deleteOpenerRef = useRef(null);

  const visibleSessions = sessionsForDisplay(sessions);
  const openSession = sessions.find((item) => item.id === openSessionId) ?? null;

  const clearFormatErrors = () => {
    setTeamSizeError(null);
    setTeamCountError(null);
  };

  const clearFormErrors = () => {
    setDateError(null);
    clearFormatErrors();
  };

  const closeForms = () => {
    setForm(emptyForm());
    clearFormErrors();
    setIsCreating(false);
    setEditingSession(null);
    setPendingFormatChange(null);
  };

  const applySessionChanges = (session, { formatChangeConfirmed = false } = {}) => {
    const dateResult = validateDate(form.date);
    if (!dateResult.ok) {
      setDateError(dateResult.errors[0]?.message || 'A data do encontro é inválida.');
      return { ok: false };
    }

    const formatLocked = session.status !== 'draft';
    const formatResult = parseSessionFormatInput({
      teamSize: form.teamSize,
      teamCount: form.teamCount,
    });
    if (!formatLocked && !formatResult.ok) {
      setTeamSizeError(formatResult.teamSizeError);
      setTeamCountError(
        formatResult.teamCountError || 'Informe uma quantidade de times inteira de no mínimo 2.'
      );
      return { ok: false };
    }

    const result = onApplyOperation?.((document) =>
      updateTeamSessionDetails(
        document,
        session.id,
        {
          date: form.date,
          name: form.name,
          ...(formatLocked
            ? {}
            : {
                teamSize: formatResult.format.teamSize,
                teamCount: formatResult.format.teamCount,
              }),
        },
        { formatChangeConfirmed }
      )
    );

    if (result?.errors?.[0]?.code === FORMAT_CHANGE_CONFIRMATION_REQUIRED) {
      setPendingFormatChange(session);
      return result;
    }

    if (result?.ok === false) {
      const field = result.errors?.[0]?.field;
      const message = result.errors?.[0]?.message;
      if (field === 'date') setDateError(message);
      else if (field === 'teamSize') setTeamSizeError(message);
      else if (field === 'teamCount') setTeamCountError(message);
      return result;
    }

    closeForms();
    return result;
  };

  const handleCreateSubmit = (event) => {
    event.preventDefault();
    const dateResult = validateDate(form.date);
    if (!dateResult.ok) {
      setDateError(dateResult.errors[0]?.message || 'A data do encontro é inválida.');
      return;
    }

    const formatResult = parseSessionFormatInput({
      teamSize: form.teamSize,
      teamCount: form.teamCount,
    });
    if (!formatResult.ok) {
      setTeamSizeError(formatResult.teamSizeError);
      setTeamCountError(
        formatResult.teamCountError || 'Informe uma quantidade de times inteira de no mínimo 2.'
      );
      return;
    }

    const created = onCreateSession?.({
      date: form.date,
      name: form.name,
      teamSize: formatResult.format.teamSize,
      teamCount: formatResult.format.teamCount,
    });
    if (created?.ok === false) return;
    closeForms();
  };

  const handleEditSubmit = (event) => {
    event.preventDefault();
    if (!editingSession) return;
    applySessionChanges(editingSession);
  };

  if (openSessionId) {
    if (!openSession) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setOpenSessionId(null)}
            className="font-bold text-sm py-2 cursor-pointer"
            style={{ color: 'var(--primary)' }}
          >
            ← Voltar para encontros
          </button>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Encontro não encontrado.
          </p>
          {syncPanel}
        </div>
      );
    }

    return (
      <>
        <GameSessionDetail
          session={openSession}
          players={players}
          syncPanel={syncPanel}
          onBack={() => setOpenSessionId(null)}
          onApplyOperation={onApplyOperation}
          onEditSession={() => {
            setEditingSession(openSession);
            setForm(formFromSession(openSession));
            clearFormErrors();
            setOpenSessionId(null);
            setIsCreating(false);
          }}
          onRequestDelete={() => {
            deleteOpenerRef.current = detailDeleteRef.current;
            setPendingDelete(openSession);
          }}
          editButtonRef={detailEditRef}
          deleteButtonRef={detailDeleteRef}
        />
        <SessionDeleteDialog
          session={pendingDelete}
          openerRef={detailDeleteRef}
          onConfirm={() => {
            const result = onApplyOperation?.((document) =>
              deleteTeamSession(document, pendingDelete.id, { deleteConfirmed: true })
            );
            if (result?.ok) {
              setOpenSessionId(null);
              setPendingDelete(null);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Encontros</h2>
        {!isCreating && !editingSession && (
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm());
              clearFormErrors();
              setIsCreating(true);
            }}
            className="px-3 py-2 rounded-xl font-bold text-sm shadow-md cursor-pointer"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
          >
            Novo encontro
          </button>
        )}
      </div>

      {syncPanel}

      {cacheInvalid && (
        <div
          className="p-4 rounded-xl border space-y-1"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--primary)' }}
        >
          <p className="text-sm font-bold">O cache local de encontros está inválido.</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Criar ou editar um encontro não vai sobrescrever os dados locais até você confirmar a
            substituição.
          </p>
          {cacheError && <p className="text-xs font-semibold text-red-500">{cacheError}</p>}
        </div>
      )}

      {isCreating && (
        <SessionDetailsForm
          idPrefix="create-session"
          submitLabel="Criar encontro"
          form={form}
          setForm={setForm}
          dateError={dateError}
          teamSizeError={teamSizeError}
          teamCountError={teamCountError}
          formatLocked={false}
          submitRef={saveButtonRef}
          onSubmit={handleCreateSubmit}
          onCancel={closeForms}
        />
      )}

      {editingSession && (
        <SessionDetailsForm
          idPrefix="edit-session"
          submitLabel="Salvar encontro"
          form={form}
          setForm={setForm}
          dateError={dateError}
          teamSizeError={teamSizeError}
          teamCountError={teamCountError}
          formatLocked={editingSession.status !== 'draft'}
          submitRef={saveButtonRef}
          onSubmit={handleEditSubmit}
          onCancel={closeForms}
        />
      )}

      {visibleSessions.length === 0 ? (
        <div
          className="text-center py-8 rounded-xl border border-dashed text-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Nenhum encontro ainda. Toque em “Novo encontro” para registrar o primeiro.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleSessions.map((session) => {
            const { teamCount, matchCount } = sessionListStats(session);
            const teamSize = resolveTeamSize(session);
            return (
              <article
                key={session.id}
                className="p-4 rounded-xl border space-y-2"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{formatSessionDate(session.date)}</p>
                    {session.name && (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {session.name}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-xs font-semibold px-2 py-1 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                  >
                    {translateSessionStatus(session.status)}
                  </span>
                </div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {formatTeamCountPhrase(teamCount, teamSize)} · {matchCount}{' '}
                  {matchCount === 1 ? 'jogo' : 'jogos'}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenSessionId(session.id)}
                  className="w-full font-bold py-2 rounded-xl border text-sm cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-main)',
                  }}
                >
                  Abrir encontro
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingSession(session);
                      setForm(formFromSession(session));
                      clearFormErrors();
                    }}
                    className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer"
                    style={{
                      backgroundColor: 'transparent',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-main)',
                    }}
                  >
                    Editar encontro
                  </button>
                  <button
                    ref={(node) => {
                      deleteButtonRefs.current[session.id] = node;
                    }}
                    type="button"
                    onClick={() => {
                      deleteOpenerRef.current = deleteButtonRefs.current[session.id];
                      setPendingDelete(session);
                    }}
                    className="flex-1 font-bold py-2 rounded-xl border text-sm cursor-pointer underline"
                    style={{
                      backgroundColor: 'transparent',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-main)',
                    }}
                  >
                    Excluir encontro
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingFormatChange && (
        <ConfirmDialog
          titleId="format-change-title"
          title="Alterar formato"
          message={FORMAT_CHANGE_CONFIRMATION_MESSAGE}
          confirmLabel="Remover times e alterar"
          destructive
          openerRef={saveButtonRef}
          onConfirm={() => applySessionChanges(pendingFormatChange, { formatChangeConfirmed: true })}
          onCancel={() => setPendingFormatChange(null)}
        />
      )}

      <SessionDeleteDialog
        session={pendingDelete}
        openerRef={deleteOpenerRef}
        onConfirm={() => {
          const result = onApplyOperation?.((document) =>
            deleteTeamSession(document, pendingDelete.id, { deleteConfirmed: true })
          );
          if (result?.ok) {
            if (openSessionId === pendingDelete.id) setOpenSessionId(null);
            setPendingDelete(null);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
