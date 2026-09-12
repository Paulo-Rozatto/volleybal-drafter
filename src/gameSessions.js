import { validateDate, countSessionMatches } from './domain/sessionValidation.js';
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
