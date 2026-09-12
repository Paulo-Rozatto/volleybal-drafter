function ok() {
  return { ok: true, errors: [] };
}

function fail(errors) {
  return { ok: false, errors };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * @param {unknown} date
 * @returns {{ ok: boolean, errors: Array<{ code: string, message: string, field?: string }> }}
 */
export function validateDate(date) {
  if (date == null || date === '') {
    return fail([
      error('DATE_REQUIRED', 'A data do encontro é obrigatória.', { field: 'date' }),
    ]);
  }

  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    return fail([
      error('DATE_FORMAT', 'A data deve estar no formato YYYY-MM-DD.', { field: 'date' }),
    ]);
  }

  const [, year, month, day] = date.match(DATE_PATTERN);
  if (!isRealCalendarDate(Number(year), Number(month), Number(day))) {
    return fail([
      error('DATE_INVALID', 'A data informada não existe.', { field: 'date' }),
    ]);
  }

  return ok();
}

function snapshotName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function isNonEmptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rosterIds(roster) {
  return new Set((roster ?? []).map((player) => player?.id).filter(Boolean));
}

function collectPlayerIds(pairs) {
  const ids = [];
  for (const pair of pairs ?? []) {
    for (const member of pair?.members ?? []) {
      if (isNonEmptyId(member?.playerId)) {
        ids.push(member.playerId);
      }
    }
  }
  return ids;
}

/**
 * @param {{ id?: string, members?: Array<{ playerId?: string, playerName?: string }> }} pair
 * @param {Array<{ id: string }>} roster
 * @param {Array<{ id?: string, members?: Array<{ playerId?: string, playerName?: string }> }>} [otherPairs]
 */
export function validatePair(pair, roster, otherPairs = []) {
  const errors = [];

  if (!isNonEmptyId(pair?.id)) {
    errors.push(error('PAIR_ID_INVALID', 'A dupla precisa de um ID válido.', { field: 'id' }));
  } else if (otherPairs.some((other) => other?.id === pair.id)) {
    errors.push(
      error('PAIR_ID_DUPLICATE', 'Já existe uma dupla com este ID neste encontro.', { field: 'id' })
    );
  }

  const members = pair?.members;

  if (!Array.isArray(members) || members.length !== 2) {
    errors.push(error('PAIR_MEMBERS_COUNT', 'A dupla deve ter exatamente dois jogadores.'));
    return fail(errors);
  }

  const [first, second] = members;
  const firstId = first?.playerId;
  const secondId = second?.playerId;

  if (!isNonEmptyId(firstId) || !isNonEmptyId(secondId)) {
    errors.push(error('PAIR_PLAYER_ID_INVALID', 'Cada integrante da dupla precisa de um ID de jogador válido.'));
  } else if (firstId === secondId) {
    errors.push(error('PAIR_DUPLICATE_PLAYER', 'A dupla não pode ter o mesmo jogador duas vezes.'));
  }

  const knownIds = rosterIds(roster);
  members.forEach((member, index) => {
    if (isNonEmptyId(member?.playerId) && !knownIds.has(member.playerId)) {
      errors.push(
        error('PAIR_PLAYER_NOT_FOUND', 'Jogador não encontrado no elenco.', {
          field: `members[${index}].playerId`,
          playerId: member.playerId,
        })
      );
    }

    if (snapshotName(member?.playerName) === '') {
      errors.push(
        error('PAIR_NAME_EMPTY', 'O nome histórico do jogador não pode estar vazio.', {
          field: `members[${index}].playerName`,
        })
      );
    }
  });

  const takenIds = new Set(collectPlayerIds(otherPairs));
  members.forEach((member, index) => {
    if (isNonEmptyId(member?.playerId) && takenIds.has(member.playerId)) {
      errors.push(
        error('PAIR_PLAYER_ALREADY_PAIRED', 'O jogador já participa de outra dupla neste encontro.', {
          field: `members[${index}].playerId`,
          playerId: member.playerId,
        })
      );
    }
  });

  return errors.length > 0 ? fail(errors) : ok();
}

/**
 * @param {Array<{ id?: string, members?: Array<{ playerId?: string, playerName?: string }> }>} pairs
 * @param {Array<{ id: string }>} roster
 */
export function validateSessionPairs(pairs, roster) {
  if (!Array.isArray(pairs)) {
    return fail([error('PAIRS_NOT_ARRAY', 'As duplas do encontro precisam ser uma lista.')]);
  }

  const errors = [];
  pairs.forEach((pair, index) => {
    const otherPairs = pairs.filter((_, otherIndex) => otherIndex !== index);
    const result = validatePair(pair, roster, otherPairs);
    if (!result.ok) {
      errors.push(
        ...result.errors.map((item) => ({
          ...item,
          pairIndex: index,
          pairId: pair?.id,
        }))
      );
    }
  });

  return errors.length > 0 ? fail(errors) : ok();
}

function scoreValueError(value, field) {
  if (value === null) return null;

  if (typeof value === 'string') {
    return error('SCORE_INVALID_TYPE', 'O placar deve ser um número inteiro ou vazio.', { field });
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    return error('SCORE_INVALID_TYPE', 'O placar deve ser um número inteiro ou vazio.', { field });
  }

  if (!Number.isInteger(value)) {
    return error('SCORE_NOT_INTEGER', 'O placar deve ser um número inteiro.', { field });
  }

  if (value < 0) {
    return error('SCORE_NEGATIVE', 'O placar não pode ser negativo.', { field });
  }

  return null;
}

function isFilledScore(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * @param {unknown} scoreA
 * @param {unknown} scoreB
 */
export function validateScore(scoreA, scoreB) {
  if (scoreA === null && scoreB === null) {
    return ok();
  }

  const aFilled = isFilledScore(scoreA);
  const bFilled = isFilledScore(scoreB);

  if (aFilled && bFilled) {
    if (scoreA === scoreB) {
      return fail([error('SCORE_TIE', 'Empates não são permitidos.')]);
    }
    return ok();
  }

  if ((scoreA === null && bFilled) || (scoreB === null && aFilled)) {
    return fail([
      error('SCORE_PARTIAL', 'O placar deve preencher os dois lados ou ficar vazio.'),
    ]);
  }

  const errors = [scoreValueError(scoreA, 'scoreA'), scoreValueError(scoreB, 'scoreB')].filter(Boolean);
  if (errors.length === 0) {
    return fail([
      error('SCORE_PARTIAL', 'O placar deve preencher os dois lados ou ficar vazio.'),
    ]);
  }

  return fail(errors);
}

export function isMatchPending(match) {
  return match?.scoreA === null && match?.scoreB === null;
}

export function isMatchCompleted(match) {
  return validateScore(match?.scoreA, match?.scoreB).ok && !isMatchPending(match);
}

function listSessionMatches(session) {
  return session?.rounds?.flatMap((round) => round.matches ?? []) ?? [];
}

/**
 * @param {{ rounds?: Array<{ matches?: Array<{ scoreA: unknown, scoreB: unknown }> }> }} session
 */
export function countSessionMatches(session) {
  const matches = listSessionMatches(session);
  let completed = 0;
  let pending = 0;
  let invalid = 0;

  for (const match of matches) {
    if (isMatchPending(match)) pending += 1;
    else if (isMatchCompleted(match)) completed += 1;
    else invalid += 1;
  }

  return {
    total: matches.length,
    completed,
    pending,
    invalid,
  };
}

/**
 * @param {{ rounds?: Array<{ matches?: Array<{ scoreA: unknown, scoreB: unknown }> }> }} session
 */
export function validateCanFinalize(session) {
  const { total, completed } = countSessionMatches(session);

  if (total === 0) {
    return fail([
      error('FINALIZE_NO_MATCHES', 'Não é possível finalizar um encontro sem partidas.'),
    ]);
  }

  if (completed !== total) {
    return fail([
      error('FINALIZE_INCOMPLETE', 'Todos os jogos precisam ter placar antes de finalizar.'),
    ]);
  }

  return ok();
}

export function canFinalizeSession(session) {
  return validateCanFinalize(session).ok;
}
