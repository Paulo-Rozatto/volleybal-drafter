import { isMatchCompleted, isMatchPending } from './sessionValidation.js';
import { MAX_TEAM_SIZE, validateV2Document } from './teamSession.js';

/**
 * Fundação pura de desempenho.
 *
 * Construção: O(S + M × L²), onde S é o número de encontros, M o de partidas e L ≤ 6
 * o tamanho de cada lineup. Cada partida válida gera até L participações e L×(L−1)
 * relações dirigidas de parceria.
 *
 * Consultas: O(P) para listar ou ranquear os parceiros de um jogador, sem percorrer
 * o documento novamente.
 *
 * Placar versus estrutura: `validateV2Document` continua rejeitando qualquer placar
 * inválido. A análise ignora somente os códigos de `ANALYSIS_SCORE_ERROR_CODES` e
 * classifica a partida com `isMatchPending` / `isMatchCompleted`. Qualquer outro
 * erro — inclusive `FINALIZE_INCOMPLETE` — rejeita o documento sem agregado parcial.
 *
 * Jogador ausente do índice: métricas zeradas, `winRate = 0` e `playerName` vazio
 * se não houver snapshot; `getBestPartner` devolve `null`.
 *
 * Snapshot de nome histórico: na ausência do jogador no elenco atual, usa-se o
 * playerName mais recente segundo (1) date do encontro, (2) updatedAt, (3) createdAt,
 * (4) sessionIndex, roundIndex, matchIndex, sideIndex e memberIndex.
 */

export const ANALYSIS_SCORE_ERROR_CODES = Object.freeze([
  'SCORE_INVALID_TYPE',
  'SCORE_NOT_INTEGER',
  'SCORE_NEGATIVE',
  'SCORE_TIE',
  'SCORE_PARTIAL',
]);

const ANALYSIS_SCORE_ERROR_CODE_SET = new Set(ANALYSIS_SCORE_ERROR_CODES);
const MIN_LINEUP_SIZE_FILTER = 1;

const internals = new WeakMap();
const NAME_COLLATOR = new Intl.Collator('pt-BR', { sensitivity: 'base' });

function okIndex(index) {
  return { ok: true, errors: [], index };
}

function fail(errors) {
  return { ok: false, errors, index: null };
}

function error(code, message, extras = {}) {
  return { code, message, ...extras };
}

function collectParticipantIds(into, members) {
  (members ?? []).forEach((member) => {
    if (typeof member?.playerId === 'string' && member.playerId.trim() !== '') {
      into.add(member.playerId);
    }
  });
}

function listedPlayer(state, playerId) {
  return Object.freeze({
    playerId,
    playerName: resolveDisplayName(playerId, state.rosterById, state.history),
    isCurrentRosterPlayer: state.rosterById.has(playerId),
    matches: state.players.get(playerId)?.totals.matches ?? 0,
  });
}

function sortListedPlayers(listed) {
  listed.sort((left, right) => {
    const byName = NAME_COLLATOR.compare(left.playerName, right.playerName);
    if (byName !== 0) return byName;
    return String(left.playerId).localeCompare(String(right.playerId));
  });
  return Object.freeze(listed);
}

function assertPlayerId(playerId, label) {
  if (typeof playerId !== 'string' || playerId.trim() === '') {
    throw new TypeError(label);
  }
}

function normalizeParticipantIds(participantIds) {
  if (participantIds == null) return [];
  if (!Array.isArray(participantIds)) {
    throw new TypeError('A coorte de participantes é inválida.');
  }
  const unique = [];
  const seen = new Set();
  for (const id of participantIds) {
    if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function failParticipants(errors) {
  return { ok: false, errors, participantIds: null, participants: null };
}

function requireIndex(index) {
  const state = internals.get(index);
  if (!state) {
    throw new TypeError('O índice de desempenho é inválido.');
  }
  return state;
}

function isDiagnosticScoreError(item) {
  return ANALYSIS_SCORE_ERROR_CODE_SET.has(item?.code);
}

function structuralErrors(errors) {
  return (errors ?? []).filter((item) => !isDiagnosticScoreError(item));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFilter(filters) {
  if (filters == null) {
    return { lineupSize: null, partnerId: null };
  }
  if (!isPlainObject(filters)) {
    throw new TypeError('Os filtros de desempenho são inválidos.');
  }
  return {
    lineupSize: Object.prototype.hasOwnProperty.call(filters, 'lineupSize')
      ? filters.lineupSize
      : null,
    partnerId: Object.prototype.hasOwnProperty.call(filters, 'partnerId')
      ? filters.partnerId
      : null,
  };
}

function assertQueryFilters(filters) {
  const normalized = normalizeFilter(filters);
  const { lineupSize, partnerId } = normalized;

  if (lineupSize != null) {
    const supported =
      Number.isInteger(lineupSize) &&
      lineupSize >= MIN_LINEUP_SIZE_FILTER &&
      lineupSize <= MAX_TEAM_SIZE;
    if (!supported) {
      throw new TypeError('O filtro de modalidade é inválido.');
    }
  }

  if (partnerId != null) {
    if (typeof partnerId !== 'string' || partnerId.trim() === '') {
      throw new TypeError('O filtro de parceiro é inválido.');
    }
  }

  return {
    lineupSize: lineupSize ?? null,
    partnerId: partnerId ?? null,
  };
}

function isLineupSizeFilter(value) {
  return value != null;
}

function matchesLineupSize(lineupSize, filter) {
  return !isLineupSizeFilter(filter) || lineupSize === filter;
}

function createBucket() {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
}

function addParticipation(bucket, won, pointsFor, pointsAgainst) {
  bucket.matches += 1;
  if (won) bucket.wins += 1;
  else bucket.losses += 1;
  bucket.pointsFor += pointsFor;
  bucket.pointsAgainst += pointsAgainst;
}

function metricsFromBucket(bucket, identity) {
  const matches = bucket?.matches ?? 0;
  const wins = bucket?.wins ?? 0;
  const losses = bucket?.losses ?? 0;
  const pointsFor = bucket?.pointsFor ?? 0;
  const pointsAgainst = bucket?.pointsAgainst ?? 0;
  return Object.freeze({
    ...identity,
    matches,
    wins,
    losses,
    winRate: matches === 0 ? 0 : wins / matches,
    pointsFor,
    pointsAgainst,
    pointDifference: pointsFor - pointsAgainst,
  });
}

function emptyBucket() {
  return createBucket();
}

function ensurePlayer(players, playerId) {
  let record = players.get(playerId);
  if (!record) {
    record = {
      totals: createBucket(),
      byLineupSize: new Map(),
      partners: new Map(),
    };
    players.set(playerId, record);
  }
  return record;
}

function ensureSizeBucket(map, lineupSize) {
  let bucket = map.get(lineupSize);
  if (!bucket) {
    bucket = createBucket();
    map.set(lineupSize, bucket);
  }
  return bucket;
}

function ensurePartner(record, partnerId) {
  let partner = record.partners.get(partnerId);
  if (!partner) {
    partner = {
      totals: createBucket(),
      byLineupSize: new Map(),
    };
    record.partners.set(partnerId, partner);
  }
  return partner;
}

function applySideStats(record, lineupSize, won, pointsFor, pointsAgainst) {
  addParticipation(record.totals, won, pointsFor, pointsAgainst);
  addParticipation(ensureSizeBucket(record.byLineupSize, lineupSize), won, pointsFor, pointsAgainst);
}

function snapshotName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function rosterName(rosterById, playerId) {
  const current = rosterById.get(playerId);
  const name = snapshotName(current?.name);
  return name === '' ? null : name;
}

function compareSnapshotRecency(left, right) {
  const byDate = String(left.date ?? '').localeCompare(String(right.date ?? ''));
  if (byDate !== 0) return byDate;
  const byUpdated = String(left.updatedAt ?? '').localeCompare(String(right.updatedAt ?? ''));
  if (byUpdated !== 0) return byUpdated;
  const byCreated = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
  if (byCreated !== 0) return byCreated;
  if (left.sessionIndex !== right.sessionIndex) return left.sessionIndex - right.sessionIndex;
  if (left.roundIndex !== right.roundIndex) return left.roundIndex - right.roundIndex;
  if (left.matchIndex !== right.matchIndex) return left.matchIndex - right.matchIndex;
  if (left.sideIndex !== right.sideIndex) return left.sideIndex - right.sideIndex;
  return left.memberIndex - right.memberIndex;
}

function rememberName(history, playerId, playerName, recency) {
  const name = snapshotName(playerName);
  if (typeof playerId !== 'string' || playerId.trim() === '' || name === '') return;
  const current = history.get(playerId);
  if (!current || compareSnapshotRecency(recency, current) >= 0) {
    history.set(playerId, { ...recency, name });
  }
}

function rememberGroupNames(history, members, recencyBase) {
  (members ?? []).forEach((member, memberIndex) => {
    rememberName(history, member?.playerId, member?.playerName, {
      ...recencyBase,
      memberIndex,
    });
  });
}

function resolveDisplayName(playerId, rosterById, history) {
  const current = rosterName(rosterById, playerId);
  if (current != null) return current;
  return history.get(playerId)?.name ?? '';
}

function lineupMembers(lineup) {
  return Array.isArray(lineup) ? lineup : [];
}

function comparePartners(left, right) {
  if (right.winRate !== left.winRate) return right.winRate - left.winRate;
  if (right.matches !== left.matches) return right.matches - left.matches;
  if (right.pointDifference !== left.pointDifference) {
    return right.pointDifference - left.pointDifference;
  }
  if (right.pointsFor !== left.pointsFor) return right.pointsFor - left.pointsFor;
  const byName = NAME_COLLATOR.compare(left.partnerName, right.partnerName);
  if (byName !== 0) return byName;
  return String(left.partnerId).localeCompare(String(right.partnerId));
}

function bucketForPartner(partner, lineupSize) {
  if (!partner) return emptyBucket();
  if (!isLineupSizeFilter(lineupSize)) return partner.totals;
  return partner.byLineupSize.get(lineupSize) ?? emptyBucket();
}

function playerBucket(record, { lineupSize, partnerId }) {
  if (!record) return emptyBucket();
  if (partnerId != null && partnerId !== '') {
    return bucketForPartner(record.partners.get(partnerId), lineupSize);
  }
  if (isLineupSizeFilter(lineupSize)) {
    return record.byLineupSize.get(lineupSize) ?? emptyBucket();
  }
  return record.totals;
}

function modalitiesFromMap(map, lineupSize) {
  const sizes = [...map.keys()].filter((size) => matchesLineupSize(size, lineupSize));
  sizes.sort((left, right) => left - right);
  return Object.freeze(sizes);
}

function byLineupSizeFromMap(map, identity, lineupSize) {
  const sizes = [...map.keys()].filter((size) => matchesLineupSize(size, lineupSize));
  sizes.sort((left, right) => left - right);
  return Object.freeze(
    sizes.map((size) =>
      metricsFromBucket(map.get(size), {
        ...identity,
        lineupSize: size,
      })
    )
  );
}

function partnerMetrics(state, playerId, partnerId, lineupSize) {
  const record = state.players.get(playerId);
  const partner = record?.partners.get(partnerId);
  return metricsFromBucket(bucketForPartner(partner, lineupSize), {
    playerId,
    partnerId,
    partnerName: resolveDisplayName(partnerId, state.rosterById, state.history),
  });
}

function listScopedPartners(state, playerId, { lineupSize, partnerId }) {
  const record = state.players.get(playerId);
  if (!record) return [];

  const ids =
    partnerId != null && partnerId !== ''
      ? record.partners.has(partnerId)
        ? [partnerId]
        : []
      : [...record.partners.keys()];

  return ids
    .map((id) => {
      const metrics = partnerMetrics(state, playerId, id, lineupSize);
      if (metrics.matches === 0) return null;
      const partner = record.partners.get(id);
      return Object.freeze({
        ...metrics,
        modalities: modalitiesFromMap(partner.byLineupSize, lineupSize),
      });
    })
    .filter(Boolean);
}

/**
 * Constrói um índice imutável de desempenho a partir de um documento V2.
 * Não muta `document` nem `roster` e não persiste agregados.
 * Todas as sessões entram: a coorte de um encontro só filtra quem é exibido.
 *
 * @param {unknown} document
 * @param {Array<{ id?: string, name?: string }> | null} [roster]
 */
export function buildPlayerPerformanceIndex(document, roster = []) {
  const validation = validateV2Document(document);
  if (!validation.ok) {
    const fatal = structuralErrors(validation.errors);
    if (fatal.length > 0) return fail(fatal);
  }

  const rosterById = new Map(
    (Array.isArray(roster) ? roster : [])
      .filter((player) => typeof player?.id === 'string' && player.id.trim())
      .map((player) => [player.id, player])
  );
  const players = new Map();
  const history = new Map();
  let includedMatches = 0;
  let skippedPendingMatches = 0;
  let skippedInvalidMatches = 0;

  (document.sessions ?? []).forEach((session, sessionIndex) => {
    const sessionRecency = {
      date: session?.date,
      updatedAt: session?.updatedAt,
      createdAt: session?.createdAt,
      sessionIndex,
    };

    (session?.teams ?? []).forEach((team, teamIndex) => {
      rememberGroupNames(history, team?.members, {
        ...sessionRecency,
        roundIndex: -2,
        matchIndex: -2,
        sideIndex: teamIndex,
      });
    });

    (session?.rounds ?? []).forEach((round, roundIndex) => {
      (round?.matches ?? []).forEach((match, matchIndex) => {
        rememberGroupNames(history, match?.lineupA, {
          ...sessionRecency,
          roundIndex,
          matchIndex,
          sideIndex: 0,
        });
        rememberGroupNames(history, match?.lineupB, {
          ...sessionRecency,
          roundIndex,
          matchIndex,
          sideIndex: 1,
        });

        if (isMatchPending(match)) {
          skippedPendingMatches += 1;
          return;
        }

        if (!isMatchCompleted(match)) {
          skippedInvalidMatches += 1;
          return;
        }

        includedMatches += 1;
        const sides = [
          {
            members: lineupMembers(match.lineupA),
            pointsFor: match.scoreA,
            pointsAgainst: match.scoreB,
          },
          {
            members: lineupMembers(match.lineupB),
            pointsFor: match.scoreB,
            pointsAgainst: match.scoreA,
          },
        ];

        for (const side of sides) {
          const lineupSize = side.members.length;
          const won = side.pointsFor > side.pointsAgainst;
          const ids = side.members
            .map((member) => (typeof member?.playerId === 'string' ? member.playerId : ''))
            .filter((id) => id.trim() !== '');

          for (let index = 0; index < ids.length; index += 1) {
            const playerId = ids[index];
            const record = ensurePlayer(players, playerId);
            applySideStats(record, lineupSize, won, side.pointsFor, side.pointsAgainst);
            for (let partnerIndex = 0; partnerIndex < ids.length; partnerIndex += 1) {
              if (partnerIndex === index) continue;
              const partner = ensurePartner(record, ids[partnerIndex]);
              applySideStats(partner, lineupSize, won, side.pointsFor, side.pointsAgainst);
            }
          }
        }
      });
    });
  });

  const index = Object.freeze({
    includedMatches,
    skippedPendingMatches,
    skippedInvalidMatches,
  });
  internals.set(index, {
    players,
    history,
    rosterById,
  });
  return okIndex(index);
}

/**
 * @param {number} lineupSize
 * @returns {string}
 */
export function formatPerformanceModality(lineupSize) {
  if (!Number.isInteger(lineupSize) || lineupSize < 1) return '';
  return `${lineupSize}x${lineupSize}`;
}

/**
 * @param {object} index
 * @param {string} playerId
 * @param {{ lineupSize?: number | null, partnerId?: string | null }} [filters]
 */
export function getPlayerPerformance(index, playerId, filters) {
  const state = requireIndex(index);
  const { lineupSize, partnerId } = assertQueryFilters(filters);
  const record = state.players.get(playerId);
  const identity = {
    playerId,
    playerName: resolveDisplayName(playerId, state.rosterById, state.history),
  };
  const bucket = playerBucket(record, { lineupSize, partnerId });
  const sourceMap =
    partnerId != null && partnerId !== ''
      ? record?.partners.get(partnerId)?.byLineupSize ?? new Map()
      : record?.byLineupSize ?? new Map();

  return Object.freeze({
    ...metricsFromBucket(bucket, identity),
    modalities: modalitiesFromMap(sourceMap, lineupSize),
    byLineupSize: byLineupSizeFromMap(sourceMap, identity, lineupSize),
  });
}

/**
 * @param {object} index
 * @param {string} playerId
 * @param {{ lineupSize?: number | null, partnerId?: string | null }} [filters]
 */
export function getPlayerPartnerPerformance(index, playerId, filters) {
  const state = requireIndex(index);
  const scoped = listScopedPartners(state, playerId, assertQueryFilters(filters));
  scoped.sort(comparePartners);
  return Object.freeze(scoped);
}

/**
 * @param {object} index
 * @param {string} playerId
 * @param {{ lineupSize?: number | null, partnerId?: string | null }} [filters]
 */
export function getBestPartner(index, playerId, filters) {
  const partners = getPlayerPartnerPerformance(index, playerId, filters);
  return partners[0] ?? null;
}

/**
 * Lista jogadores do elenco atual e IDs históricos conhecidos pelo índice.
 * Não recria excluídos no elenco e não expõe o estado interno.
 *
 * @param {object} index
 */
export function listPerformancePlayers(index) {
  const state = requireIndex(index);
  const ids = new Set([
    ...state.rosterById.keys(),
    ...state.history.keys(),
    ...state.players.keys(),
  ]);
  return sortListedPlayers([...ids].map((playerId) => listedPlayer(state, playerId)));
}

/**
 * Coorte do encontro: união de times-base e lineups, por playerId.
 * Não calcula métricas; a fonte dos números é o índice global.
 *
 * @param {unknown} document
 * @param {Array<{ id?: string, name?: string }> | null} [roster]
 * @param {string} sessionId
 */
export function listSessionParticipants(document, roster = [], sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return failParticipants([
      error('SESSION_ID_INVALID', 'O encontro da análise precisa de um ID válido.'),
    ]);
  }

  const validation = validateV2Document(document);
  if (!validation.ok) {
    const fatal = structuralErrors(validation.errors);
    if (fatal.length > 0) return failParticipants(fatal);
  }

  const session = (document.sessions ?? []).find((item) => item?.id === sessionId);
  if (!session) {
    return failParticipants([
      error('SESSION_NOT_FOUND', 'Encontro não encontrado.', { sessionId }),
    ]);
  }

  const ids = new Set();
  const history = new Map();
  const rosterById = new Map(
    (Array.isArray(roster) ? roster : [])
      .filter((player) => typeof player?.id === 'string' && player.id.trim())
      .map((player) => [player.id, player])
  );
  const sessionRecency = {
    date: session?.date,
    updatedAt: session?.updatedAt,
    createdAt: session?.createdAt,
    sessionIndex: 0,
  };

  (session.teams ?? []).forEach((team, teamIndex) => {
    collectParticipantIds(ids, team?.members);
    rememberGroupNames(history, team?.members, {
      ...sessionRecency,
      roundIndex: -2,
      matchIndex: -2,
      sideIndex: teamIndex,
    });
  });
  (session.rounds ?? []).forEach((round, roundIndex) => {
    (round?.matches ?? []).forEach((match, matchIndex) => {
      collectParticipantIds(ids, match?.lineupA);
      collectParticipantIds(ids, match?.lineupB);
      rememberGroupNames(history, match?.lineupA, {
        ...sessionRecency,
        roundIndex,
        matchIndex,
        sideIndex: 0,
      });
      rememberGroupNames(history, match?.lineupB, {
        ...sessionRecency,
        roundIndex,
        matchIndex,
        sideIndex: 1,
      });
    });
  });

  const participantIds = Object.freeze([...ids]);
  const participants = sortListedPlayers(
    participantIds.map((playerId) =>
      Object.freeze({
        playerId,
        playerName: resolveDisplayName(playerId, rosterById, history),
        isCurrentRosterPlayer: rosterById.has(playerId),
      })
    )
  );

  return { ok: true, errors: [], participantIds, participants };
}

/**
 * Identidade dos participantes da coorte, com nomes do índice global.
 *
 * @param {object} index
 * @param {string[]} participantIds
 */
export function listCohortPlayers(index, participantIds) {
  const state = requireIndex(index);
  return sortListedPlayers(
    normalizeParticipantIds(participantIds).map((playerId) => listedPlayer(state, playerId))
  );
}

/**
 * União das modalidades históricas dos participantes da coorte.
 *
 * @param {object} index
 * @param {string[]} participantIds
 */
export function listCohortModalities(index, participantIds) {
  requireIndex(index);
  const sizes = new Set();
  for (const playerId of normalizeParticipantIds(participantIds)) {
    for (const size of getPlayerPerformance(index, playerId).modalities) {
      sizes.add(size);
    }
  }
  return Object.freeze([...sizes].sort((left, right) => left - right));
}

/**
 * Desempenho histórico de cada participante da coorte.
 *
 * @param {object} index
 * @param {string[]} participantIds
 * @param {{ lineupSize?: number | null }} [filters]
 */
export function getCohortPlayerPerformances(index, participantIds, filters) {
  const listed = listCohortPlayers(index, participantIds);
  return Object.freeze(
    listed.map((player) =>
      Object.freeze({
        ...player,
        ...getPlayerPerformance(index, player.playerId, filters),
      })
    )
  );
}

/**
 * Parceria histórica entre dois jogadores, consultada no índice global.
 *
 * @param {object} index
 * @param {string} playerId
 * @param {string} partnerId
 * @param {{ lineupSize?: number | null }} [filters]
 */
export function getCohortPartnershipPerformance(index, playerId, partnerId, filters) {
  const state = requireIndex(index);
  assertPlayerId(playerId, 'O jogador da parceria é inválido.');
  assertPlayerId(partnerId, 'O parceiro da parceria é inválido.');
  const { lineupSize } = assertQueryFilters(filters);
  const metrics = getPlayerPerformance(index, playerId, { lineupSize, partnerId });
  return Object.freeze({
    ...metrics,
    partnerId,
    partnerName: resolveDisplayName(partnerId, state.rosterById, state.history),
  });
}

/**
 * Matriz simétrica da coorte com parcerias do histórico completo.
 *
 * @param {object} index
 * @param {string[]} participantIds
 * @param {{ lineupSize?: number | null }} [filters]
 */
export function getCohortPartnershipMatrix(index, participantIds, filters) {
  const state = requireIndex(index);
  const { lineupSize } = assertQueryFilters(filters);
  const players = listCohortPlayers(index, participantIds);

  const rows = players.map((rowPlayer) =>
    Object.freeze({
      playerId: rowPlayer.playerId,
      playerName: rowPlayer.playerName,
      cells: Object.freeze(
        players.map((columnPlayer) => {
          if (rowPlayer.playerId === columnPlayer.playerId) {
            return Object.freeze({
              playerId: rowPlayer.playerId,
              partnerId: columnPlayer.playerId,
              matches: null,
              diagonal: true,
            });
          }
          const metrics = partnerMetrics(state, rowPlayer.playerId, columnPlayer.playerId, lineupSize);
          return Object.freeze({
            playerId: rowPlayer.playerId,
            partnerId: columnPlayer.playerId,
            matches: metrics.matches,
            diagonal: false,
          });
        })
      ),
    })
  );

  return Object.freeze({
    players,
    rows: Object.freeze(rows),
  });
}
