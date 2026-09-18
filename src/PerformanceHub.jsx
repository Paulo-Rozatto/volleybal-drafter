import React, { useState } from 'react';
import PlayerPerformanceView from './PlayerPerformanceView.jsx';
import PlayerRankingView from './PlayerRankingView.jsx';
import {
  PERFORMANCE_PLAYER_TAB,
  PERFORMANCE_PLAYER_TAB_LABEL,
  PERFORMANCE_RANKING_TAB,
  PERFORMANCE_RANKING_TAB_LABEL,
  nextPerformanceTab,
} from './performancePresentation.js';

export default function PerformanceHub({ document, roster = [], competitionsDocument = null }) {
  const [tab, setTab] = useState(PERFORMANCE_PLAYER_TAB);
  const showPlayer = tab === PERFORMANCE_PLAYER_TAB;

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg p-1 gap-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <button
          type="button"
          role="tab"
          aria-selected={showPlayer}
          onClick={() => setTab(nextPerformanceTab(tab, PERFORMANCE_PLAYER_TAB))}
          className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
          style={{
            backgroundColor: showPlayer ? 'var(--primary)' : 'transparent',
            color: showPlayer ? 'var(--text-inverse)' : 'var(--text-muted)',
          }}
        >
          {PERFORMANCE_PLAYER_TAB_LABEL}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!showPlayer}
          onClick={() => setTab(nextPerformanceTab(tab, PERFORMANCE_RANKING_TAB))}
          className="flex-1 py-2 text-sm font-bold rounded-md transition cursor-pointer"
          style={{
            backgroundColor: !showPlayer ? 'var(--primary)' : 'transparent',
            color: !showPlayer ? 'var(--text-inverse)' : 'var(--text-muted)',
          }}
        >
          {PERFORMANCE_RANKING_TAB_LABEL}
        </button>
      </div>
      {showPlayer ? (
        <PlayerPerformanceView
          document={document}
          roster={roster}
          competitionsDocument={competitionsDocument}
        />
      ) : (
        <PlayerRankingView
          document={document}
          roster={roster}
          competitionsDocument={competitionsDocument}
        />
      )}
    </div>
  );
}
