import { describe, expect, it } from 'vitest';
import {
  applyCompetitionMatchResult,
  COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
  createDraftCompetition,
  generateCompetitionBracket,
  generateDoubleEliminationRounds,
  getCompetitionChampion,
  getFinalMatch,
  listCompetitionMatches,
  listCompetitionRounds,
  setDraftCompetitionTeams,
} from './competition.js';

const ISO = '2026-09-18T18:00:00.000Z';
const NOW = () => new Date(ISO);

function sequentialIds(prefix) {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function teamsFor(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    members: [
      { playerId: `p${index}a`, playerName: `A${index + 1}` },
      { playerId: `p${index}b`, playerName: `B${index + 1}` },
    ],
  }));
}

function deDraft(count, grandFinalMode = 'bracket_reset', idPrefix = 'd') {
  const ids = sequentialIds(idPrefix);
  const competition = createDraftCompetition(
    {
      name: 'DE',
      format: { teamSize: 2 },
      stages: [{ type: 'double_elimination', config: { grandFinalMode } }],
    },
    { idGenerator: ids, now: NOW }
  );
  const withTeams = setDraftCompetitionTeams(competition, teamsFor(count), { idGenerator: ids });
  expect(withTeams.ok).toBe(true);
  const generated = generateCompetitionBracket(withTeams.competition, {
    seedTeamIds: teamsFor(count).map((team) => team.id),
    idGenerator: ids,
  });
  expect(generated.ok).toBe(true);
  return generated.competition;
}

function play(competition, matchId, scoreA, scoreB) {
  const result = applyCompetitionMatchResult(competition, matchId, {
    scoreA,
    scoreB,
    playedDate: '2026-09-18',
  });
  expect(result.ok).toBe(true);
  return result.competition;
}

function roundsByBracket(competition, bracket) {
  return listCompetitionRounds(competition).filter((round) => round.bracket === bracket);
}

function matchBetween(competition, teamAId, teamBId) {
  return listCompetitionMatches(competition).find(
    (match) =>
      (match.teamAId === teamAId && match.teamBId === teamBId) ||
      (match.teamAId === teamBId && match.teamBId === teamAId)
  );
}

describe('double elimination', () => {
  it('monta chave de 4 com winners, losers e Grand Final', () => {
    const competition = deDraft(4, 'bracket_reset', 'four');
    expect(roundsByBracket(competition, 'winners')).toHaveLength(2);
    expect(roundsByBracket(competition, 'losers').length).toBeGreaterThanOrEqual(2);
    expect(roundsByBracket(competition, 'grand_final')).toHaveLength(1);
    expect(roundsByBracket(competition, 'grand_final_reset')).toHaveLength(1);
  });

  it('monta chave de 8 e coloca 1×8 / 4×5 / 2×7 / 3×6 no winners', () => {
    const rounds = generateDoubleEliminationRounds(
      ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'],
      { idGenerator: sequentialIds('eight') }
    );
    const first = rounds.find((round) => round.bracket === 'winners' && round.number === 1);
    const pairs = first.matches.map((match) => [match.sourceA.seed, match.sourceB.seed]);
    expect(pairs).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });

  it('vencedores avançam no Winners e perdedores descem ao Losers', () => {
    let current = deDraft(4, 'bracket_reset', 'flow');
    const [wb1, wb2] = roundsByBracket(current, 'winners')[0].matches;
    current = play(current, wb1.id, 21, 15);
    current = play(current, wb2.id, 21, 10);
    const wbFinal = roundsByBracket(current, 'winners').at(-1).matches[0];
    expect(wbFinal.teamAId).toBe(wb1.teamAId);
    expect(wbFinal.teamBId).toBe(wb2.teamAId);
    const lbFirst = roundsByBracket(current, 'losers')[0].matches[0];
    expect([lbFirst.teamAId, lbFirst.teamBId].sort()).toEqual([wb1.teamBId, wb2.teamBId].sort());
  });

  it('segunda derrota elimina e os campeões de cada chave chegam à Grand Final', () => {
    let current = deDraft(4, 'bracket_reset', 'gf');
    const playable = () =>
      listCompetitionMatches(current).filter(
        (match) => match.teamAId && match.teamBId && !match.winnerTeamId && match.roundId !== roundsByBracket(current, 'grand_final')[0]?.id
      );
    while (playable().length > 0) {
      current = play(current, playable()[0].id, 21, 15);
    }
    const gf = roundsByBracket(current, 'grand_final')[0].matches[0];
    const wbFinal = roundsByBracket(current, 'winners').at(-1).matches[0];
    expect(gf.teamAId).toBe(wbFinal.winnerTeamId);
    expect(gf.teamBId).toBeTruthy();
    expect(gf.teamBId).not.toBe(gf.teamAId);
  });

  it('cria reset só quando o campeão do Losers vence a primeira Grand Final', () => {
    let current = deDraft(4, 'bracket_reset', 'reset');
    const matches = () =>
      listCompetitionMatches(current).filter((match) => match.teamAId && match.teamBId && !match.winnerTeamId);
    while (matches().length > 0) {
      const next = matches()[0];
      const gf = roundsByBracket(current, 'grand_final')[0].matches[0];
      if (next.id === gf.id) {
        current = play(current, next.id, 10, 21);
      } else {
        current = play(current, next.id, 21, 15);
      }
    }
    const reset = roundsByBracket(current, 'grand_final_reset')[0].matches[0];
    expect(reset.teamAId).toBeTruthy();
    expect(reset.teamBId).toBeTruthy();
    current = play(current, reset.id, 21, 18);
    expect(getCompetitionChampion(current).id).toBe(reset.winnerTeamId);
  });

  it('termina sem reset quando o campeão invicto do Winners vence a Grand Final', () => {
    let current = deDraft(4, 'bracket_reset', 'sweep');
    const playable = () =>
      listCompetitionMatches(current).filter((match) => match.teamAId && match.teamBId && !match.winnerTeamId);
    while (playable().length > 0) {
      const next = playable()[0];
      const gf = roundsByBracket(current, 'grand_final')[0].matches[0];
      if (next.id === gf.id) {
        current = play(current, next.id, 21, 10);
      } else {
        current = play(current, next.id, 21, 15);
      }
    }
    const reset = roundsByBracket(current, 'grand_final_reset')[0].matches[0];
    expect(reset.teamAId).toBeNull();
    expect(reset.winnerTeamId).toBeNull();
    expect(getCompetitionChampion(current).id).toBe(roundsByBracket(current, 'grand_final')[0].matches[0].winnerTeamId);
    expect(getFinalMatch(current).id).toBe(roundsByBracket(current, 'grand_final')[0].matches[0].id);
  });

  it('single_final define o campeão na primeira Grand Final', () => {
    let current = deDraft(4, 'single_final', 'single');
    expect(roundsByBracket(current, 'grand_final_reset')).toHaveLength(0);
    const playable = () =>
      listCompetitionMatches(current).filter((match) => match.teamAId && match.teamBId && !match.winnerTeamId);
    while (playable().length > 0) {
      current = play(current, playable()[0].id, 21, 18);
    }
    expect(getCompetitionChampion(current)).toBeTruthy();
    expect(current.status).toBe('finished');
  });

  it('alteração retroativa limpa Grand Final e Losers dependentes', () => {
    let current = deDraft(4, 'bracket_reset', 'retro');
    const [wb1] = roundsByBracket(current, 'winners')[0].matches;
    const playable = () =>
      listCompetitionMatches(current).filter((match) => match.teamAId && match.teamBId && !match.winnerTeamId);
    while (playable().length > 0) {
      current = play(current, playable()[0].id, 21, 15);
    }
    const blocked = applyCompetitionMatchResult(current, wb1.id, {
      scoreA: 8,
      scoreB: 21,
      playedDate: '2026-09-18',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].code).toBe(COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED);
    const confirmed = applyCompetitionMatchResult(
      current,
      wb1.id,
      { scoreA: 8, scoreB: 21, playedDate: '2026-09-18' },
      { downstreamConfirmed: true }
    );
    expect(confirmed.ok).toBe(true);
    expect(getFinalMatch(confirmed.competition).winnerTeamId).toBeNull();
    expect(confirmed.competition.status).toBe('in_progress');
  });

  it('6 times em chave de 8 dão BYE aos seeds 1 e 2 sem partida estatística', () => {
    const competition = deDraft(6, 'bracket_reset', 'six');
    const wb1 = roundsByBracket(competition, 'winners')[0];
    expect(wb1.matches).toHaveLength(2);
    expect(wb1.matches.map((match) => [match.sourceA.seed, match.sourceB.seed])).toEqual([
      [4, 5],
      [3, 6],
    ]);
    expect(matchBetween(competition, 'team-1', 'team-2')).toBeUndefined();
    const semis = roundsByBracket(competition, 'winners')[1];
    expect(semis.matches[0].sourceA).toEqual({ type: 'seed', seed: 1 });
    expect(semis.matches[1].sourceA).toEqual({ type: 'seed', seed: 2 });
    const pendingReal = listCompetitionMatches(competition).filter(
      (match) => match.teamAId && match.teamBId
    );
    expect(pendingReal.every((match) => match.winnerTeamId == null)).toBe(true);
    expect(listCompetitionMatches(competition).some((match) => match.winnerTeamId && !match.playedDate)).toBe(false);
  });

  it('chave de 16 monta winners, losers e Grand Final sem hardcode', () => {
    const rounds = generateDoubleEliminationRounds(
      Array.from({ length: 16 }, (_, index) => `t${index + 1}`),
      { idGenerator: sequentialIds('sixteen') }
    );
    expect(rounds.filter((round) => round.bracket === 'winners')).toHaveLength(4);
    expect(rounds.filter((round) => round.bracket === 'losers').length).toBeGreaterThanOrEqual(4);
    expect(rounds.some((round) => round.bracket === 'grand_final')).toBe(true);
    expect(rounds.filter((round) => round.bracket === 'winners')[0].matches).toHaveLength(8);
  });
});
