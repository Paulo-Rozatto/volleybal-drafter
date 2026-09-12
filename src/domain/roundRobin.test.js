import { describe, expect, it } from 'vitest';
import { generateRoundRobin, generateRoundRobinSchedule } from './roundRobin.js';

function makePairs(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pair-${index + 1}`,
    members: [
      { playerId: `p-${index}-a`, playerName: `Jogador ${index}A` },
      { playerId: `p-${index}-b`, playerName: `Jogador ${index}B` },
    ],
  }));
}

function createIdGenerator() {
  let n = 0;
  return () => `id-${++n}`;
}

function matchKey(pairAId, pairBId) {
  return pairAId < pairBId ? `${pairAId}|${pairBId}` : `${pairBId}|${pairAId}`;
}

function expectedMatchCount(n) {
  return (n * (n - 1)) / 2;
}

function expectedRoundCount(n) {
  return n % 2 === 0 ? n - 1 : n;
}

function allMatches(rounds) {
  return rounds.flatMap((round) => round.matches);
}

function assertRoundRobinInvariants(pairs, rounds) {
  const n = pairs.length;
  const pairIds = pairs.map((pair) => pair.id);

  expect(rounds).toHaveLength(expectedRoundCount(n));
  expect(allMatches(rounds)).toHaveLength(expectedMatchCount(n));

  const pairingKeys = new Set();
  const roundIds = new Set();
  const matchIds = new Set();

  rounds.forEach((round, index) => {
    expect(round.number).toBe(index + 1);
    expect(round.id).toEqual(expect.any(String));
    expect(round.id.length).toBeGreaterThan(0);
    roundIds.add(round.id);

    const seenThisRound = new Set();

    round.matches.forEach((match) => {
      expect(match.pairAId).not.toBe(match.pairBId);
      expect(pairIds).toContain(match.pairAId);
      expect(pairIds).toContain(match.pairBId);
      expect(match.scoreA).toBeNull();
      expect(match.scoreB).toBeNull();
      expect(match.id).toEqual(expect.any(String));
      expect(match.id.length).toBeGreaterThan(0);
      matchIds.add(match.id);

      const key = matchKey(match.pairAId, match.pairBId);
      expect(pairingKeys.has(key)).toBe(false);
      pairingKeys.add(key);

      expect(seenThisRound.has(match.pairAId)).toBe(false);
      expect(seenThisRound.has(match.pairBId)).toBe(false);
      seenThisRound.add(match.pairAId);
      seenThisRound.add(match.pairBId);
    });

    if (n % 2 === 0) {
      expect(round.byePairId).toBeNull();
    } else {
      expect(pairIds).toContain(round.byePairId);
      expect(seenThisRound.has(round.byePairId)).toBe(false);
      seenThisRound.add(round.byePairId);
    }

    expect(seenThisRound.size).toBe(n);
  });

  expect(pairingKeys.size).toBe(expectedMatchCount(n));
  expect(roundIds.size).toBe(rounds.length);
  expect(matchIds.size).toBe(allMatches(rounds).length);
  expect(new Set([...roundIds, ...matchIds]).size).toBe(rounds.length + allMatches(rounds).length);

  if (n % 2 === 1) {
    const byes = rounds.map((round) => round.byePairId);
    expect(new Set(byes).size).toBe(n);
    expect([...byes].sort()).toEqual([...pairIds].sort());
  }
}

describe('generateRoundRobin', () => {
  [2, 3, 4, 5, 6, 7].forEach((n) => {
    it(`gera um todos-contra-todos válido para ${n} duplas`, () => {
      const pairs = makePairs(n);
      const rounds = generateRoundRobin(pairs, createIdGenerator());
      assertRoundRobinInvariants(pairs, rounds);
    });
  });

  it('não modifica o array nem os objetos recebidos', () => {
    const pairs = makePairs(4);
    const original = structuredClone(pairs);
    const firstPair = pairs[0];
    const firstMembers = pairs[0].members;

    generateRoundRobin(pairs, createIdGenerator());

    expect(pairs).toEqual(original);
    expect(pairs[0]).toBe(firstPair);
    expect(pairs[0].members).toBe(firstMembers);
  });

  it('usa somente os IDs das duplas nos confrontos', () => {
    const pairs = makePairs(3);
    const rounds = generateRoundRobin(pairs, createIdGenerator());
    const usedIds = rounds.flatMap((round) => [
      round.byePairId,
      ...round.matches.flatMap((match) => [match.pairAId, match.pairBId]),
    ]);

    usedIds.forEach((id) => {
      expect(pairs.some((pair) => pair.id === id)).toBe(true);
    });
    expect(JSON.stringify(rounds)).not.toContain('Jogador');
    expect(JSON.stringify(rounds)).not.toContain('playerName');
  });

  it('usa o gerador injetado para IDs de rodadas e partidas', () => {
    const rounds = generateRoundRobin(makePairs(2), createIdGenerator());
    expect(rounds[0].matches[0].id).toBe('id-1');
    expect(rounds[0].id).toBe('id-2');
  });

  it('rejeita zero duplas', () => {
    expect(() => generateRoundRobin([], createIdGenerator())).toThrow(
      'São necessárias pelo menos duas duplas para gerar o torneio.'
    );
  });

  it('rejeita uma dupla', () => {
    expect(() => generateRoundRobin(makePairs(1), createIdGenerator())).toThrow(
      'São necessárias pelo menos duas duplas para gerar o torneio.'
    );
  });

  it('rejeita IDs ausentes', () => {
    expect(() =>
      generateRoundRobin([{ id: 'a' }, { id: '' }], createIdGenerator())
    ).toThrow('Todas as duplas precisam ter um ID válido.');

    expect(() =>
      generateRoundRobin([{ id: 'a' }, {}], createIdGenerator())
    ).toThrow('Todas as duplas precisam ter um ID válido.');
  });

  it('rejeita ID de dupla contendo somente espaços', () => {
    expect(() =>
      generateRoundRobin([{ id: 'a' }, { id: '   ' }], createIdGenerator())
    ).toThrow('Todas as duplas precisam ter um ID válido.');
  });

  it('rejeita IDs duplicados', () => {
    expect(() =>
      generateRoundRobin([{ id: 'same' }, { id: 'same' }], createIdGenerator())
    ).toThrow('As duplas precisam ter IDs distintos.');
  });

  it('rejeita gerador que não é função', () => {
    expect(() => generateRoundRobin(makePairs(2), 'uuid')).toThrow(
      'O gerador de IDs precisa ser uma função.'
    );
  });

  it('rejeita ID gerado vazio', () => {
    expect(() => generateRoundRobin(makePairs(2), () => '')).toThrow(
      'O gerador de IDs deve retornar uma string não vazia.'
    );
  });

  it('rejeita ID gerado contendo somente espaços', () => {
    expect(() => generateRoundRobin(makePairs(2), () => '   ')).toThrow(
      'O gerador de IDs deve retornar uma string não vazia.'
    );
  });

  it('rejeita ID gerado que não é string', () => {
    expect(() => generateRoundRobin(makePairs(2), () => 1)).toThrow(
      'O gerador de IDs deve retornar uma string não vazia.'
    );
  });

  it('rejeita IDs gerados repetidos', () => {
    expect(() => generateRoundRobin(makePairs(2), () => 'same')).toThrow(
      'O gerador de IDs retornou um identificador repetido.'
    );
  });

  it('rejeita colisão entre ID de partida e ID de rodada', () => {
    const ids = ['match-1', 'match-2', 'match-1'];
    expect(() => generateRoundRobin(makePairs(4), () => ids.shift())).toThrow(
      'O gerador de IDs retornou um identificador repetido.'
    );
  });

  it('preserva o contrato V1 sem campos de time', () => {
    const rounds = generateRoundRobin(makePairs(3), createIdGenerator());
    const payload = JSON.stringify(rounds);

    expect(rounds[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        number: 1,
      })
    );
    expect(rounds[0]).toHaveProperty('byePairId');
    expect(rounds[0]).not.toHaveProperty('byeTeamId');
    expect(rounds[0].matches[0]).toEqual({
      id: expect.any(String),
      pairAId: expect.any(String),
      pairBId: expect.any(String),
      scoreA: null,
      scoreB: null,
    });
    expect(payload).not.toContain('teamAId');
    expect(payload).not.toContain('teamBId');
    expect(payload).not.toContain('byeTeamId');
    expect(payload).not.toContain('lineupA');
    expect(payload).not.toContain('lineupB');
  });
});

function makeTeams(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index + 1}`,
    extra: { label: `Time ${index + 1}` },
  }));
}

function scheduleMatchKey(teamAId, teamBId) {
  return teamAId < teamBId ? `${teamAId}|${teamBId}` : `${teamBId}|${teamAId}`;
}

function assertScheduleInvariants(teams, rounds) {
  const n = teams.length;
  const teamIds = teams.map((team) => team.id);

  expect(rounds).toHaveLength(expectedRoundCount(n));
  expect(allMatches(rounds)).toHaveLength(expectedMatchCount(n));

  const pairingKeys = new Set();
  const roundIds = new Set();
  const matchIds = new Set();

  rounds.forEach((round, index) => {
    expect(round.number).toBe(index + 1);
    expect(round.id).toEqual(expect.any(String));
    expect(round.id.length).toBeGreaterThan(0);
    roundIds.add(round.id);
    expect(round).not.toHaveProperty('byePairId');

    const seenThisRound = new Set();

    round.matches.forEach((match) => {
      expect(match.teamAId).not.toBe(match.teamBId);
      expect(teamIds).toContain(match.teamAId);
      expect(teamIds).toContain(match.teamBId);
      expect(match).not.toHaveProperty('scoreA');
      expect(match).not.toHaveProperty('scoreB');
      expect(match).not.toHaveProperty('lineupA');
      expect(match).not.toHaveProperty('lineupB');
      expect(match).not.toHaveProperty('pairAId');
      expect(match).not.toHaveProperty('pairBId');
      expect(match.id).toEqual(expect.any(String));
      expect(match.id.length).toBeGreaterThan(0);
      matchIds.add(match.id);

      const key = scheduleMatchKey(match.teamAId, match.teamBId);
      expect(pairingKeys.has(key)).toBe(false);
      pairingKeys.add(key);

      expect(seenThisRound.has(match.teamAId)).toBe(false);
      expect(seenThisRound.has(match.teamBId)).toBe(false);
      seenThisRound.add(match.teamAId);
      seenThisRound.add(match.teamBId);
    });

    if (n % 2 === 0) {
      expect(round.byeTeamId).toBeNull();
    } else {
      expect(teamIds).toContain(round.byeTeamId);
      expect(seenThisRound.has(round.byeTeamId)).toBe(false);
      seenThisRound.add(round.byeTeamId);
    }

    expect(seenThisRound.size).toBe(n);
  });

  expect(pairingKeys.size).toBe(expectedMatchCount(n));
  expect(roundIds.size).toBe(rounds.length);
  expect(matchIds.size).toBe(allMatches(rounds).length);
  expect(new Set([...roundIds, ...matchIds]).size).toBe(rounds.length + allMatches(rounds).length);

  if (n % 2 === 1) {
    const byes = rounds.map((round) => round.byeTeamId);
    expect(new Set(byes).size).toBe(n);
    expect([...byes].sort()).toEqual([...teamIds].sort());
  }
}

describe('generateRoundRobinSchedule', () => {
  [2, 3, 4, 5, 6, 7].forEach((n) => {
    it(`gera um todos-contra-todos válido para ${n} times`, () => {
      const teams = makeTeams(n);
      const rounds = generateRoundRobinSchedule(teams, createIdGenerator());
      assertScheduleInvariants(teams, rounds);
    });
  });

  it('não modifica o array nem os objetos recebidos', () => {
    const teams = makeTeams(4);
    const original = structuredClone(teams);
    const firstTeam = teams[0];
    const extra = teams[0].extra;

    generateRoundRobinSchedule(teams, createIdGenerator());

    expect(teams).toEqual(original);
    expect(teams[0]).toBe(firstTeam);
    expect(teams[0].extra).toBe(extra);
  });

  it('usa somente os IDs dos times e nunca expõe BYE', () => {
    const teams = makeTeams(3);
    const rounds = generateRoundRobinSchedule(teams, createIdGenerator());
    const usedIds = rounds.flatMap((round) => [
      round.byeTeamId,
      ...round.matches.flatMap((match) => [match.teamAId, match.teamBId]),
    ]);

    usedIds.forEach((id) => {
      expect(id === null || teams.some((team) => team.id === id)).toBe(true);
      expect(typeof id === 'symbol').toBe(false);
    });
    expect(JSON.stringify(rounds)).not.toContain('Time ');
    expect(JSON.stringify(rounds)).not.toContain('extra');
  });

  it('rejeita menos de dois times e IDs inválidos sem resultado parcial', () => {
    expect(() => generateRoundRobinSchedule([], createIdGenerator())).toThrow(
      'São necessários pelo menos dois times para gerar o torneio.'
    );
    expect(() => generateRoundRobinSchedule(makeTeams(1), createIdGenerator())).toThrow(
      'São necessários pelo menos dois times para gerar o torneio.'
    );
    expect(() => generateRoundRobinSchedule([{ id: 'a' }, { id: '   ' }], createIdGenerator())).toThrow(
      'Todos os times precisam ter um ID válido.'
    );
    expect(() => generateRoundRobinSchedule([{ id: 'same' }, { id: 'same' }], createIdGenerator())).toThrow(
      'Os times precisam ter IDs distintos.'
    );
  });

  it('rejeita gerador inválido e IDs gerados repetidos', () => {
    expect(() => generateRoundRobinSchedule(makeTeams(2), 'uuid')).toThrow(
      'O gerador de IDs precisa ser uma função.'
    );
    expect(() => generateRoundRobinSchedule(makeTeams(2), () => 'same')).toThrow(
      'O gerador de IDs retornou um identificador repetido.'
    );
  });
});
