import { describe, expect, it } from 'vitest';
import {
  COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
  CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED,
  GENERATE_BRACKET_CONFIRMATION_REQUIRED,
  applyCompetitionMatchResult,
  clearCompetitionMatchResult,
  cloneCompetition,
  competitionByeCount,
  countPlayedMatches,
  createDraftCompetition,
  createEmptyCompetitionDocument,
  generateCompetitionBracket,
  getCompetitionChampion,
  getFinalMatch,
  isCompetitionFinished,
  listCompetitionMatches,
  listCompetitionRounds,
  nextPowerOfTwo,
  resolveCompetitionParticipants,
  seedBracketOrder,
  setDraftCompetitionTeams,
  validateCompetition,
  validateCompetitionDocument,
} from './competition.js';

const ISO = '2026-09-18T18:00:00.000Z';
const NOW = () => new Date(ISO);

function sequentialIds(prefix = 'id') {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function membersFor(index) {
  return [
    { playerId: `p${index}a`, playerName: `Jogador ${index}A` },
    { playerId: `p${index}b`, playerName: `Jogador ${index}B` },
  ];
}

function teamsForCount(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    members: membersFor(index + 1),
  }));
}

function draftWithTeams(count, options = {}) {
  const idGenerator = options.idGenerator ?? sequentialIds('c');
  const competition = createDraftCompetition(
    { name: `${count} times`, format: { teamSize: 2 } },
    { idGenerator, now: NOW }
  );
  const teams = setDraftCompetitionTeams(competition, teamsForCount(count), { idGenerator });
  expect(teams.ok).toBe(true);
  return teams.competition;
}

function generate(count, options = {}) {
  const idGenerator = options.idGenerator ?? sequentialIds(`b${count}`);
  const competition = draftWithTeams(count, { idGenerator });
  const result = generateCompetitionBracket(competition, {
    idGenerator,
    seedTeamIds: options.seedTeamIds,
  });
  expect(result.ok).toBe(true);
  return result.competition;
}

function play(competition, matchId, scoreA, scoreB, extras = {}) {
  return applyCompetitionMatchResult(
    competition,
    matchId,
    { scoreA, scoreB, playedDate: extras.playedDate ?? '2026-09-18' },
    extras
  );
}

function matchByTeams(competition, teamAId, teamBId) {
  return listCompetitionMatches(competition).find(
    (match) =>
      (match.teamAId === teamAId && match.teamBId === teamBId) ||
      (match.teamAId === teamBId && match.teamBId === teamAId)
  );
}

function sourcesOf(competition) {
  return listCompetitionMatches(competition).map((match) => ({
    id: match.id,
    round: listCompetitionRounds(competition).find((round) => round.id === match.roundId)?.name,
    sourceA: match.sourceA,
    sourceB: match.sourceB,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
  }));
}

describe('documento e rascunho', () => {
  it('cria documento vazio e competição draft com IDs injetáveis', () => {
    const document = createEmptyCompetitionDocument();
    expect(document).toEqual({ schemaVersion: 2, competitions: [] });
    expect(validateCompetitionDocument(document).ok).toBe(true);

    const competition = createDraftCompetition(
      { name: ' Open  ', format: { teamSize: 2 } },
      { idGenerator: sequentialIds('comp'), now: NOW }
    );
    expect(competition).toMatchObject({
      id: 'comp-1',
      name: 'Open',
      date: '2026-09-18',
      status: 'draft',
      createdAt: ISO,
      updatedAt: ISO,
      format: { teamSize: 2 },
      seedTeamIds: [],
      teams: [],
    });
    expect(competition.stages).toHaveLength(1);
    expect(competition.stages[0]).toMatchObject({
      type: 'single_elimination',
      status: 'pending',
      rounds: [],
    });
    expect(validateCompetition(competition).ok).toBe(true);
  });

  it('aceita data inicial explícita no rascunho', () => {
    const competition = createDraftCompetition(
      { name: 'Open', date: '2026-09-20', format: { teamSize: 2 } },
      { idGenerator: () => 'c-date', now: NOW }
    );
    expect(competition.date).toBe('2026-09-20');
    expect(validateCompetition(competition).ok).toBe(true);
  });

  it('preserva snapshot de nomes ao configurar times', () => {
    const competition = createDraftCompetition({ format: { teamSize: 2 } }, { now: NOW, idGenerator: sequentialIds('x') });
    const result = setDraftCompetitionTeams(competition, [
      {
        id: 'alpha',
        members: [
          { playerId: 'andre', playerName: 'André Antigo' },
          { playerId: 'ana', playerName: 'Ana Antiga' },
        ],
      },
      {
        members: [
          { playerId: 'bruno', playerName: 'Bruno' },
          { playerId: 'carla', playerName: 'Carla' },
        ],
      },
    ], { idGenerator: sequentialIds('t') });

    expect(result.ok).toBe(true);
    expect(result.competition.teams[0].members[0]).toEqual({
      playerId: 'andre',
      playerName: 'André Antigo',
    });
    expect(result.competition.teams[1].id).toBe('t-1');
  });

  it('não altera times depois que a chave existe', () => {
    const competition = generate(2);
    const result = setDraftCompetitionTeams(competition, teamsForCount(2));
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('COMPETITION_TEAMS_LOCKED');
  });
});

describe('chave de eliminação simples', () => {
  it('calcula potência de 2 e quantidade de BYEs', () => {
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(competitionByeCount(6)).toBe(2);
    expect(seedBracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('gera chave válida para %i times com n-1 partidas', (count) => {
    const competition = generate(count);
    const matches = listCompetitionMatches(competition);
    expect(matches).toHaveLength(count - 1);
    expect(competitionByeCount(count)).toBe(nextPowerOfTwo(count) - count);
    expect(matches.every((match) => match.scoreA === null && match.scoreB === null)).toBe(true);
    expect(matches.every((match) => match.winnerTeamId === null)).toBe(true);
    expect(isCompetitionFinished(competition)).toBe(false);
    expect(getCompetitionChampion(competition)).toBeNull();
  });

  it('2 times viram uma final direta', () => {
    const competition = generate(2);
    expect(listCompetitionRounds(competition)).toHaveLength(1);
    expect(listCompetitionRounds(competition)[0].name).toBe('Final');
    expect(listCompetitionMatches(competition)[0]).toMatchObject({
      sourceA: { type: 'seed', seed: 1 },
      sourceB: { type: 'seed', seed: 2 },
      teamAId: 'team-1',
      teamBId: 'team-2',
    });
  });

  it('3 times: um BYE na semifinal e a final espera o vencedor', () => {
    const competition = generate(3);
    expect(competitionByeCount(3)).toBe(1);
    expect(listCompetitionMatches(competition)).toHaveLength(2);
    const first = listCompetitionRounds(competition)[0].matches[0];
    expect(first).toMatchObject({
      sourceA: { type: 'seed', seed: 2 },
      sourceB: { type: 'seed', seed: 3 },
    });
    const final = getFinalMatch(competition);
    expect(final.sourceA).toEqual({ type: 'seed', seed: 1 });
    expect(final.sourceB).toEqual({ type: 'winner', matchId: first.id });
    expect(final.teamAId).toBe('team-1');
    expect(final.teamBId).toBeNull();
  });

  it('4 times: semifinais 1x4 e 2x3 alimentam a final', () => {
    const competition = generate(4);
    const [sf1, sf2] = listCompetitionRounds(competition)[0].matches;
    expect(sf1).toMatchObject({ teamAId: 'team-1', teamBId: 'team-4' });
    expect(sf2).toMatchObject({ teamAId: 'team-2', teamBId: 'team-3' });
    const final = getFinalMatch(competition);
    expect(final.sourceA).toEqual({ type: 'winner', matchId: sf1.id });
    expect(final.sourceB).toEqual({ type: 'winner', matchId: sf2.id });
    expect(matchByTeams(competition, 'team-1', 'team-2')).toBeUndefined();
    expect(matchByTeams(competition, 'team-1', 'team-3')).toBeUndefined();
  });

  it('6 times: 2 BYEs, D x E e C x F, semifinais recebem A e B', () => {
    const competition = generate(6);
    expect(competitionByeCount(6)).toBe(2);
    expect(listCompetitionMatches(competition)).toHaveLength(5);
    const firstRound = listCompetitionRounds(competition)[0].matches;
    expect(firstRound.map((match) => [match.teamAId, match.teamBId])).toEqual([
      ['team-4', 'team-5'],
      ['team-3', 'team-6'],
    ]);
    const [sf1, sf2] = listCompetitionRounds(competition)[1].matches;
    expect(sf1.sourceA).toEqual({ type: 'seed', seed: 1 });
    expect(sf1.sourceB).toEqual({ type: 'winner', matchId: firstRound[0].id });
    expect(sf2.sourceA).toEqual({ type: 'seed', seed: 2 });
    expect(sf2.sourceB).toEqual({ type: 'winner', matchId: firstRound[1].id });
    expect(getFinalMatch(competition).sourceA.type).toBe('winner');
    expect(getFinalMatch(competition).sourceB.type).toBe('winner');
  });

  it('não cria partida para BYE', () => {
    const competition = generate(5);
    expect(listCompetitionMatches(competition).some((match) => match.sourceA?.type === 'bye')).toBe(
      false
    );
    expect(sourcesOf(competition).every((item) => item.sourceA.type !== 'bye')).toBe(true);
    expect(countPlayedMatches(competition)).toBe(0);
  });
});

describe('progressão de resultados', () => {
  it('vencedor avança, perdedor não avança e a final define o campeão', () => {
    const competition = generate(4);
    const [sf1, sf2] = listCompetitionRounds(competition)[0].matches;
    const afterSf1 = play(competition, sf1.id, 21, 15);
    expect(afterSf1.ok).toBe(true);
    expect(listCompetitionRounds(afterSf1.competition)[0].matches[0].winnerTeamId).toBe('team-1');
    const finalAfterSf1 = getFinalMatch(afterSf1.competition);
    expect(finalAfterSf1.teamAId).toBe('team-1');
    expect(finalAfterSf1.teamBId).toBeNull();

    const afterSf2 = play(afterSf1.competition, sf2.id, 10, 21);
    expect(afterSf2.ok).toBe(true);
    expect(listCompetitionRounds(afterSf2.competition)[0].matches[1].winnerTeamId).toBe('team-3');
    const final = getFinalMatch(afterSf2.competition);
    expect(final.teamAId).toBe('team-1');
    expect(final.teamBId).toBe('team-3');
    expect(final.lineupB.map((member) => member.playerName)).toEqual(['Jogador 3A', 'Jogador 3B']);

    const finished = play(afterSf2.competition, final.id, 21, 18);
    expect(finished.ok).toBe(true);
    expect(finished.competition.status).toBe('finished');
    expect(isCompetitionFinished(finished.competition)).toBe(true);
    expect(getCompetitionChampion(finished.competition)).toMatchObject({
      id: 'team-1',
      members: [
        { playerId: 'p1a', playerName: 'Jogador 1A' },
        { playerId: 'p1b', playerName: 'Jogador 1B' },
      ],
    });
    expect(countPlayedMatches(finished.competition)).toBe(3);
  });

  it('semifinal de 3 times alimenta a final e o BYE não vira vitória estatística', () => {
    const competition = generate(3);
    const opener = listCompetitionRounds(competition)[0].matches[0];
    const afterOpen = play(competition, opener.id, 21, 8);
    expect(countPlayedMatches(afterOpen.competition)).toBe(1);
    const final = getFinalMatch(afterOpen.competition);
    expect(final.teamAId).toBe('team-1');
    expect(final.teamBId).toBe('team-2');
    const finished = play(afterOpen.competition, final.id, 15, 21);
    expect(getCompetitionChampion(finished.competition).id).toBe('team-2');
    expect(countPlayedMatches(finished.competition)).toBe(2);
  });

  it('rejeita empate e placar parcial', () => {
    const competition = generate(2);
    const matchId = listCompetitionMatches(competition)[0].id;
    expect(play(competition, matchId, 21, 21).errors[0].code).toBe('SCORE_TIE');
    expect(play(competition, matchId, 21, null).errors[0].code).toBe('SCORE_PARTIAL');
    expect(play(competition, matchId, null, 10).errors[0].code).toBe('SCORE_PARTIAL');
  });

  it('não registra resultado enquanto o adversário da chave não foi resolvido', () => {
    const competition = generate(3);
    const finalId = getFinalMatch(competition).id;
    const result = play(competition, finalId, 21, 15);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('COMPETITION_MATCH_TEAMS_UNRESOLVED');
  });
});

describe('alteração retroativa de vencedor', () => {
  function playedFourTeamBracket() {
    const competition = generate(4);
    const [sf1, sf2] = listCompetitionRounds(competition)[0].matches;
    const after1 = play(competition, sf1.id, 21, 10);
    const after2 = play(after1.competition, sf2.id, 21, 15);
    const finalId = getFinalMatch(after2.competition).id;
    const finished = play(after2.competition, finalId, 21, 18);
    return { competition: finished.competition, sf1, sf2, finalId };
  }

  it('exige confirmação e limpa descendentes quando o vencedor muda', () => {
    const { competition, sf1, finalId } = playedFourTeamBracket();
    const blocked = play(competition, sf1.id, 10, 21);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0].code).toBe(COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED);
    expect(blocked.errors[0].affectedMatchIds).toEqual([finalId]);
    expect(getFinalMatch(competition).scoreA).toBe(21);

    const confirmed = play(competition, sf1.id, 10, 21, { downstreamConfirmed: true });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.competition.status).toBe('in_progress');
    expect(getFinalMatch(confirmed.competition)).toMatchObject({
      teamAId: 'team-4',
      teamBId: 'team-2',
      scoreA: null,
      scoreB: null,
      winnerTeamId: null,
      playedDate: null,
    });
    expect(getCompetitionChampion(confirmed.competition)).toBeNull();
    expect(listCompetitionRounds(confirmed.competition)[0].matches[0].winnerTeamId).toBe('team-4');
  });

  it('não apaga a final se o vencedor da semifinal permanece o mesmo', () => {
    const { competition, sf1, finalId } = playedFourTeamBracket();
    const updated = play(competition, sf1.id, 25, 10);
    expect(updated.ok).toBe(true);
    expect(getFinalMatch(updated.competition)).toMatchObject({
      id: finalId,
      scoreA: 21,
      scoreB: 18,
      winnerTeamId: 'team-1',
    });
    expect(updated.competition.status).toBe('finished');
  });

  it('limpa descendentes ao remover um resultado com confirmação', () => {
    const { competition, sf1, finalId } = playedFourTeamBracket();
    const blocked = clearCompetitionMatchResult(competition, sf1.id);
    expect(blocked.errors[0].code).toBe(CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED);
    expect(blocked.errors[0].affectedMatchIds).toContain(finalId);

    const cleared = clearCompetitionMatchResult(competition, sf1.id, { clearConfirmed: true });
    expect(cleared.ok).toBe(true);
    expect(listCompetitionRounds(cleared.competition)[0].matches[0].winnerTeamId).toBeNull();
    expect(getFinalMatch(cleared.competition)).toMatchObject({
      teamAId: null,
      scoreA: null,
      winnerTeamId: null,
    });
    expect(cleared.competition.status).toBe('in_progress');
  });
});

describe('fontes winner/loser e snapshots', () => {
  it('resolve origem do tipo loser sem gerar chave de consolação', () => {
    const base = generate(4);
    const [sf1] = listCompetitionRounds(base)[0].matches;
    const after = play(base, sf1.id, 21, 15);
    const handmade = cloneCompetition(after.competition);
    handmade.stages[0].rounds.push({
      id: 'consolation-round',
      number: 3,
      name: 'Consolação',
      bracket: 'losers',
      matches: [
        {
          id: 'consolation-1',
          roundId: 'consolation-round',
          sourceA: { type: 'loser', matchId: sf1.id },
          sourceB: { type: 'team', teamId: 'team-3' },
          teamAId: null,
          teamBId: null,
          lineupA: [],
          lineupB: [],
          scoreA: null,
          scoreB: null,
          playedDate: null,
          winnerTeamId: null,
        },
      ],
      byes: [],
    });
    handmade.status = 'in_progress';
    const resolved = resolveCompetitionParticipants(handmade);
    const consolation = listCompetitionRounds(resolved).at(-1).matches[0];
    expect(consolation.teamAId).toBe('team-4');
    expect(consolation.teamBId).toBe('team-3');
  });

  it('mantém nomes históricos nas escalações depois de gerar a chave', () => {
    const competition = generate(2);
    const match = listCompetitionMatches(competition)[0];
    expect(match.lineupA[0]).toEqual({ playerId: 'p1a', playerName: 'Jogador 1A' });
    const renamedRosterAttempt = cloneCompetition(competition);
    renamedRosterAttempt.teams[0].members[0].playerName = 'Nome Novo';
    expect(listCompetitionMatches(competition)[0].lineupA[0].playerName).toBe('Jogador 1A');
  });

  it('pede confirmação para regenerar a chave', () => {
    const competition = generate(2);
    const blocked = generateCompetitionBracket(competition);
    expect(blocked.errors[0].code).toBe(GENERATE_BRACKET_CONFIRMATION_REQUIRED);
    const regenerated = generateCompetitionBracket(competition, {
      generateConfirmed: true,
      idGenerator: sequentialIds('again'),
    });
    expect(regenerated.ok).toBe(true);
    expect(listCompetitionRounds(regenerated.competition)[0].id).toBe('again-1');
  });

  it('rejeita schema de documento inválido', () => {
    expect(validateCompetitionDocument({ schemaVersion: 9, competitions: [] }).errors[0].code).toBe(
      'SCHEMA_VERSION_UNSUPPORTED'
    );
  });
});
