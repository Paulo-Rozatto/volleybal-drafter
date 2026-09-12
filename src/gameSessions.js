import { generateRoundRobin } from './domain/roundRobin.js';
import {
  countSessionMatches,
  validateDate,
  validatePair,
  validateScore,
  validateSessionPairs,
} from './domain/sessionValidation.js';
import { GAME_SESSIONS_SCHEMA_VERSION } from './persistence/constants.js';
import { nextGameSessionsDocument } from './persistence/syncHelpers.js';

const STATUS_LABELS = {
  draft: 'Rascunho',
  in_progress: 'Em andamento',
  finished: 'Finalizado',
};

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeSessionName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? null : trimmed;
}

export function createDraftGameSession(input = {}, { idGenerator, now } = {}) {
  const dateResult = validateDate(input.date);
  if (!dateResult.ok) {
    throw new Error(dateResult.errors[0]?.message || 'A data do encontro é inválida.');
  }

  const createId = idGenerator ?? (() => crypto.randomUUID());
  const clock = now ?? (() => new Date());
  const createdAt = clock().toISOString();

  return {
    id: createId(),
    date: input.date,
    name: normalizeSessionName(input.name),
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    pairs: [],
    rounds: [],
  };
}

export function appendDraftGameSession(document, input, options) {
  const session = createDraftGameSession(input, options);
  const currentSessions = Array.isArray(document?.sessions) ? document.sessions : [];

  return {
    document: nextGameSessionsDocument(document, {
      schemaVersion: document?.schemaVersion ?? GAME_SESSIONS_SCHEMA_VERSION,
      sessions: [...currentSessions, session],
    }),
    session,
  };
}

export function formatSessionDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date ?? '';
  }

  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function translateSessionStatus(status) {
  return STATUS_LABELS[status] ?? status;
}

export function sessionsForDisplay(sessions) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
    const byDate = String(right?.date ?? '').localeCompare(String(left?.date ?? ''));
    if (byDate !== 0) return byDate;
    return String(right?.createdAt ?? '').localeCompare(String(left?.createdAt ?? ''));
  });
}

export function sessionListStats(session) {
  const pairCount = Array.isArray(session?.pairs) ? session.pairs.length : 0;
  const { total } = countSessionMatches(session);
  return { pairCount, matchCount: total };
}

export function sessionDisplayName(session) {
  return session?.name || 'Encontro sem nome';
}

export function canEditSessionPairs(session) {
  return session?.status === 'draft' && (!Array.isArray(session?.rounds) || session.rounds.length === 0);
}

export function takenPlayerIds(pairs, exceptPairId) {
  const ids = new Set();
  for (const pair of pairs ?? []) {
    if (exceptPairId && pair?.id === exceptPairId) continue;
    for (const member of pair?.members ?? []) {
      if (typeof member?.playerId === 'string' && member.playerId.trim()) {
        ids.add(member.playerId);
      }
    }
  }
  return ids;
}

export function availableRosterPlayers(roster, pairs, exceptPairId) {
  const taken = takenPlayerIds(pairs, exceptPairId);
  return (roster ?? []).filter((player) => player?.id && !taken.has(player.id));
}

function normalizeSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function filterPlayersByName(players, query) {
  const needle = normalizeSearch(query);
  const list = Array.isArray(players) ? players : [];
  if (!needle) return [...list];
  return list.filter((player) => normalizeSearch(player?.name).includes(needle));
}

function fail(errors) {
  return { ok: false, errors, document: null, session: null, pair: null };
}

function succeed({ document, session, pair = null }) {
  return { ok: true, errors: [], document, session, pair };
}

function findSession(document, sessionId) {
  return (document?.sessions ?? []).find((item) => item?.id === sessionId) ?? null;
}

function snapshotMember(player) {
  return {
    playerId: player?.id,
    playerName: typeof player?.name === 'string' ? player.name.trim() : '',
  };
}

function replaceSession(document, sessionId, nextSession) {
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  return nextGameSessionsDocument(document, {
    schemaVersion: document?.schemaVersion ?? GAME_SESSIONS_SCHEMA_VERSION,
    sessions: sessions.map((item) => (item?.id === sessionId ? nextSession : item)),
  });
}

function withUpdatedPairs(session, pairs, now) {
  const clock = now ?? (() => new Date());
  return {
    ...session,
    pairs: [...pairs],
    rounds: [],
    updatedAt: clock().toISOString(),
  };
}

function lockedResult(session) {
  if (!session) {
    return fail([{ code: 'SESSION_NOT_FOUND', message: 'Encontro não encontrado.' }]);
  }
  if (!canEditSessionPairs(session)) {
    return fail([
      {
        code: 'PAIRS_LOCKED',
        message: 'Só é possível alterar duplas em um encontro em rascunho sem rodadas.',
      },
    ]);
  }
  return null;
}

function selectionResult(playerA, playerB) {
  if (!playerA || !playerB) {
    return fail([
      {
        code: 'PAIR_SELECTION_INCOMPLETE',
        message: 'Selecione dois jogadores para formar a dupla.',
      },
    ]);
  }
  return null;
}

function commitPairs(document, session, nextPairs, roster, now, pair) {
  const setResult = validateSessionPairs(nextPairs, roster);
  if (!setResult.ok) return fail(setResult.errors);

  const updatedSession = withUpdatedPairs(session, nextPairs, now);
  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
    pair,
  });
}

export function addSessionPair(document, sessionId, { playerA, playerB } = {}, roster, { idGenerator, now } = {}) {
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  const selected = selectionResult(playerA, playerB);
  if (selected) return selected;

  const createId = idGenerator ?? (() => crypto.randomUUID());
  const pair = {
    id: createId(),
    members: [snapshotMember(playerA), snapshotMember(playerB)],
  };

  const pairResult = validatePair(pair, roster, session.pairs ?? []);
  if (!pairResult.ok) return fail(pairResult.errors);

  return commitPairs(document, session, [...(session.pairs ?? []), pair], roster, now, pair);
}

export function updateSessionPair(
  document,
  sessionId,
  pairId,
  { playerA, playerB } = {},
  roster,
  { now } = {}
) {
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  const selected = selectionResult(playerA, playerB);
  if (selected) return selected;

  const currentPairs = session.pairs ?? [];
  const pairIndex = currentPairs.findIndex((item) => item?.id === pairId);
  if (pairIndex < 0) {
    return fail([{ code: 'PAIR_NOT_FOUND', message: 'Dupla não encontrada.' }]);
  }

  const pair = {
    id: pairId,
    members: [snapshotMember(playerA), snapshotMember(playerB)],
  };
  const otherPairs = currentPairs.filter((item) => item.id !== pairId);
  const pairResult = validatePair(pair, roster, otherPairs);
  if (!pairResult.ok) return fail(pairResult.errors);

  const nextPairs = currentPairs.map((item, index) => (index === pairIndex ? pair : item));
  return commitPairs(document, session, nextPairs, roster, now, pair);
}

export function removeSessionPair(document, sessionId, pairId, roster, { now } = {}) {
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  const currentPairs = session.pairs ?? [];
  if (!currentPairs.some((item) => item?.id === pairId)) {
    return fail([{ code: 'PAIR_NOT_FOUND', message: 'Dupla não encontrada.' }]);
  }

  const nextPairs = currentPairs.filter((item) => item.id !== pairId);
  return commitPairs(document, session, nextPairs, roster, now, null);
}

export const REPLACE_PAIRS_CONFIRMATION_MESSAGE =
  'Este sorteio substituirá todas as duplas atuais. Deseja continuar?';

export function pairMemberIdsInRoster(pairs, roster) {
  const knownIds = new Set((roster ?? []).map((player) => player?.id).filter(Boolean));
  const ids = [];
  for (const pair of pairs ?? []) {
    for (const member of pair?.members ?? []) {
      const playerId = member?.playerId;
      if (knownIds.has(playerId) && !ids.includes(playerId)) {
        ids.push(playerId);
      }
    }
  }
  return ids;
}

export function replaceSessionPairs(document, sessionId, pairs, roster, { now, replaceConfirmed = false } = {}) {
  const session = findSession(document, sessionId);
  const locked = lockedResult(session);
  if (locked) return locked;

  if (!Array.isArray(pairs)) {
    return fail([{ code: 'PAIRS_NOT_ARRAY', message: 'As duplas do encontro precisam ser uma lista.' }]);
  }

  const hasExisting = (session.pairs?.length ?? 0) > 0;
  if (hasExisting && !replaceConfirmed) {
    return fail([
      {
        code: 'REPLACE_CONFIRMATION_REQUIRED',
        message: REPLACE_PAIRS_CONFIRMATION_MESSAGE,
      },
    ]);
  }

  return commitPairs(document, session, [...pairs], roster, now, null);
}

export function pairMembersForEdit(pair, roster) {
  return (pair?.members ?? []).map((member) => {
    const current = (roster ?? []).find((player) => player?.id === member?.playerId);
    return current ? { ...current } : { id: member?.playerId, name: member?.playerName };
  });
}

export const GENERATE_ROUNDS_CONFIRMATION_MESSAGE =
  'Depois de gerar as rodadas, as duplas ficarão bloqueadas. Deseja continuar?';

export const RESET_TO_DRAFT_CONFIRMATION_MESSAGE =
  'Alterar as duplas apagará todas as rodadas e placares deste encontro. Deseja continuar?';

export function sessionRoundSummary(session) {
  const roundCount = Array.isArray(session?.rounds) ? session.rounds.length : 0;
  const matches = countSessionMatches(session);
  return {
    roundCount,
    matchCount: matches.total,
    completedCount: matches.completed,
    pendingCount: matches.pending,
    invalidCount: matches.invalid,
  };
}

export function sessionIsReadyToFinalize(session) {
  const { total, completed, invalid } = countSessionMatches(session);
  return total > 0 && completed === total && invalid === 0;
}

export function canGenerateSessionRounds(session, roster) {
  if (!session || session.status !== 'draft') return false;
  if (Array.isArray(session.rounds) && session.rounds.length > 0) return false;
  if (!Array.isArray(session.pairs) || session.pairs.length < 2) return false;
  return validateSessionPairs(session.pairs, roster).ok;
}

export function startSessionRoundRobin(document, sessionId, options = {}) {
  const { idGenerator, now, roster, generateConfirmed = false } = options;
  const session = findSession(document, sessionId);

  if (!session) {
    return fail([{ code: 'SESSION_NOT_FOUND', message: 'Encontro não encontrado.' }]);
  }

  if (session.status !== 'draft') {
    return fail([
      {
        code: 'SESSION_NOT_DRAFT',
        message: 'Só é possível gerar rodadas em um encontro em rascunho.',
      },
    ]);
  }

  if (Array.isArray(session.rounds) && session.rounds.length > 0) {
    return fail([
      {
        code: 'ROUNDS_ALREADY_EXIST',
        message: 'Este encontro já possui rodadas.',
      },
    ]);
  }

  const pairs = Array.isArray(session.pairs) ? session.pairs : [];
  if (pairs.length < 2) {
    return fail([
      {
        code: 'TOO_FEW_PAIRS',
        message: 'Forme pelo menos duas duplas para gerar os jogos.',
      },
    ]);
  }

  const pairValidation = validateSessionPairs(pairs, roster);
  if (!pairValidation.ok) return fail(pairValidation.errors);

  if (!generateConfirmed) {
    return fail([
      {
        code: 'GENERATE_ROUNDS_CONFIRMATION_REQUIRED',
        message: GENERATE_ROUNDS_CONFIRMATION_MESSAGE,
      },
    ]);
  }

  let rounds;
  try {
    rounds = generateRoundRobin(pairs, idGenerator ?? (() => crypto.randomUUID()));
  } catch (error) {
    return fail([
      {
        code: 'ROUND_ROBIN_FAILED',
        message: error.message || 'Não foi possível gerar as rodadas.',
      },
    ]);
  }

  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    status: 'in_progress',
    pairs: [...pairs],
    rounds,
    updatedAt: clock().toISOString(),
  };

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function resetSessionToDraftForPairEditing(document, sessionId, options = {}) {
  const { now, resetConfirmed = false } = options;
  const session = findSession(document, sessionId);

  if (!session) {
    return fail([{ code: 'SESSION_NOT_FOUND', message: 'Encontro não encontrado.' }]);
  }

  if (session.status === 'finished') {
    return fail([
      {
        code: 'SESSION_FINISHED',
        message: 'Não é possível alterar duplas de um encontro finalizado.',
      },
    ]);
  }

  if (session.status !== 'in_progress') {
    return fail([
      {
        code: 'SESSION_NOT_IN_PROGRESS',
        message: 'Só é possível alterar duplas de um encontro em andamento.',
      },
    ]);
  }

  if (!resetConfirmed) {
    return fail([
      {
        code: 'RESET_TO_DRAFT_CONFIRMATION_REQUIRED',
        message: RESET_TO_DRAFT_CONFIRMATION_MESSAGE,
      },
    ]);
  }

  const clock = now ?? (() => new Date());
  const updatedSession = {
    ...session,
    status: 'draft',
    pairs: [...(session.pairs ?? [])],
    rounds: [],
    updatedAt: clock().toISOString(),
  };

  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export const CLEAR_SCORE_CONFIRMATION_MESSAGE =
  'Remover o placar desta partida e marcá-la novamente como pendente?';

function locateInProgressMatch(document, sessionId, roundId, matchId) {
  const session = findSession(document, sessionId);
  if (!session) {
    return fail([{ code: 'SESSION_NOT_FOUND', message: 'Encontro não encontrado.' }]);
  }

  if (session.status === 'finished') {
    return fail([
      {
        code: 'SESSION_FINISHED',
        message: 'Não é possível alterar placares de um encontro finalizado.',
      },
    ]);
  }

  if (session.status !== 'in_progress') {
    return fail([
      {
        code: 'SESSION_NOT_IN_PROGRESS',
        message: 'Só é possível alterar placares em um encontro em andamento.',
      },
    ]);
  }

  const round = (session.rounds ?? []).find((item) => item?.id === roundId);
  if (!round) {
    return fail([{ code: 'ROUND_NOT_FOUND', message: 'Rodada não encontrada.' }]);
  }

  const match = (round.matches ?? []).find((item) => item?.id === matchId);
  if (!match) {
    return fail([{ code: 'MATCH_NOT_FOUND', message: 'Partida não encontrada.' }]);
  }

  return { ok: true, errors: [], session, round, match };
}

function withUpdatedMatchScore(session, roundId, matchId, scoreA, scoreB, now) {
  const clock = now ?? (() => new Date());
  return {
    ...session,
    rounds: (session.rounds ?? []).map((round) => {
      if (round.id !== roundId) return round;
      return {
        ...round,
        matches: (round.matches ?? []).map((match) =>
          match.id === matchId ? { ...match, scoreA, scoreB } : match
        ),
      };
    }),
    updatedAt: clock().toISOString(),
  };
}

function commitMatchScore(document, session, roundId, matchId, scoreA, scoreB, now) {
  const updatedSession = withUpdatedMatchScore(session, roundId, matchId, scoreA, scoreB, now);
  return succeed({
    document: replaceSession(document, session.id, updatedSession),
    session: updatedSession,
  });
}

export function setSessionMatchScore(document, sessionId, roundId, matchId, scoreA, scoreB, options = {}) {
  const located = locateInProgressMatch(document, sessionId, roundId, matchId);
  if (!located.ok) return located;

  if (scoreA === null && scoreB === null) {
    return fail([
      {
        code: 'SCORE_PARTIAL',
        message: 'O placar deve preencher os dois lados ou ficar vazio.',
      },
    ]);
  }

  const validation = validateScore(scoreA, scoreB);
  if (!validation.ok) return fail(validation.errors);

  return commitMatchScore(document, located.session, roundId, matchId, scoreA, scoreB, options.now);
}

export function clearSessionMatchScore(document, sessionId, roundId, matchId, options = {}) {
  const { now, clearConfirmed = false } = options;
  const located = locateInProgressMatch(document, sessionId, roundId, matchId);
  if (!located.ok) return located;

  if (!clearConfirmed) {
    return fail([
      {
        code: 'CLEAR_SCORE_CONFIRMATION_REQUIRED',
        message: CLEAR_SCORE_CONFIRMATION_MESSAGE,
      },
    ]);
  }

  return commitMatchScore(document, located.session, roundId, matchId, null, null, now);
}
