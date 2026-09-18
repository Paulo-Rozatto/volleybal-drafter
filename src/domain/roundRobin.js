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

function pairingKey(leftId, rightId) {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

function compareMatches(left, right) {
  const leftKey = pairingKey(left.teamAId, left.teamBId);
  const rightKey = pairingKey(right.teamAId, right.teamBId);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

function teamIdsInMatches(matches) {
  const ids = new Set();
  for (const match of matches ?? []) {
    if (typeof match?.teamAId === 'string') ids.add(match.teamAId);
    if (typeof match?.teamBId === 'string') ids.add(match.teamBId);
  }
  return ids;
}

function overlapCount(matches, previousIds) {
  let count = 0;
  for (const id of teamIdsInMatches(matches)) {
    if (previousIds.has(id)) count += 1;
  }
  return count;
}

function combinations(items, size) {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const result = [];
  const chosen = [];
  const visit = (start) => {
    if (chosen.length === size) {
      result.push([...chosen]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index]);
      visit(index + 1);
      chosen.pop();
    }
  };
  visit(0);
  return result;
}

function optionKey(matches) {
  return [...matches]
    .map((match) => pairingKey(match.teamAId, match.teamBId))
    .sort()
    .join(',');
}

/**
 * Parte um emparelhamento (times disjuntos) em blocos de no máximo `courtCount`.
 * O primeiro bloco minimiza times que jogaram no bloco anterior.
 */
export function splitMatchingIntoBlocks(matches, courtCount, previousIds = new Set()) {
  if (!Number.isInteger(courtCount) || courtCount < 1) {
    throw Object.assign(new Error('A quantidade de quadras precisa ser um inteiro maior ou igual a 1.'), {
      code: 'COURT_COUNT_INVALID',
    });
  }

  const remaining = [...(matches ?? [])];
  if (remaining.length === 0) return [];
  if (remaining.length <= courtCount) return [remaining];

  const blocks = [];
  let previous = previousIds instanceof Set ? previousIds : new Set(previousIds);

  while (remaining.length > 0) {
    const size = Math.min(courtCount, remaining.length);
    const options = combinations(remaining, size);
    let best = options[0];
    let bestOverlap = overlapCount(best, previous);
    let bestKey = optionKey(best);

    for (const option of options) {
      const overlap = overlapCount(option, previous);
      const key = optionKey(option);
      if (overlap < bestOverlap || (overlap === bestOverlap && key < bestKey)) {
        best = option;
        bestOverlap = overlap;
        bestKey = key;
      }
    }

    const chosenKeys = new Set(best.map((match) => pairingKey(match.teamAId, match.teamBId)));
    const block = [...best].sort(compareMatches);
    blocks.push(block);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (chosenKeys.has(pairingKey(remaining[index].teamAId, remaining[index].teamBId))) {
        remaining.splice(index, 1);
      }
    }
    previous = teamIdsInMatches(block);
  }

  return blocks;
}

export function countBackToBackTeamPlays(blocks) {
  let count = 0;
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1]?.matches ?? blocks[index - 1];
    const current = blocks[index]?.matches ?? blocks[index];
    count += overlapCount(current, teamIdsInMatches(previous));
  }
  return count;
}

function buildCircleMatchings(ids) {
  const isOdd = ids.length % 2 === 1;
  const rotation = isOdd ? [...ids, BYE] : [...ids];
  const n = rotation.length;
  const roundCount = n - 1;
  const half = n / 2;
  const matchings = [];

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

      matches.push({ teamAId: home, teamBId: away });
    }

    matchings.push({ matches, byeTeamId });
    const last = rotation.pop();
    rotation.splice(1, 0, last);
  }

  return matchings;
}

function naiveSplitMatchings(matchings, courtCount) {
  return matchings.flatMap((matching) => {
    const blocks = [];
    for (let index = 0; index < matching.matches.length; index += courtCount) {
      blocks.push(matching.matches.slice(index, index + courtCount));
    }
    return blocks;
  });
}

export function packMatchingsIntoBlocks(matchings, courtCount) {
  const blocks = [];
  let previousIds = new Set();
  for (const matching of matchings ?? []) {
    const split = splitMatchingIntoBlocks(matching.matches, courtCount, previousIds);
    for (const matches of split) {
      blocks.push({ matches, byeTeamId: matching.byeTeamId ?? null });
      previousIds = teamIdsInMatches(matches);
    }
  }
  return blocks;
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
function assignBlockIds(blocks, idGenerator, { usedIds, startRoundNumber = 1 } = {}) {
  if (typeof idGenerator !== 'function') {
    throw new Error('O gerador de IDs precisa ser uma função.');
  }

  const used = new Set(usedIds ?? []);
  const getId = () => nextGeneratedId(idGenerator, used);
  const rounds = [];

  blocks.forEach((block, index) => {
    const matches = (block.matches ?? []).map((match) => ({
      id: getId(),
      teamAId: match.teamAId,
      teamBId: match.teamBId,
    }));
    rounds.push({
      id: getId(),
      number: startRoundNumber + index,
      byeTeamId: block.byeTeamId ?? null,
      matches,
    });
  });

  return rounds;
}

/**
 * Gera o calendário todos contra todos (método do círculo / Berger) só com IDs.
 * Não inclui placar, escalação nem campos V1. Não modifica `items`.
 *
 * @param {Array<{ id: string }>} items
 * @param {() => string} [idGenerator]
 * @param {{ usedIds?: Iterable<string>, startRoundNumber?: number }} [options]
 */
export function generateRoundRobinSchedule(items, idGenerator = defaultIdGenerator, options = {}) {
  const ids = assertTeams(items);
  const matchings = buildCircleMatchings(ids);
  return assignBlockIds(matchings, idGenerator, {
    usedIds: options.usedIds,
    startRoundNumber: options.startRoundNumber,
  });
}

/**
 * Reorganiza o todos-contra-todos em blocos de tempo com no máximo `courtCount` partidas.
 * Cada par de times se enfrenta exatamente uma vez. Não modifica `items`.
 *
 * @param {Array<{ id: string }>} items
 * @param {{
 *   courtCount: number,
 *   idGenerator?: () => string,
 *   usedIds?: Iterable<string>,
 *   startRoundNumber?: number
 * }} options
 */
export function generateBlockedRoundRobinSchedule(items, options = {}) {
  const { courtCount, idGenerator = defaultIdGenerator, usedIds, startRoundNumber = 1 } = options;
  if (!Number.isInteger(courtCount) || courtCount < 1) {
    throw Object.assign(
      new Error('A quantidade de quadras precisa ser um inteiro maior ou igual a 1.'),
      { code: 'COURT_COUNT_INVALID' }
    );
  }

  const ids = assertTeams(items);
  const matchings = buildCircleMatchings(ids);
  const blocks = packMatchingsIntoBlocks(matchings, courtCount);
  return assignBlockIds(blocks, idGenerator, { usedIds, startRoundNumber });
}

export function naiveBlockedRoundRobinSchedule(items, courtCount) {
  const ids = assertTeams(items);
  return naiveSplitMatchings(buildCircleMatchings(ids), courtCount).map((matches) => ({ matches }));
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
