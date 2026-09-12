const BYE = Symbol('bye');

function defaultIdGenerator() {
  return crypto.randomUUID();
}

function assertItemIds(items, { tooFew, invalidId, duplicateId }) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new Error(tooFew);
  }

  const ids = [];
  const seen = new Set();

  for (const item of items) {
    const id = item?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(invalidId);
    }
    if (seen.has(id)) {
      throw new Error(duplicateId);
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function assertPairs(pairs) {
  return assertItemIds(pairs, {
    tooFew: 'São necessárias pelo menos duas duplas para gerar o torneio.',
    invalidId: 'Todas as duplas precisam ter um ID válido.',
    duplicateId: 'As duplas precisam ter IDs distintos.',
  });
}

function assertTeams(items) {
  return assertItemIds(items, {
    tooFew: 'São necessários pelo menos dois times para gerar o torneio.',
    invalidId: 'Todos os times precisam ter um ID válido.',
    duplicateId: 'Os times precisam ter IDs distintos.',
  });
}

function nextGeneratedId(idGenerator, usedIds) {
  const id = idGenerator();
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('O gerador de IDs deve retornar uma string não vazia.');
  }
  if (usedIds.has(id)) {
    throw new Error('O gerador de IDs retornou um identificador repetido.');
  }
  usedIds.add(id);
  return id;
}

/**
 * Gera o calendário todos contra todos (método do círculo / Berger) só com IDs.
 * Não inclui placar, escalação nem campos V1. Não modifica `items`.
 *
 * @param {Array<{ id: string }>} items
 * @param {() => string} [idGenerator]
 * @returns {Array<{
 *   id: string,
 *   number: number,
 *   byeTeamId: string | null,
 *   matches: Array<{
 *     id: string,
 *     teamAId: string,
 *     teamBId: string
 *   }>
 * }>}
 */
export function generateRoundRobinSchedule(items, idGenerator = defaultIdGenerator) {
  const ids = assertTeams(items);

  if (typeof idGenerator !== 'function') {
    throw new Error('O gerador de IDs precisa ser uma função.');
  }

  const usedIds = new Set();
  const getId = () => nextGeneratedId(idGenerator, usedIds);
  const isOdd = ids.length % 2 === 1;
  const rotation = isOdd ? [...ids, BYE] : [...ids];
  const n = rotation.length;
  const roundCount = n - 1;
  const half = n / 2;
  const rounds = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const matches = [];
    let byeTeamId = null;

    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[n - 1 - i];

      if (home === BYE) {
        byeTeamId = away;
        continue;
      }
      if (away === BYE) {
        byeTeamId = home;
        continue;
      }

      matches.push({
        id: getId(),
        teamAId: home,
        teamBId: away,
      });
    }

    rounds.push({
      id: getId(),
      number: roundIndex + 1,
      byeTeamId,
      matches,
    });

    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }

  return rounds;
}

/**
 * Wrapper V1: mapeia o calendário genérico para duplas e placares nulos.
 * Não modifica `pairs` nem os objetos recebidos.
 *
 * @param {Array<{ id: string }>} pairs
 * @param {() => string} [idGenerator]
 * @returns {Array<{
 *   id: string,
 *   number: number,
 *   byePairId: string | null,
 *   matches: Array<{
 *     id: string,
 *     pairAId: string,
 *     pairBId: string,
 *     scoreA: null,
 *     scoreB: null
 *   }>
 * }>}
 */
export function generateRoundRobin(pairs, idGenerator = defaultIdGenerator) {
  assertPairs(pairs);
  return generateRoundRobinSchedule(pairs, idGenerator).map((round) => ({
    id: round.id,
    number: round.number,
    byePairId: round.byeTeamId,
    matches: round.matches.map((match) => ({
      id: match.id,
      pairAId: match.teamAId,
      pairBId: match.teamBId,
      scoreA: null,
      scoreB: null,
    })),
  }));
}
