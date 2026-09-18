import { calcTeamBalancePenalty } from './teamBalance.js';
import { validateFormat, validateSessionTeams } from './teamSession.js';
import {
  comparePairingScores,
  isPerfectPairingScore,
  normalizePartnershipRepeats,
  scorePairing,
} from './balancedPairs.js';

function fail(errors) {
  return {
    ok: false,
    errors,
    teams: null,
    penalty: null,
    selectedCount: null,
    teamSizes: null,
  };
}

function error(code, message) {
  return { code, message };
}

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function snapshotName(name) {
  return typeof name === 'string' ? name.trim() : '';
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

function splitBySizes(players, sizes) {
  const groups = [];
  let offset = 0;
  for (const size of sizes) {
    groups.push(players.slice(offset, offset + size));
    offset += size;
  }
  return groups;
}

function nextTeamId(idGenerator, usedIds) {
  const id = idGenerator();
  if (!isNonEmptyId(id)) {
    throw Object.assign(new Error('O time precisa de um ID válido.'), { code: 'TEAM_ID_INVALID' });
  }
  if (usedIds.has(id)) {
    throw Object.assign(new Error('Já existe um time com este ID neste encontro.'), {
      code: 'TEAM_ID_DUPLICATE',
    });
  }
  usedIds.add(id);
  return id;
}

function playerCountError(selectedCount, format, bounds) {
  if (format.teamSize === 2) {
    return error(
      'PLAYER_COUNT_INVALID',
      `Selecione exatamente ${bounds.min} jogadores para formar ${format.teamCount} duplas.`
    );
  }
  if (selectedCount < bounds.min) {
    return error(
      'TOO_FEW_PLAYERS',
      `Selecione pelo menos ${bounds.min} jogadores para sortear ${format.teamCount} times.`
    );
  }
  return error('TOO_MANY_PLAYERS', `Este formato comporta até ${bounds.max} jogadores.`);
}

/**
 * Limites de quantidade para o sorteio automático sem banco.
 *
 * 2x2 exige duplas completas: exatamente `teamCount * 2`.
 * 3x3–6x6: `teamCount <= selecionados <= teamSize * teamCount`.
 */
export function automaticDrawCountBounds(format) {
  const formatResult = validateFormat(format);
  if (!formatResult.ok) {
    return { ok: false, errors: formatResult.errors, min: null, max: null };
  }

  if (format.teamSize === 2) {
    const exact = format.teamCount * 2;
    return { ok: true, errors: [], min: exact, max: exact };
  }

  return {
    ok: true,
    errors: [],
    min: format.teamCount,
    max: format.teamSize * format.teamCount,
  };
}

/**
 * Tamanhos-alvo que diferem no máximo em um jogador, sem ultrapassar `teamSize`.
 * Times maiores vêm primeiro (ex.: 16 em 3 times 6x6 → 6/5/5).
 */
export function computeTeamSizeDistribution(selectedCount, format) {
  const bounds = automaticDrawCountBounds(format);
  if (!bounds.ok) {
    return { ok: false, errors: bounds.errors, sizes: null };
  }

  if (!Number.isInteger(selectedCount)) {
    return { ok: false, errors: [playerCountError(selectedCount, format, bounds)], sizes: null };
  }

  if (selectedCount < bounds.min || selectedCount > bounds.max) {
    return { ok: false, errors: [playerCountError(selectedCount, format, bounds)], sizes: null };
  }

  const base = Math.floor(selectedCount / format.teamCount);
  const remainder = selectedCount % format.teamCount;
  const sizes = Array.from({ length: format.teamCount }, (_, index) =>
    index < remainder ? base + 1 : base
  );

  return { ok: true, errors: [], sizes };
}

function assertPlayers(players) {
  if (!Array.isArray(players)) {
    return fail([
      error('TOO_FEW_PLAYERS', 'Selecione pelo menos os jogadores mínimos para sortear os times.'),
    ]);
  }

  const seen = new Set();
  for (const player of players) {
    const id = player?.id;
    if (!isNonEmptyId(id)) {
      return fail([
        error('PLAYER_ID_INVALID', 'Todos os jogadores selecionados precisam ter um ID válido.'),
      ]);
    }
    if (seen.has(id)) {
      return fail([
        error('PLAYER_ID_DUPLICATE', 'Há jogadores repetidos na seleção do sorteio.'),
      ]);
    }
    seen.add(id);

    if (snapshotName(player?.name).length === 0) {
      return fail([
        error('PLAYER_NAME_INVALID', 'Todos os jogadores selecionados precisam ter um nome válido.'),
      ]);
    }

    if (typeof player?.score !== 'number' || !Number.isFinite(player.score)) {
      return fail([
        error(
          'PLAYER_SCORE_INVALID',
          'Todos os jogadores selecionados precisam ter um nível numérico válido.'
        ),
      ]);
    }
  }

  return null;
}

function snapshotMember(player) {
  return {
    playerId: player.id,
    playerName: snapshotName(player.name),
  };
}

/**
 * Sorteia times-base sem banco, usando Monte Carlo e a penalidade compartilhada.
 *
 * @param {Array<{ id: string, name?: string, score?: number, gender?: string, height?: string }>} players
 * @param {{ teamSize: number, teamCount: number }} format
 * @param {{
 *   idGenerator?: () => string,
 *   random?: () => number,
 *   iterations?: number,
 *   balanceGender?: boolean,
 *   balanceHeight?: boolean
 *   partnershipRepeats?: Map<string, number> | { count: (a: string, b: string) => number } | null
 * }} [options]
 */
export function generateBalancedTeams(players, format, options = {}) {
  const formatResult = validateFormat(format);
  if (!formatResult.ok) return fail(formatResult.errors);

  const optionsBag = options ?? {};
  const idGenerator =
    optionsBag.idGenerator === undefined ? () => crypto.randomUUID() : optionsBag.idGenerator;
  const random = optionsBag.random === undefined ? Math.random : optionsBag.random;
  const iterations = optionsBag.iterations === undefined ? 10000 : optionsBag.iterations;
  const balanceGender = optionsBag.balanceGender === undefined ? true : optionsBag.balanceGender;
  const balanceHeight = optionsBag.balanceHeight === undefined ? true : optionsBag.balanceHeight;
  const partnershipRepeats =
    optionsBag.partnershipRepeats === undefined ? null : optionsBag.partnershipRepeats;

  if (typeof idGenerator !== 'function') {
    return fail([error('ID_GENERATOR_INVALID', 'O gerador de IDs precisa ser uma função.')]);
  }
  if (typeof random !== 'function') {
    return fail([error('RANDOM_INVALID', 'O gerador aleatório precisa ser uma função.')]);
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    return fail([
      error('ITERATIONS_INVALID', 'A quantidade de iterações precisa ser um inteiro maior ou igual a 1.'),
    ]);
  }

  let history = null;
  if (format.teamSize === 2) {
    try {
      history = normalizePartnershipRepeats(partnershipRepeats);
    } catch (caught) {
      if (caught?.code === 'PARTNERSHIP_HISTORY_INVALID') {
        return fail([error('PARTNERSHIP_HISTORY_INVALID', caught.message)]);
      }
      throw caught;
    }
  }

  const invalidPlayers = assertPlayers(players);
  if (invalidPlayers) return invalidPlayers;

  const source = players;
  const distribution = computeTeamSizeDistribution(source.length, format);
  if (!distribution.ok) return fail(distribution.errors);

  const sizes = distribution.sizes;
  const preferPartnerVariety = format.teamSize === 2;
  const scoring = { partnershipRepeats: history, balanceGender, balanceHeight };
  let bestGroups = null;
  let bestScore = null;
  let minPenalty = Infinity;

  try {
    for (let round = 0; round < iterations; round += 1) {
      const shuffled = shuffleCopy(source, random);
      const groups = splitBySizes(shuffled, sizes);
      if (preferPartnerVariety) {
        const score = scorePairing(groups, scoring);
        if (!bestScore || comparePairingScores(score, bestScore) < 0) {
          bestScore = score;
          bestGroups = groups;
          minPenalty = score.balancePenalty;
          if (isPerfectPairingScore(score)) break;
        }
      } else {
        const penalty = calcTeamBalancePenalty(groups, { balanceGender, balanceHeight });
        if (penalty < minPenalty) {
          minPenalty = penalty;
          bestGroups = groups;
          if (minPenalty === 0) break;
        }
      }
    }
  } catch (caught) {
    if (caught?.code === 'RANDOM_INVALID') {
      return fail([error('RANDOM_INVALID', caught.message)]);
    }
    throw caught;
  }

  const usedIds = new Set();
  const teams = [];

  try {
    for (const group of bestGroups) {
      teams.push({
        id: nextTeamId(idGenerator, usedIds),
        members: group.map(snapshotMember),
      });
    }
  } catch (caught) {
    return fail([
      error(
        caught?.code === 'TEAM_ID_DUPLICATE' ? 'TEAM_ID_DUPLICATE' : 'TEAM_ID_INVALID',
        caught?.message || 'Não foi possível gerar identificadores únicos para os times.'
      ),
    ]);
  }

  const validation = validateSessionTeams(teams, format, source);
  if (!validation.ok) return fail(validation.errors);

  return {
    ok: true,
    errors: [],
    teams,
    penalty: minPenalty,
    selectedCount: source.length,
    teamSizes: sizes,
  };
}
