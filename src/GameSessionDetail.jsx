import React, { useState } from 'react';
import AutomaticPairBuilder from './AutomaticPairBuilder.jsx';
import PairBuilder from './PairBuilder.jsx';
import {
  addSessionPair,
  canEditSessionPairs,
  formatSessionDate,
  removeSessionPair,
  replaceSessionPairs,
  sessionDisplayName,
  sessionListStats,
  translateSessionStatus,
  updateSessionPair,
} from './gameSessions.js';

export default function GameSessionDetail({
  session,
  sessionsDocument,
  players = [],
  syncPanel,
  onBack,
  onApplyDocument,
}) {
  const [pairMode, setPairMode] = useState('manual');
  const { pairCount } = sessionListStats(session);
  const editable = canEditSessionPairs(session);
  const mode = editable ? pairMode : 'manual';

  const applyPairChange = (result) => {
    if (result?.ok) onApplyDocument?.(result.document);
    return result;
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="font-bold text-sm py-2 cursor-pointer"
        style={{ color: 'var(--primary)' }}
      >
        ← Voltar para encontros
      </button>

      <h2 className="text-xl font-bold">{sessionDisplayName(session)}</h2>

      {syncPanel}

      <div
        className="p-4 rounded-xl border space-y-1"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatSessionDate(session.date)}
        </p>
        <p className="text-sm font-semibold">{translateSessionStatus(session.status)}</p>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {pairCount} {pairCount === 1 ? 'dupla' : 'duplas'}
        </p>
      </div>

      {editable && (
        <div className="flex rounded-lg p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <button
            type="button"
            onClick={() => setPairMode('manual')}
            className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
            style={{
              backgroundColor: mode === 'manual' ? 'var(--primary)' : 'transparent',
              color: mode === 'manual' ? 'var(--text-inverse)' : 'var(--text-muted)',
            }}
          >
            Montar manualmente
          </button>
          <button
            type="button"
            onClick={() => setPairMode('auto')}
            className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
            style={{
              backgroundColor: mode === 'auto' ? 'var(--primary)' : 'transparent',
              color: mode === 'auto' ? 'var(--text-inverse)' : 'var(--text-muted)',
            }}
          >
            Sortear duplas
          </button>
        </div>
      )}

      {mode === 'auto' && (
        <AutomaticPairBuilder
          key={session.updatedAt}
          session={session}
          roster={players}
          onReplacePairs={(pairs, { replaceConfirmed } = {}) =>
            applyPairChange(
              replaceSessionPairs(sessionsDocument, session.id, pairs, players, { replaceConfirmed })
            )
          }
        />
      )}

      <PairBuilder
        session={session}
        roster={players}
        showForm={mode === 'manual'}
        onRequestEdit={() => setPairMode('manual')}
        onAddPair={(playerA, playerB) =>
          applyPairChange(addSessionPair(sessionsDocument, session.id, { playerA, playerB }, players))
        }
        onUpdatePair={(pairId, playerA, playerB) =>
          applyPairChange(
            updateSessionPair(sessionsDocument, session.id, pairId, { playerA, playerB }, players)
          )
        }
        onRemovePair={(pairId) =>
          applyPairChange(removeSessionPair(sessionsDocument, session.id, pairId, players))
        }
      />
    </div>
  );
}
