import { validateSessionPairs } from './sessionValidation.js';
import { calcTeamBalancePenalty } from './teamBalance.js';

function fail(errors) {
  return { ok: false, errors, pairs: null };
}

function snapshotName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function error(code, message) {
  return { code, message };
}

function pairKey(leftId, rightId) {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

function deviationSquareSum(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
}

function readRepeatCount(history, leftId, rightId) {
  if (history == null || leftId === rightId) return 0;
  const value = history.count(leftId, rightId);
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Aceita `null`, um Map `"idA|idB" → n` ou `{ count(a, b) }`.
 * Não muta a estrutura recebida.
 */
export function normalizePartnershipRepeats(partnershipRepeats) {
  if (partnershipRepeats == null) return null;

  if (typeof partnershipRepeats.count === 'function') {
    return partnershipRepeats;
  }

  if (partnershipRepeats instanceof Map) {
    return {
      count(leftId, rightId) {
        if (typeof leftId !== 'string' || typeof rightId !== 'string' || leftId === rightId) {
          return 0;
        }
        const value = Number(partnershipRepeats.get(pairKey(leftId, rightId)));
        return Number.isFinite(value) && value > 0 ? value : 0;
      },
    };
  }

  throw Object.assign(new Error('O histórico de parcerias é inválido.'), {
    code: 'PARTNERSHIP_HISTORY_INVALID',
  });
}

function pairRepeatCounts(groups, history) {
  return (groups ?? []).map((group) => {
    const leftId = group?.[0]?.id;
    const rightId = group?.[1]?.id;
    if (typeof leftId !== 'string' || typeof rightId !== 'string') return 0;
    return readRepeatCount(history, leftId, rightId);
  });
}

/**
 * Métrica explícita de um conjunto de duplas.
 * Ordem de comparação: maxRepeat, repeatSum, repeatSpread, balancePenalty.
 */
export function scorePairing(groups, options = {}) {
  const history = normalizePartnershipRepeats(options.partnershipRepeats ?? null);
  const repeats = pairRepeatCounts(groups, history);
  const maxRepeat = repeats.reduce((max, value) => (value > max ? value : max), 0);
  const repeatSum = repeats.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    maxRepeat,
    repeatSum,
    repeatSpread: deviationSquareSum(repeats),
    balancePenalty: calcTeamBalancePenalty(groups, {
      balanceGender: options.balanceGender ?? true,
      balanceHeight: options.balanceHeight ?? true,
    }),
  });
}

export function comparePairingScores(left, right) {
  if (left.maxRepeat !== right.maxRepeat) return left.maxRepeat - right.maxRepeat;
  if (left.repeatSum !== right.repeatSum) return left.repeatSum - right.repeatSum;
  if (left.repeatSpread !== right.repeatSpread) return left.repeatSpread - right.repeatSpread;
  return left.balancePenalty - right.balancePenalty;
}

export function isPerfectPairingScore(score) {
  return score.maxRepeat === 0 && score.balancePenalty === 0;
}

function readRandomUnit(random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw Object.assign(
      new Error(
        'O gerador aleatório precisa retornar um número finito maior ou igual a 0 e menor que 1.'
      ),
      { code: 'RANDOM_INVALID' }
    );
  }
  return value;
}

function shuffleCopy(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(readRandomUnit(random) * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapWith];
    copy[swapWith] = current;
  }
  return copy;
}

function chunkPairs(players) {
  const teams = [];
  for (let index = 0; index < players.length; index += 2) {
    teams.push([players[index], players[index + 1]]);
  }
  return teams;
}

function nextPairId(idGenerator, usedIds) {
  if (typeof idGenerator !== 'function') {
    throw new Error('O gerador de IDs precisa ser uma função.');
  }
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

function assertPlayers(players) {
  if (!Array.isArray(players)) {
    return fail([
      {
        code: 'TOO_FEW_PLAYERS',
        message: 'Selecione pelo menos quatro jogadores para sortear duplas.',
      },
    ]);
  }

  if (players.length % 2 === 1) {
    return fail([
      {
        code: 'ODD_PLAYER_COUNT',
        message: 'Selecione uma quantidade par de jogadores. Adicione ou remova uma pessoa.',
      },
    ]);
  }

  if (players.length < 4) {
    return fail([
      {
        code: 'TOO_FEW_PLAYERS',
        message: 'Selecione pelo menos quatro jogadores para sortear duplas.',
      },
    ]);
  }

  const seen = new Set();
  for (const player of players) {
    const id = player?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      return fail([
        {
          code: 'PLAYER_ID_INVALID',
          message: 'Todos os jogadores selecionados precisam ter um ID válido.',
        },
      ]);
    }
    if (seen.has(id)) {
      return fail([
        {
          code: 'PLAYER_ID_DUPLICATE',
          message: 'Há jogadores repetidos na seleção do sorteio.',
        },
      ]);
    }
    seen.add(id);
  }

  return null;
}

/**
 * Sorteia duplas de 2 jogadores sem banco, usando Monte Carlo e a penalidade compartilhada.
 *
 * @param {Array<{ id: string, name?: string, score?: number, gender?: string, height?: string }>} players
 * @param {{
 *   idGenerator?: () => string,
 *   random?: () => number,
 *   iterations?: number,
 *   balanceGender?: boolean,
 *   balanceHeight?: boolean,
 *   partnershipRepeats?: Map<string, number> | { count: (a: string, b: string) => number } | null
 * }} [options]
 */
export function generateBalancedPairs(players, options = {}) {
  const source = Array.isArray(players) ? players : [];
  const invalid = assertPlayers(source);
  if (invalid) return invalid;

  const {
    idGenerator = () => crypto.randomUUID(),
    random = Math.random,
    iterations = 10000,
    balanceGender = true,
    balanceHeight = true,
    partnershipRepeats = null,
  } = options;

  if (typeof idGenerator !== 'function') {
    return fail([error('ID_GENERATOR_INVALID', 'O gerador de IDs precisa ser uma função.')]);
  }
  if (typeof random !== 'function') {
    return fail([error('RANDOM_INVALID', 'O gerador aleatório precisa ser uma função.')]);
  }

  let history;
  try {
    history = normalizePartnershipRepeats(partnershipRepeats);
  } catch (caught) {
    if (caught?.code === 'PARTNERSHIP_HISTORY_INVALID') {
      return fail([error('PARTNERSHIP_HISTORY_INVALID', caught.message)]);
    }
    throw caught;
  }

  const totalIterations = Number.isInteger(iterations) && iterations > 0 ? iterations : 10000;
  const scoring = { partnershipRepeats: history, balanceGender, balanceHeight };
  let bestGroups = null;
  let bestScore = null;

  try {
    for (let round = 0; round < totalIterations; round += 1) {
      const shuffled = shuffleCopy(source, random);
      const teams = chunkPairs(shuffled);
      const score = scorePairing(teams, scoring);
      if (!bestScore || comparePairingScores(score, bestScore) < 0) {
        bestScore = score;
        bestGroups = teams;
        if (isPerfectPairingScore(score)) break;
      }
    }
  } catch (caught) {
    if (caught?.code === 'RANDOM_INVALID') {
      return fail([error('RANDOM_INVALID', caught.message)]);
    }
    throw caught;
  }

  const usedIds = new Set();
  const pairs = [];

  try {
    for (const [first, second] of bestGroups) {
      pairs.push({
        id: nextPairId(idGenerator, usedIds),
        members: [
          { playerId: first.id, playerName: snapshotName(first.name) },
          { playerId: second.id, playerName: snapshotName(second.name) },
        ],
      });
    }
  } catch (error) {
    return fail([
      {
        code: 'PAIR_ID_INVALID',
        message: error.message || 'Não foi possível gerar identificadores únicos para as duplas.',
      },
    ]);
  }

  const validation = validateSessionPairs(pairs, source);
  if (!validation.ok) return fail(validation.errors);

  return { ok: true, errors: [], pairs };
}
