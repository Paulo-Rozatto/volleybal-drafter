import { describe, expect, it } from 'vitest';
import {
  ANALYZABLE_MATCH_INCLUDED,
  ANALYZABLE_MATCH_INVALID,
  ANALYZABLE_MATCH_PENDING,
  MATCH_SOURCE_SESSION,
} from '../domain/performanceMatches.js';
import {
  buildPlayerPerformanceIndexFromMatches,
  getBestPartner,
  getHardestOpponents,
  getPlayerMatchHistory,
  getPlayerPartnerPerformance,
  getPlayerPerformance,
  getPlayerPerformanceRanking,
} from '../domain/playerPerformance.js';
import { mapCloudPerformanceMatches } from './cloudPerformance.js';
import {
  buildGroupPerformanceIndex,
  splitGroupLeaderboard,
} from './groupPerformance.js';

const STAMP = '2026-09-21T12:00:00.000Z';

function member(playerId, playerName) {
  return { player_id: playerId, player_name_snapshot: playerName };
}

function matchRow({
  sessionId = 's-group',
  matchId = 'm1',
  scoreA = 21,
  scoreB = 18,
  lineupA = [member('p-andre', 'André'), member('p-paulo', 'Paulo')],
  lineupB = [member('p-davi', 'Davi'), member('p-guest', 'Convidado')],
} = {}) {
  return {
    session_id: sessionId,
    session_name: 'Quinta',
    session_date: '2026-09-21',
    session_updated_at: STAMP,
    session_created_at: STAMP,
    legacy_source_id: null,
    round_id: `${sessionId}-r1`,
    round_number: 1,
    cycle_number: 1,
    match_id: matchId,
    score_a: scoreA,
    score_b: scoreB,
    lineup_a: lineupA,
    lineup_b: lineupB,
  };
}

const groupPayload = {
  group_id: 'g1',
  members: [
    { user_id: 'u-andre', display_name: 'André', role: 'owner', player_id: 'p-andre', player_name: 'André' },
    { user_id: 'u-paulo', display_name: 'Paulo', role: 'member', player_id: 'p-paulo', player_name: 'Paulo' },
    { user_id: 'u-davi', display_name: 'Davi', role: 'member', player_id: 'p-davi', player_name: 'Davi' },
    { user_id: 'u-unlinked', display_name: 'Sem vínculo', role: 'member', player_id: null, player_name: null },
  ],
  matches: [
    matchRow(),
    matchRow({ matchId: 'm-pending', scoreA: null, scoreB: null }),
  ],
};

describe('adapter de desempenho do grupo', () => {
  it('reusa o mesmo pipeline de partidas e originKey de sessão', () => {
    const mapped = mapCloudPerformanceMatches(groupPayload.matches);
    const group = buildGroupPerformanceIndex(groupPayload);
    expect(group.matches.map((match) => match.originKey)).toEqual(mapped.map((match) => match.originKey));
    expect(group.matches[0].sourceType).toBe(MATCH_SOURCE_SESSION);
    expect(group.matches.map((match) => match.status)).toEqual([
      ANALYZABLE_MATCH_INCLUDED,
      ANALYZABLE_MATCH_PENDING,
    ]);

    const personal = getPlayerPerformance(
      group.built.index,
      'p-andre'
    );
    expect(personal.matches).toBe(1);
    expect(personal.wins).toBe(1);
  });

  it('produz as mesmas métricas que o ranking pessoal na mesma fatia', () => {
    const mapped = mapCloudPerformanceMatches(groupPayload.matches);
    const personalBuilt = buildPlayerPerformanceIndexFromMatches({
      matches: mapped,
      roster: [
        { id: 'p-andre', name: 'André' },
        { id: 'p-paulo', name: 'Paulo' },
        { id: 'p-davi', name: 'Davi' },
      ],
    });
    const group = buildGroupPerformanceIndex(groupPayload);
    const ranking = getPlayerPerformanceRanking(group.built.index, {
      playerIds: ['p-andre', 'p-paulo', 'p-davi'],
      sortBy: 'wins',
    });
    const board = splitGroupLeaderboard(group.built, group.members);
    expect(getPlayerPerformance(group.built.index, 'p-andre')).toEqual(
      getPlayerPerformance(personalBuilt.index, 'p-andre')
    );
    expect(getPlayerPartnerPerformance(group.built.index, 'p-andre')).toEqual(
      getPlayerPartnerPerformance(personalBuilt.index, 'p-andre')
    );
    expect(getHardestOpponents(group.built.index, 'p-andre')).toEqual(
      getHardestOpponents(personalBuilt.index, 'p-andre')
    );
    expect(getPlayerMatchHistory(group.built.index, 'p-andre')).toEqual(
      getPlayerMatchHistory(personalBuilt.index, 'p-andre')
    );
    expect(getBestPartner(group.built.index, 'p-andre').partnerId).toBe('p-paulo');
    expect(board.ranked.map((row) => row.playerId)).toEqual(
      ranking.filter((row) => row.matches > 0).map((row) => row.playerId)
    );
    expect(getPlayerMatchHistory(group.built.index, 'p-andre')[0].cycleNumber).toBe(1);
    expect(group.matches[0].originKey).toBe('s-group');
    expect(group.matches[0].sourceIndex).toBe(mapped[0].sourceIndex);
  });

  it('preserva originKey legado, pendente e inválido para o motor classificar', () => {
    const payload = {
      ...groupPayload,
      matches: [
        matchRow({ matchId: 'm-legacy', sessionId: 's-legacy' }),
        matchRow({ matchId: 'm-pending', scoreA: null, scoreB: null }),
        matchRow({ matchId: 'm-invalid', scoreA: 21, scoreB: 21 }),
      ],
    };
    payload.matches[0] = {
      ...payload.matches[0],
      legacy_source_id: 'gist:old',
    };
    const group = buildGroupPerformanceIndex(payload);
    expect(group.matches[0].originKey).toBe('gist:old');
    expect(group.matches.map((match) => match.status)).toEqual([
      ANALYZABLE_MATCH_INCLUDED,
      ANALYZABLE_MATCH_PENDING,
      ANALYZABLE_MATCH_INVALID,
    ]);
  });

  it('convidado entra no histórico, não no leaderboard; membro sem player fica unlinked', () => {
    const group = buildGroupPerformanceIndex(groupPayload);
    const board = splitGroupLeaderboard(group.built, group.members);
    expect(board.ranked.map((row) => row.playerId)).not.toContain('p-guest');
    expect(board.unlinked.map((member) => member.userId)).toEqual(['u-unlinked']);
    expect(getPlayerMatchHistory(group.built.index, 'p-andre')[0].opponents.some((item) => item.playerId === 'p-guest')).toBe(
      true
    );
  });

  it('membro vinculado sem partida válida não ganha posição', () => {
    const payload = {
      ...groupPayload,
      members: [
        ...groupPayload.members,
        { user_id: 'u-idle', display_name: 'Idle', role: 'member', player_id: 'p-idle', player_name: 'Idle' },
      ],
    };
    const group = buildGroupPerformanceIndex(payload);
    const board = splitGroupLeaderboard(group.built, group.members);
    expect(board.withoutMatches.some((member) => member.playerId === 'p-idle')).toBe(true);
    expect(board.ranked.some((row) => row.playerId === 'p-idle')).toBe(false);
  });
});
