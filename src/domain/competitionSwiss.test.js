import { describe, expect, it } from 'vitest';
import {
  applyCompetitionMatchResult,
  createDraftCompetition,
  freezeSwissSeedSnapshot,
  generateCompetitionBracket,
  getSwissStandings,
  listCompetitionMatches,
  listCompetitionRounds,
  seedBracketOrder,
  setDraftCompetitionTeams,
} from './competition.js';
import { pairFirstSwissRound, selectSwissBye, swissByeHistory } from './competitionSwiss.js';

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

function swissDraft(count, roundCount, idPrefix = 's') {
  const ids = sequentialIds(idPrefix);
  const competition = createDraftCompetition(
    {
      name: 'Suíço',
      format: { teamSize: 2 },
      stages: [{ type: 'swiss', config: { roundCount } }],
    },
    { idGenerator: ids, now: NOW }
  );
  const withTeams = setDraftCompetitionTeams(competition, teamsFor(count), { idGenerator: ids });
  expect(withTeams.ok).toBe(true);
  return { competition: withTeams.competition, ids };
}

function startSwiss(count, roundCount, idPrefix = 's') {
  const { competition, ids } = swissDraft(count, roundCount, idPrefix);
  const generated = generateCompetitionBracket(competition, {
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

function playRound(competition, results) {
  let current = competition;
  const round = listCompetitionRounds(current).at(-1);
  round.matches.forEach((match, index) => {
    const [scoreA, scoreB] = results[index];
    current = play(current, match.id, scoreA, scoreB);
  });
  return current;
}

describe('distribuição de seeds', () => {
  it('gera 1×8, 4×5, 2×7 e 3×6 para chave de 8', () => {
    const order = seedBracketOrder(8);
    const pairs = [];
    for (let index = 0; index < order.length; index += 2) {
      pairs.push([order[index], order[index + 1]]);
    }
    expect(pairs).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });
});

describe('sistema suíço', () => {
  it('pareia a primeira rodada pela ordem de seed e dá BYE ao último em número ímpar', () => {
    const even = pairFirstSwissRound(['team-1', 'team-2', 'team-3', 'team-4']);
    expect(even).toEqual({
      pairs: [
        ['team-1', 'team-2'],
        ['team-3', 'team-4'],
      ],
      byeTeamId: null,
    });
    const odd = pairFirstSwissRound(['team-1', 'team-2', 'team-3']);
    expect(odd.byeTeamId).toBe('team-3');
    expect(odd.pairs).toEqual([['team-1', 'team-2']]);
  });

  it('não gera a segunda rodada enquanto a atual estiver incompleta', () => {
    const started = startSwiss(4, 3);
    expect(listCompetitionRounds(started)).toHaveLength(1);
    const blocked = generateCompetitionBracket(started);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].code).toBe('SWISS_ROUND_INCOMPLETE');
  });

  it('calcula standings, saldo, Buchholz e desempates determinísticos', () => {
    let current = startSwiss(4, 2, 'st');
    current = playRound(current, [
      [21, 10],
      [21, 18],
    ]);
    const standings = getSwissStandings(current.stages[0], current.stages[0].seedTeamIds);
    expect(standings.map((row) => row.teamId)).toEqual(['team-1', 'team-3', 'team-4', 'team-2']);
    expect(standings[0]).toMatchObject({
      played: 1,
      wins: 1,
      losses: 0,
      byes: 0,
      pointsFor: 21,
      pointsAgainst: 10,
      pointDifference: 11,
      buchholz: 0,
    });
    expect(standings[1]).toMatchObject({
      wins: 1,
      pointsFor: 21,
      pointsAgainst: 18,
      pointDifference: 3,
      buchholz: 0,
    });
  });

  it('agrupa campanhas semelhantes e evita rematch quando possível', () => {
    let current = startSwiss(4, 2, 'pair');
    current = playRound(current, [
      [21, 10],
      [21, 18],
    ]);
    expect(listCompetitionRounds(current)).toHaveLength(2);
    const round2 = listCompetitionRounds(current)[1];
    const pairs = round2.matches.map((match) => [match.teamAId, match.teamBId]);
    expect(pairs).toEqual([['team-1', 'team-3'], ['team-4', 'team-2']]);
    const firstRoundKey = new Set(
      listCompetitionRounds(current)[0].matches.map((match) => `${match.teamAId}|${match.teamBId}`)
    );
    for (const [left, right] of pairs) {
      expect(firstRoundKey.has(`${left}|${right}`)).toBe(false);
      expect(firstRoundKey.has(`${right}|${left}`)).toBe(false);
    }
  });

  it('concede BYE de classificação sem partida e não repete BYE enquanto houver candidato sem BYE', () => {
    let current = startSwiss(3, 2, 'odd');
    const round1 = listCompetitionRounds(current)[0];
    expect(round1.byes).toEqual([{ teamId: 'team-3' }]);
    expect(round1.matches).toHaveLength(1);
    current = playRound(current, [[21, 15]]);
    const standings = getSwissStandings(current.stages[0], current.stages[0].seedTeamIds);
    expect(standings.find((row) => row.teamId === 'team-3')).toMatchObject({
      played: 0,
      wins: 1,
      byes: 1,
      buchholz: 0,
    });
    const round2 = listCompetitionRounds(current)[1];
    expect(round2.byes[0].teamId).not.toBe('team-3');
    const history = swissByeHistory(current.stages[0]);
    expect([...history.values()].every((count) => count <= 1)).toBe(true);
    expect(selectSwissBye(standings, history)).not.toBe('team-3');
  });

  it('congela seedSnapshot na ordem da classificação ao terminar as rodadas', () => {
    let current = startSwiss(4, 1, 'snap');
    current = playRound(current, [
      [21, 10],
      [15, 21],
    ]);
    expect(current.stages[0].status).toBe('finished');
    const snapshot = freezeSwissSeedSnapshot(
      getSwissStandings(current.stages[0], current.stages[0].seedTeamIds)
    );
    expect(current.stages[0].seedSnapshot).toEqual(snapshot);
    expect(snapshot[0]).toMatchObject({
      seed: 1,
      teamId: 'team-1',
      wins: 1,
    });
    expect(snapshot.map((row) => row.seed)).toEqual([1, 2, 3, 4]);
  });

  it('calcula Buchholz com as vitórias atuais dos adversários reais', () => {
    let current = startSwiss(4, 2, 'bh');
    current = playRound(current, [
      [21, 10],
      [21, 18],
    ]);
    current = playRound(current, [
      [21, 12],
      [21, 10],
    ]);
    const standings = getSwissStandings(current.stages[0], current.stages[0].seedTeamIds);
    expect(standings.map((row) => row.teamId)).toEqual(['team-1', 'team-3', 'team-4', 'team-2']);
    expect(standings.find((row) => row.teamId === 'team-1')).toMatchObject({
      wins: 2,
      buchholz: 1,
      pointDifference: 20,
    });
    expect(standings.find((row) => row.teamId === 'team-3')).toMatchObject({
      wins: 1,
      buchholz: 3,
    });
    expect(standings.find((row) => row.teamId === 'team-4')).toMatchObject({
      wins: 1,
      buchholz: 1,
    });
  });

  it('congela seeds e usa os melhores na chave seguinte com BYEs', () => {
    const ids = sequentialIds('bridge');
    const draft = createDraftCompetition(
      {
        name: 'Suíço + DE',
        format: { teamSize: 2 },
        stages: [
          { type: 'swiss', config: { roundCount: 1 } },
          { type: 'double_elimination', config: { grandFinalMode: 'bracket_reset' } },
        ],
      },
      { idGenerator: ids, now: NOW }
    );
    const withTeams = setDraftCompetitionTeams(draft, teamsFor(6), { idGenerator: ids });
    let current = generateCompetitionBracket(withTeams.competition, {
      seedTeamIds: teamsFor(6).map((team) => team.id),
      idGenerator: ids,
    }).competition;
    current = playRound(current, [
      [21, 10],
      [21, 12],
      [21, 19],
    ]);
    expect(current.stages[0].seedSnapshot.map((row) => row.teamId)).toEqual([
      'team-1',
      'team-3',
      'team-5',
      'team-6',
      'team-4',
      'team-2',
    ]);
    const nextStage = generateCompetitionBracket(current, { idGenerator: ids });
    expect(nextStage.ok).toBe(true);
    const wb1 = nextStage.competition.stages[1].rounds.find(
      (round) => round.bracket === 'winners' && round.number === 1
    );
    expect(wb1.matches.map((match) => [match.sourceA.seed, match.sourceB.seed])).toEqual([
      [4, 5],
      [3, 6],
    ]);
    const semis = nextStage.competition.stages[1].rounds.find(
      (round) => round.bracket === 'winners' && round.number === 2
    );
    expect(semis.matches[0].sourceA).toEqual({ type: 'seed', seed: 1 });
    expect(semis.matches[1].sourceA).toEqual({ type: 'seed', seed: 2 });
  });

  it('trata rodadas posteriores como downstream ao alterar um placar antigo', () => {
    let current = startSwiss(4, 2, 'down');
    current = playRound(current, [
      [21, 10],
      [21, 18],
    ]);
    expect(listCompetitionRounds(current)).toHaveLength(2);
    const firstMatch = listCompetitionMatches(current)[0];
    const blocked = applyCompetitionMatchResult(current, firstMatch.id, {
      scoreA: 8,
      scoreB: 21,
      playedDate: '2026-09-18',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].code).toBe('COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED');
    const confirmed = applyCompetitionMatchResult(
      current,
      firstMatch.id,
      { scoreA: 8, scoreB: 21, playedDate: '2026-09-18' },
      { downstreamConfirmed: true }
    );
    expect(confirmed.ok).toBe(true);
    expect(listCompetitionRounds(confirmed.competition)).toHaveLength(1);
    expect(confirmed.competition.stages[0].seedSnapshot).toBeNull();
  });
});
