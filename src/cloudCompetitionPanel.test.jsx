import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudCompetitionOpenPanel } from './CloudCompetitionsView.jsx';
import {
  classifyCompetitionPersist,
  createdCloudCompetitionId,
  fetchOpenCloudCompetition,
  shouldApplyCompetitionLoad,
} from './cloudCompetitionPanel.js';
import { isScoreOnlyCompetitionMatchUpdate } from './hooks/useCloudCompetitionRealtime.js';

const loadedDraft = {
  competition: {
    id: 'c1',
    name: 'Torneio',
    date: '2026-09-21',
    status: 'draft',
    format: { teamSize: 2 },
    teams: [],
    stages: [{ id: 's1', number: 1, type: 'single_elimination', status: 'pending', rounds: [] }],
  },
  structureVersion: 0,
  joinCode: 'AB23CD56',
  groupId: null,
  myRole: 'owner',
  members: [{ userId: 'u1', role: 'owner', displayName: 'André' }],
  roster: [],
  matchVersions: {},
  events: [],
};

describe('cloud competition panel', () => {
  it('createdCloudCompetitionId e stale load', () => {
    expect(createdCloudCompetitionId({ ok: true, competitionId: 'c1' })).toBe('c1');
    expect(createdCloudCompetitionId({ ok: false })).toBeNull();
    expect(shouldApplyCompetitionLoad('c1', 'c1')).toBe(true);
    expect(shouldApplyCompetitionLoad('c1', 'c2')).toBe(false);
  });

  it('fetchOpenCloudCompetition não trata null como loading', async () => {
    const failed = await fetchOpenCloudCompetition(
      async () => ({ ok: false, error: { message: 'boom' } }),
      'c1',
      'u1'
    );
    expect(failed).toEqual({ ok: false, loaded: null, error: 'boom' });
  });

  it('mostra loading, erro com retry/back e detalhe', () => {
    const loading = renderToStaticMarkup(
      <CloudCompetitionOpenPanel
        competitionLoading
        competitionError={null}
        loaded={null}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(loading).toContain('Carregando competição');

    const erro = renderToStaticMarkup(
      <CloudCompetitionOpenPanel
        competitionLoading={false}
        competitionError="Falha ao abrir"
        loaded={null}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(erro).toContain('Falha ao abrir');
    expect(erro).toContain('Recarregar');
    expect(erro).toContain('Competições');

    const detail = renderToStaticMarkup(
      <CloudCompetitionOpenPanel
        competitionLoading={false}
        competitionError={null}
        loaded={loadedDraft}
        user={{ id: 'u1' }}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(detail).toContain('Torneio');
    expect(detail).toContain('AB23CD56');
    expect(detail).toContain('organizador');
    expect(detail).not.toContain('Carregando competição');
  });

  it('classifica persist teams/structure/score', () => {
    expect(classifyCompetitionPersist({ stages: [] }, { status: 'draft', stages: [] })).toBe('teams');
    expect(
      classifyCompetitionPersist(
        { stages: [{ rounds: [] }] },
        { status: 'in_progress', stages: [{ rounds: [{ matches: [{ id: 'm1' }] }] }] }
      )
    ).toBe('structure');
    expect(
      classifyCompetitionPersist(
        { stages: [{ rounds: [{ matches: [{ id: 'm1', scoreA: null, scoreB: null }] }] }] },
        { stages: [{ rounds: [{ matches: [{ id: 'm1', scoreA: 21, scoreB: 18 }] }] }] }
      )
    ).toBe('score');
  });

  it('score-only realtime ignora mudança estrutural', () => {
    expect(
      isScoreOnlyCompetitionMatchUpdate({
        eventType: 'UPDATE',
        old: { id: 'm1', round_id: 'r1', stage_id: 's1', team_a_id: 't1', team_b_id: 't2', competition_id: 'c1' },
        new: { id: 'm1', round_id: 'r1', stage_id: 's1', team_a_id: 't1', team_b_id: 't2', competition_id: 'c1', score_a: 21 },
      })
    ).toBe(true);
    expect(
      isScoreOnlyCompetitionMatchUpdate({
        eventType: 'UPDATE',
        old: { id: 'm1', team_a_id: 't1', competition_id: 'c1' },
        new: { id: 'm1', team_a_id: 't9', competition_id: 'c1' },
      })
    ).toBe(false);
  });
});
