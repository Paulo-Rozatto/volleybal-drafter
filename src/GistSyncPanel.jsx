import React, { useEffect, useRef } from 'react';
import {
  formatFileSize,
  COMPETITIONS_SIZE_WARNING_BYTES,
  GAME_SESSIONS_SIZE_WARNING_BYTES,
  competitionsPatchUtf8Size,
  gameSessionsPatchUtf8Size,
} from './persistence/fileSize.js';
import { createEmptyGameSessionsDocument } from './persistence/gameSessionsDocument.js';
import { createEmptyCompetitionDocument } from './persistence/competitionsDocument.js';

export default function GistSyncPanel({
  password,
  onPasswordChange,
  onLoad,
  onSave,
  isSyncing,
  saveEnabled,
  gistGateMessage,
  syncStatus,
  localCacheError,
  localWriteError,
  localCompetitionsCacheError,
  localCompetitionsWriteError,
  showLoadConflict,
  onKeepLocalChanges,
  onUseRemoteData,
  onCancelLoad,
  gameSessions,
  competitions,
}) {
  const loadButtonRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const wasConflictOpenRef = useRef(false);
  const sizeBytes = gameSessionsPatchUtf8Size(
    gameSessions ?? createEmptyGameSessionsDocument()
  );
  const competitionsSizeBytes = competitionsPatchUtf8Size(
    competitions ?? createEmptyCompetitionDocument()
  );
  const showSizeWarning = sizeBytes >= GAME_SESSIONS_SIZE_WARNING_BYTES;
  const showCompetitionsSizeWarning = competitionsSizeBytes >= COMPETITIONS_SIZE_WARNING_BYTES;

  useEffect(() => {
    if (showLoadConflict) {
      wasConflictOpenRef.current = true;
      cancelButtonRef.current?.focus();
      const onKeyDown = (event) => {
        if (event.key === 'Escape') onCancelLoad?.();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }

    if (wasConflictOpenRef.current) {
      wasConflictOpenRef.current = false;
      loadButtonRef.current?.focus();
    }

    return undefined;
  }, [showLoadConflict, onCancelLoad]);

  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <h3 className="font-bold text-sm">Sincronização GitHub Gist</h3>

      <input
        type="password"
        placeholder="Digite sua Senha/PIN de Desbloqueio"
        value={password}
        onChange={onPasswordChange}
        className="w-full border p-2 rounded text-xs outline-none"
        style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
      />

      <div className="flex gap-2 text-xs">
        <button
          ref={loadButtonRef}
          type="button"
          onClick={onLoad}
          disabled={isSyncing}
          className="px-3 py-2 rounded font-bold border cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
        >
          🔄 Carregar do Gist
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={!saveEnabled}
          className="px-3 py-2 rounded font-bold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
        >
          💾 Salvar no Gist
        </button>
      </div>

      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        Encontros: {formatFileSize(sizeBytes)}
      </p>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        Competições: {formatFileSize(competitionsSizeBytes)}
      </p>

      {showSizeWarning && (
        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          O arquivo de encontros está grande. Considere arquivar encontros antigos.
        </p>
      )}
      {showCompetitionsSizeWarning && (
        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          O arquivo de competições está grande. Considere arquivar competições antigas.
        </p>
      )}

      {localCacheError && (
        <p className="text-xs font-semibold text-red-500">
          Erro no cache local de encontros: {localCacheError}
        </p>
      )}

      {localWriteError && (
        <p className="text-xs font-semibold text-red-500">
          Erro ao salvar encontros no cache local: {localWriteError}
        </p>
      )}

      {localCompetitionsCacheError && (
        <p className="text-xs font-semibold text-red-500">
          Erro no cache local de competições: {localCompetitionsCacheError}
        </p>
      )}

      {localCompetitionsWriteError && (
        <p className="text-xs font-semibold text-red-500">
          Erro ao salvar competições no cache local: {localCompetitionsWriteError}
        </p>
      )}

      <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
        {gistGateMessage}
      </p>

      {syncStatus && (
        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
          {syncStatus}
        </p>
      )}

      {showLoadConflict && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={onCancelLoad}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gist-load-conflict-title"
            aria-describedby="gist-load-conflict-description"
            className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="gist-load-conflict-title" className="font-bold text-base">
              Há alterações locais não salvas
            </h3>
            <p id="gist-load-conflict-description" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              O Gist pode ser carregado para validar a conexão. Escolha se os dados locais devem ser
              mantidos ou substituídos.
            </p>

            <button
              type="button"
              onClick={onKeepLocalChanges}
              className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }}
            >
              Manter alterações locais
            </button>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Carrega o Gist, mas preserva jogadores e encontros deste dispositivo. Você poderá salvar
              depois.
            </p>

            <button
              type="button"
              onClick={onUseRemoteData}
              className="w-full font-bold py-3 rounded-xl border cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            >
              Usar dados do Gist
            </button>
            <p className="text-xs font-semibold text-red-500">
              As alterações locais não salvas serão descartadas e substituídas pelos dados remotos.
            </p>

            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancelLoad}
              className="w-full font-bold py-3 rounded-xl border cursor-pointer"
              style={{ backgroundColor: 'transparent', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
