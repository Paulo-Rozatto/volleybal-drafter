import { validateSessionPairs } from './sessionValidation.js';
import { calcTeamBalancePenalty } from './teamBalance.js';

function fail(errors) {
  return { ok: false, errors, pairs: null };
}

function snapshotName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function shuffleCopy(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
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
 *   balanceHeight?: boolean
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
  } = options;

  if (typeof idGenerator !== 'function') {
    return fail([
      {
        code: 'ID_GENERATOR_INVALID',
        message: 'O gerador de IDs precisa ser uma função.',
      },
    ]);
  }

  const totalIterations = Number.isInteger(iterations) && iterations > 0 ? iterations : 10000;
  let bestGroups = null;
  let minPenalty = Infinity;

  for (let round = 0; round < totalIterations; round += 1) {
    const shuffled = shuffleCopy(source, random);
    const teams = chunkPairs(shuffled);
    const penalty = calcTeamBalancePenalty(teams, { balanceGender, balanceHeight });
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestGroups = teams;
      if (minPenalty === 0) break;
    }
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
