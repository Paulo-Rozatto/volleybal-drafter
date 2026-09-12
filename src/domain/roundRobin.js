const BYE = Symbol('bye');

function defaultIdGenerator() {
  return crypto.randomUUID();
}

function assertPairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new Error('São necessárias pelo menos duas duplas para gerar o torneio.');
  }

  const ids = [];
  const seen = new Set();

  for (const pair of pairs) {
    const id = pair?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Todas as duplas precisam ter um ID válido.');
    }
    if (seen.has(id)) {
      throw new Error('As duplas precisam ter IDs distintos.');
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
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

function createMatch(pairAId, pairBId, getId) {
  return {
    id: getId(),
    pairAId,
    pairBId,
    scoreA: null,
    scoreB: null,
  };
}

/**
 * Gera rodadas de um torneio todos contra todos (método do círculo / Berger).
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
  const ids = assertPairs(pairs);

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
    let byePairId = null;

    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[n - 1 - i];

      if (home === BYE) {
        byePairId = away;
        continue;
      }
      if (away === BYE) {
        byePairId = home;
        continue;
      }

      matches.push(createMatch(home, away, getId));
    }

    rounds.push({
      id: getId(),
      number: roundIndex + 1,
      byePairId,
      matches,
    });

    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }

  return rounds;
}
