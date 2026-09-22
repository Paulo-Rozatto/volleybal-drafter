import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANALYZABLE_MATCH_INCLUDED,
  ANALYZABLE_MATCH_INVALID,
  ANALYZABLE_MATCH_PENDING,
  MATCH_SOURCE_COMPETITION,
  MATCH_SOURCE_SESSION,
  listSessionPerformanceMatches,
} from '../domain/performanceMatches.js';
import {
  buildPlayerPerformanceIndex,
  buildPlayerPerformanceIndexFromMatches,
  getPlayerMatchHistory,
  getPlayerPerformance,
} from '../domain/playerPerformance.js';
import { TEAM_SESSION_SCHEMA_VERSION } from '../domain/teamSession.js';
import {
  assignCloudPerformanceRecency,
  buildCloudPlayerPerformanceIndex,
  mapCloudPerformanceMatches,
} from './cloudPerformance.js';

const STAMP = '2026-09-21T12:00:00.000Z';
const OLDER_SESSION = '00000000-0000-4000-8000-000000000001';
const NEWER_SESSION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function member(playerId, playerName) {
  return { player_id: playerId, player_name_snapshot: playerName };
}

function cloudRow({
  sessionId,
  sessionName = 'Arena',
  sessionDate = '2026-09-21',
  updatedAt = STAMP,
  createdAt = STAMP,
  roundId = `${sessionId}-r1`,
  roundNumber = 1,
  cycleNumber = 1,
  matchId = `${sessionId}-m1`,
  scoreA = 21,
  scoreB = 18,
  lineupA = [member('andre', 'André'), member('ana', 'Ana')],
  lineupB = [member('bruno', 'Bruno'), member('carla', 'Carla')],
  legacySourceId = null,
} = {}) {
  return {
    session_id: sessionId,
    session_name: sessionName,
    session_date: sessionDate,
    session_updated_at: updatedAt,
    session_created_at: createdAt,
    legacy_source_id: legacySourceId,
    round_id: roundId,
    round_number: roundNumber,
    cycle_number: cycleNumber,
    match_id: matchId,
    score_a: scoreA,
    score_b: scoreB,
    lineup_a: lineupA,
    lineup_b: lineupB,
  };
}

describe('adapter cloud de desempenho', () => {
  it('não duplica classificação de placar e não importa isMatchPending/isMatchCompleted', () => {
    const source = readFileSync(new URL('./cloudPerformance.js', import.meta.url), 'utf8');
    expect(source).toContain('createAnalyzableMatch');
    expect(source).not.toContain('isMatchPending');
    expect(source).not.toContain('isMatchCompleted');
    expect(source).not.toContain('classifyPerformanceMatch');

    const matches = mapCloudPerformanceMatches([
      cloudRow({ sessionId: 's-ok', scoreA: 21, scoreB: 18 }),
      cloudRow({ sessionId: 's-pending', scoreA: null, scoreB: null }),
      cloudRow({ sessionId: 's-tie', scoreA: 21, scoreB: 21 }),
    ]);
    expect(matches.map((match) => match.status)).toEqual([
      ANALYZABLE_MATCH_INCLUDED,
      ANALYZABLE_MATCH_PENDING,
      ANALYZABLE_MATCH_INVALID,
    ]);
    expect(matches.every((match) => match.sourceType === MATCH_SOURCE_SESSION)).toBe(true);
    expect(matches[0].originKey).toBe('s-ok');
    expect(
      mapCloudPerformanceMatches([
        cloudRow({ sessionId: 'cloud-id', legacySourceId: 'gist-session-1' }),
      ])[0].originKey
    ).toBe('gist-session-1');
    expect(
      mapCloudPerformanceMatches([
        {
          ...cloudRow({ sessionId: null, matchId: 'c-match' }),
          source_kind: 'competition',
          competition_id: 'comp-1',
          legacy_source_id: null,
        },
      ])[0]
    ).toMatchObject({
      sourceType: MATCH_SOURCE_COMPETITION,
      originKey: 'comp-1',
    });
  });

  it('mantém sourceIndex crescente com a recência mesmo quando a RPC devolve DESC', () => {
    const rowsDesc = [
      cloudRow({
        sessionId: NEWER_SESSION,
        sessionName: 'Depois',
        matchId: 'm-new',
        roundId: 'r-new',
      }),
      cloudRow({
        sessionId: OLDER_SESSION,
        sessionName: 'Antes',
        matchId: 'm-old',
        roundId: 'r-old',
      }),
    ];
    expect(rowsDesc.map((row) => row.session_id)).toEqual([NEWER_SESSION, OLDER_SESSION]);

    const assigned = assignCloudPerformanceRecency(rowsDesc);
    const newer = assigned.find((row) => row.session_id === NEWER_SESSION);
    const older = assigned.find((row) => row.session_id === OLDER_SESSION);

    expect(older.sourceIndex).toBe(0);
    expect(newer.sourceIndex).toBe(1);
    expect(newer.sourceIndex).toBeGreaterThan(older.sourceIndex);
    expect(assigned[0].sourceIndex).not.toBe(0);
  });

  it('equivale ao índice V2 do mesmo recorte quando as datas amarram a recência', () => {
    const lineupA = [
      { playerId: 'andre', playerName: 'André' },
      { playerId: 'ana', playerName: 'Ana' },
    ];
    const lineupB = [
      { playerId: 'bruno', playerName: 'Bruno' },
      { playerId: 'carla', playerName: 'Carla' },
    ];
    const sessionShape = ({ id, name, roundId, matchId, scoreA, scoreB }) => ({
      id,
      date: '2026-09-21',
      name,
      status: 'finished',
      createdAt: STAMP,
      updatedAt: STAMP,
      format: { teamSize: 2, teamCount: 2 },
      teams: [
        { id: `${id}-t1`, members: lineupA },
        { id: `${id}-t2`, members: lineupB },
      ],
      rounds: [
        {
          id: roundId,
          number: 1,
          cycleNumber: 1,
          byeTeamId: null,
          matches: [
            {
              id: matchId,
              teamAId: `${id}-t1`,
              teamBId: `${id}-t2`,
              lineupA,
              lineupB,
              scoreA,
              scoreB,
            },
          ],
        },
      ],
    });
    const document = {
      schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
      sessions: [
        sessionShape({
          id: OLDER_SESSION,
          name: 'Antes',
          roundId: 'r-old',
          matchId: 'm-old',
          scoreA: 21,
          scoreB: 18,
        }),
        sessionShape({
          id: NEWER_SESSION,
          name: 'Depois',
          roundId: 'r-new',
          matchId: 'm-new',
          scoreA: 15,
          scoreB: 21,
        }),
      ],
    };

    const roster = [
      { id: 'andre', name: 'André' },
      { id: 'ana', name: 'Ana' },
      { id: 'bruno', name: 'Bruno' },
      { id: 'carla', name: 'Carla' },
    ];
    const wrapper = buildPlayerPerformanceIndex(document, roster);
    const listed = listSessionPerformanceMatches(document);
    const fromMatches = buildPlayerPerformanceIndexFromMatches({ ...listed, roster });
    const cloudRowsDesc = [
      cloudRow({
        sessionId: NEWER_SESSION,
        sessionName: 'Depois',
        roundId: 'r-new',
        matchId: 'm-new',
        scoreA: 15,
        scoreB: 21,
      }),
      cloudRow({
        sessionId: OLDER_SESSION,
        sessionName: 'Antes',
        roundId: 'r-old',
        matchId: 'm-old',
      }),
    ];
    const cloud = buildCloudPlayerPerformanceIndex({
      player: { id: 'andre', name: 'André' },
      matches: cloudRowsDesc,
    });

    expect(wrapper.ok).toBe(true);
    expect(fromMatches.ok).toBe(true);
    expect(cloud.built.ok).toBe(true);
    expect(listed.matches.map((match) => match.sourceIndex)).toEqual([0, 1]);
    expect(mapCloudPerformanceMatches(cloudRowsDesc).map((match) => match.sourceIndex)).toEqual([
      1, 0,
    ]);
    expect(getPlayerPerformance(cloud.built.index, 'andre')).toEqual(
      getPlayerPerformance(wrapper.index, 'andre')
    );
    expect(getPlayerMatchHistory(cloud.built.index, 'andre')).toEqual(
      getPlayerMatchHistory(wrapper.index, 'andre')
    );
    expect(getPlayerMatchHistory(cloud.built.index, 'andre')[0]).toMatchObject({
      sourceType: MATCH_SOURCE_SESSION,
      cycleNumber: 1,
    });
  });
});

describe('CloudProfileView', () => {
  it('copia o histórico antes de inverter e não muta o array do domínio', () => {
    const view = readFileSync(new URL('../CloudPerformanceSections.jsx', import.meta.url), 'utf8');
    expect(view).toContain('[...history].reverse()');
    expect(view).not.toMatch(/getPlayerMatchHistory\([^)]*\)\.reverse\(/);
  });
});
