export const DELETE_PLAYER_CONFIRMATION_REQUIRED = 'DELETE_PLAYER_CONFIRMATION_REQUIRED';

export const DELETE_PLAYER_CONFIRMATION_MESSAGE =
  'Excluir este jogador do elenco? As participações já registradas nos encontros serão preservadas.';

const SCORE_VALUES = new Set([1, 2, 3, 4, 5]);
const GENDER_VALUES = new Set(['F', 'M']);
const HEIGHT_VALUES = new Set(['tall', 'short']);

function fail(errors) {
  return { ok: false, errors, players: null, player: null };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function clonePlayers(players) {
  return (Array.isArray(players) ? players : []).map((player) => ({ ...player }));
}

function normalizePlayer(input, { requireId = true } = {}) {
  const errors = [];
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  if (requireId && !id) {
    errors.push(error('PLAYER_ID_INVALID', 'O jogador precisa de um ID válido.', { field: 'id' }));
  }

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) {
    errors.push(error('PLAYER_NAME_REQUIRED', 'O nome do jogador é obrigatório.', { field: 'name' }));
  }

  const score = input?.score;
  if (!SCORE_VALUES.has(score)) {
    errors.push(
      error('PLAYER_SCORE_INVALID', 'O nível do jogador deve ser um inteiro de 1 a 5.', {
        field: 'score',
      })
    );
  }

  const gender = input?.gender;
  if (!GENDER_VALUES.has(gender)) {
    errors.push(
      error('PLAYER_GENDER_INVALID', 'O gênero do jogador deve ser feminino ou masculino.', {
        field: 'gender',
      })
    );
  }

  const height = input?.height || 'short';
  if (!HEIGHT_VALUES.has(height)) {
    errors.push(
      error('PLAYER_HEIGHT_INVALID', 'A altura do jogador deve ser alto ou baixo.', {
        field: 'height',
      })
    );
  }

  if (errors.length > 0) return fail(errors);

  return {
    ok: true,
    errors: [],
    player: { id, name, score, gender, height },
  };
}

function samePlayer(left, right) {
  return (
    left?.id === right?.id &&
    left?.name === right?.name &&
    left?.score === right?.score &&
    left?.gender === right?.gender &&
    left?.height === right?.height
  );
}

export function createPlayer(players, input = {}, { idGenerator } = {}) {
  const list = clonePlayers(players);
  const createId = idGenerator ?? (() => crypto.randomUUID());
  const id = createId();
  if (list.some((player) => player.id === id)) {
    return fail([
      error('PLAYER_ID_REUSED', 'Não é permitido reutilizar o ID de um jogador.', { field: 'id' }),
    ]);
  }

  const normalized = normalizePlayer({ ...input, id });
  if (!normalized.ok) return normalized;

  return {
    ok: true,
    errors: [],
    players: [...list, normalized.player],
    player: normalized.player,
  };
}

export function updatePlayer(players, playerId, changes = {}) {
  const list = clonePlayers(players);
  const index = list.findIndex((player) => player.id === playerId);
  if (index < 0) {
    return fail([error('PLAYER_NOT_FOUND', 'Jogador não encontrado.')]);
  }

  const current = list[index];
  const normalized = normalizePlayer({
    ...current,
    ...changes,
    id: current.id,
  });
  if (!normalized.ok) return normalized;

  if (samePlayer(current, normalized.player)) {
    return {
      ok: true,
      errors: [],
      unchanged: true,
      players: list,
      player: current,
    };
  }

  const next = [...list];
  next[index] = normalized.player;
  return {
    ok: true,
    errors: [],
    players: next,
    player: normalized.player,
  };
}

export function deletePlayer(players, playerId, { deleteConfirmed = false } = {}) {
  if (!deleteConfirmed) {
    return fail([
      error('DELETE_PLAYER_CONFIRMATION_REQUIRED', DELETE_PLAYER_CONFIRMATION_MESSAGE),
    ]);
  }

  const list = clonePlayers(players);
  const index = list.findIndex((player) => player.id === playerId);
  if (index < 0) {
    return fail([error('PLAYER_NOT_FOUND', 'Jogador não encontrado.')]);
  }

  const player = list[index];
  return {
    ok: true,
    errors: [],
    players: list.filter((item) => item.id !== playerId),
    player,
  };
}
