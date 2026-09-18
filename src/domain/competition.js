import { cloneTeamMembers, MAX_TEAM_SIZE, MIN_TEAM_SIZE } from './teamSession.js';
import { isMatchCompleted, isMatchPending, validateDate, validateScore } from './sessionValidation.js';
import {
  COMPETITION_BRACKETS,
  COMPETITION_GRAND_FINAL_MODES,
  COMPETITION_SOURCE_TYPES,
  COMPETITION_STAGE_STATUSES,
  COMPETITION_STAGE_TYPES,
  COMPETITION_STATUSES,
  MIN_COMPETITION_TEAM_COUNT,
  cloneCompetitionMatch,
  cloneCompetitionRound,
  cloneCompetitionSource,
  error,
  fail,
  isNonEmptyId,
  isPlainObject,
  ok,
  pendingMatchFields,
  resolveIdGenerator,
  stageNameForType,
} from './competitionPrimitives.js';
import {
  assertSwissRoundCompleteForNext,
  createFirstSwissRound,
  createNextSwissRound,
  freezeSwissSeedSnapshot,
  getSwissStandings,
  isSwissRoundComplete,
} from './competitionSwiss.js';
import {
  generateDoubleEliminationRounds,
  generateSingleEliminationStageRounds,
} from './competitionDoubleElimination.js';

export const COMPETITION_SCHEMA_VERSION = 2;
export {
  COMPETITION_BRACKETS,
  COMPETITION_GRAND_FINAL_MODES,
  COMPETITION_SOURCE_TYPES,
  COMPETITION_STAGE_STATUSES,
  COMPETITION_STAGE_TYPES,
  COMPETITION_STATUSES,
  MIN_COMPETITION_TEAM_COUNT,
  competitionByeCount,
  nextPowerOfTwo,
  seedBracketOrder,
} from './competitionPrimitives.js';
export { getSwissStandings, freezeSwissSeedSnapshot } from './competitionSwiss.js';

export const COMPETITION_TOURNAMENT_TYPES = Object.freeze(['single_elimination']);

export const COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED =
  'COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED';
export const COMPETITION_DOWNSTREAM_CONFIRMATION_MESSAGE =
  'Alterar este resultado apagará os placares das partidas seguintes que já dependem dele. Deseja continuar?';

export const CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED =
  'CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED';
export const CLEAR_COMPETITION_RESULT_CONFIRMATION_MESSAGE =
  'Remover o placar desta partida? Partidas seguintes que já tiverem resultado também serão limpas.';

export const GENERATE_BRACKET_CONFIRMATION_REQUIRED = 'GENERATE_BRACKET_CONFIRMATION_REQUIRED';
export const GENERATE_BRACKET_CONFIRMATION_MESSAGE =
  'Gerar a chave novamente apagará partidas e resultados já existentes. Deseja continuar?';

const STATUS_SET = new Set(COMPETITION_STATUSES);
const STAGE_STATUS_SET = new Set(COMPETITION_STAGE_STATUSES);
const STAGE_TYPE_SET = new Set(COMPETITION_STAGE_TYPES);
const SOURCE_TYPE_SET = new Set(COMPETITION_SOURCE_TYPES);
const BRACKET_SET = new Set(COMPETITION_BRACKETS);
const GRAND_FINAL_MODE_SET = new Set(COMPETITION_GRAND_FINAL_MODES);

function defaultNow() {
  return new Date();
}

function resolveNow(now) {
  return typeof now === 'function' ? now : defaultNow;
}

function localDateString(date) {
  const value = date instanceof Date ? date : resolveNow()();
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed === '' ? null : trimmed;
}

export function cloneCompetitionTeam(team) {
  return {
    id: team?.id,
    members: cloneTeamMembers(team?.members),
  };
}

function cloneSeedSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) return null;
  return snapshot.map((row) => ({
    seed: row?.seed,
    teamId: row?.teamId,
    wins: row?.wins,
    losses: row?.losses,
    buchholz: row?.buchholz,
    pointDifference: row?.pointDifference,
  }));
}

export function cloneCompetitionStage(stage) {
  return {
    id: stage?.id,
    number: stage?.number,
    name: stage?.name ?? null,
    type: stage?.type,
    status: stage?.status,
    config: isPlainObject(stage?.config) ? { ...stage.config } : {},
    seedTeamIds: Array.isArray(stage?.seedTeamIds) ? [...stage.seedTeamIds] : [],
    seedSnapshot: cloneSeedSnapshot(stage?.seedSnapshot),
    rounds: (stage?.rounds ?? []).map(cloneCompetitionRound),
  };
}

export function cloneCompetition(competition) {
  const cloned = {
    id: competition?.id,
    name: competition?.name ?? null,
    status: competition?.status,
    createdAt: competition?.createdAt,
    updatedAt: competition?.updatedAt,
    format: {
      teamSize: competition?.format?.teamSize,
    },
    seedTeamIds: Array.isArray(competition?.seedTeamIds) ? [...competition.seedTeamIds] : [],
    teams: (competition?.teams ?? []).map(cloneCompetitionTeam),
    stages: (competition?.stages ?? []).map(cloneCompetitionStage),
  };
  if (typeof competition?.date === 'string') {
    cloned.date = competition.date;
  }
  return cloned;
}

export function cloneCompetitionDocument(document) {
  return {
    schemaVersion: document?.schemaVersion,
    competitions: (document?.competitions ?? []).map(cloneCompetition),
  };
}

export function createEmptyCompetitionDocument() {
  return {
    schemaVersion: COMPETITION_SCHEMA_VERSION,
    competitions: [],
  };
}

function teamById(competition, teamId) {
  return (competition?.teams ?? []).find((team) => team.id === teamId) ?? null;
}

export function listCompetitionStages(competition) {
  return competition?.stages ?? [];
}

export function listCompetitionRounds(competition) {
  return listCompetitionStages(competition).flatMap((stage) => stage.rounds ?? []);
}

export function listCompetitionMatches(competition) {
  return listCompetitionRounds(competition).flatMap((round) => round.matches ?? []);
}

export function findCompetitionMatch(competition, matchId) {
  return listCompetitionMatches(competition).find((match) => match.id === matchId) ?? null;
}

export function findMatchContext(competition, matchId) {
  for (const stage of listCompetitionStages(competition)) {
    for (const round of stage.rounds ?? []) {
      const match = (round.matches ?? []).find((item) => item.id === matchId);
      if (match) return { stage, round, match };
    }
  }
  return null;
}

function matchDependsOn(match, matchId) {
  return (
    ((match?.sourceA?.type === 'winner' || match?.sourceA?.type === 'loser') &&
      match.sourceA.matchId === matchId) ||
    ((match?.sourceB?.type === 'winner' || match?.sourceB?.type === 'loser') &&
      match.sourceB.matchId === matchId)
  );
}

export function collectDownstreamMatches(competition, matchId) {
  const matches = listCompetitionMatches(competition);
  const found = [];
  const pending = [matchId];
  const seen = new Set();
  const context = findMatchContext(competition, matchId);

  while (pending.length > 0) {
    const currentId = pending.shift();
    for (const match of matches) {
      if (seen.has(match.id) || !matchDependsOn(match, currentId)) continue;
      seen.add(match.id);
      found.push(match);
      pending.push(match.id);
    }
  }

  if (context?.stage?.type === 'swiss') {
    for (const round of context.stage.rounds ?? []) {
      if ((round.number ?? 0) <= (context.round?.number ?? 0)) continue;
      for (const match of round.matches ?? []) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        found.push(match);
      }
    }
  }

  if (context?.stage) {
    const stageNumber = context.stage.number ?? 0;
    for (const stage of listCompetitionStages(competition)) {
      if ((stage.number ?? 0) <= stageNumber) continue;
      for (const match of (stage.rounds ?? []).flatMap((round) => round.matches ?? [])) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        found.push(match);
      }
    }
  }

  return found;
}

export function downstreamMatchesWithResults(competition, matchId) {
  return collectDownstreamMatches(competition, matchId).filter(
    (match) => !isMatchPending(match) || match.winnerTeamId != null
  );
}

function resolveSourceTeamId(source, matchById, seedTeamIds) {
  if (!isPlainObject(source)) return null;
  if (source.type === 'team') {
    return isNonEmptyId(source.teamId) ? source.teamId : null;
  }
  if (source.type === 'seed') {
    const teamId = seedTeamIds?.[source.seed - 1];
    return isNonEmptyId(teamId) ? teamId : null;
  }
  if (source.type !== 'winner' && source.type !== 'loser') return null;

  const origin = matchById.get(source.matchId);
  if (!origin || !isNonEmptyId(origin.winnerTeamId)) return null;
  if (source.type === 'winner') return origin.winnerTeamId;
  if (!isNonEmptyId(origin.teamAId) || !isNonEmptyId(origin.teamBId)) return null;
  return origin.winnerTeamId === origin.teamAId ? origin.teamBId : origin.teamAId;
}

function winnerFromScores(match) {
  if (!isMatchCompleted(match) || !match.teamAId || !match.teamBId) return null;
  return match.scoreA > match.scoreB ? match.teamAId : match.scoreB > match.scoreA ? match.teamBId : null;
}

function shouldResolveResetMatch(stage, match, matchById) {
  const gf = (stage.rounds ?? []).find((round) => round.bracket === 'grand_final')?.matches?.[0];
  if (!gf) return false;
  const wbChamp = resolveSourceTeamId(gf.sourceA, matchById, stage.seedTeamIds);
  return Boolean(gf.winnerTeamId && wbChamp && gf.winnerTeamId !== wbChamp);
}

export function resolveCompetitionParticipants(competition) {
  const next = cloneCompetition(competition);
  const matchById = new Map();

  for (const stage of next.stages) {
    for (const round of stage.rounds ?? []) {
      for (const match of round.matches ?? []) {
        if (round.bracket === 'grand_final_reset' && !shouldResolveResetMatch(stage, match, matchById)) {
          match.teamAId = null;
          match.teamBId = null;
          match.lineupA = [];
          match.lineupB = [];
          Object.assign(match, pendingMatchFields());
          matchById.set(match.id, match);
          continue;
        }

        const teamAId = resolveSourceTeamId(match.sourceA, matchById, stage.seedTeamIds);
        const teamBId = resolveSourceTeamId(match.sourceB, matchById, stage.seedTeamIds);
        const teamsChanged = match.teamAId !== teamAId || match.teamBId !== teamBId;

        match.teamAId = teamAId;
        match.teamBId = teamBId;

        if (teamsChanged || !Array.isArray(match.lineupA) || match.lineupA.length === 0) {
          match.lineupA = cloneTeamMembers(teamById(next, teamAId)?.members);
        }
        if (teamsChanged || !Array.isArray(match.lineupB) || match.lineupB.length === 0) {
          match.lineupB = cloneTeamMembers(teamById(next, teamBId)?.members);
        }

        if (teamsChanged) {
          Object.assign(match, pendingMatchFields());
        } else {
          match.winnerTeamId = winnerFromScores(match);
        }

        matchById.set(match.id, match);
      }
    }
  }

  return next;
}

function swissTeamIds(competition, stage) {
  return (stage.seedTeamIds ?? []).length > 0
    ? stage.seedTeamIds
    : (competition.teams ?? []).map((team) => team.id);
}

function isSwissStageFinished(stage) {
  const roundCount = stage.config?.roundCount;
  const rounds = stage.rounds ?? [];
  if (!Number.isInteger(roundCount) || rounds.length < roundCount) return false;
  return rounds.every((round) => isSwissRoundComplete(round));
}

function eliminationChampionTeamId(stage) {
  if (stage.type === 'double_elimination') {
    const reset = (stage.rounds ?? []).find((round) => round.bracket === 'grand_final_reset')?.matches?.[0];
    if (reset?.winnerTeamId) return reset.winnerTeamId;
    const gf = (stage.rounds ?? []).find((round) => round.bracket === 'grand_final')?.matches?.[0];
    if (gf?.winnerTeamId) {
      if (stage.config?.grandFinalMode === 'single_final') return gf.winnerTeamId;
      const wbChamp = gf.teamAId;
      if (gf.winnerTeamId === wbChamp) return gf.winnerTeamId;
      return null;
    }
  }
  const winners = (stage.rounds ?? []).filter((round) => round.bracket === 'winners' || round.bracket == null);
  const last = winners.at(-1)?.matches ?? [];
  if (last.length !== 1) return null;
  return last[0]?.winnerTeamId ?? null;
}

function isEliminationStageFinished(stage) {
  return Boolean(eliminationChampionTeamId(stage));
}

export function getFinalMatch(competition) {
  const stages = listCompetitionStages(competition);
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const stage = stages[index];
    if (stage.type === 'double_elimination') {
      const reset = (stage.rounds ?? []).find((round) => round.bracket === 'grand_final_reset')?.matches?.[0];
      if (reset?.winnerTeamId) return reset;
      const gf = (stage.rounds ?? []).find((round) => round.bracket === 'grand_final')?.matches?.[0];
      if (gf) return gf;
    }
    const winners = (stage.rounds ?? []).filter((round) => round.bracket === 'winners' || round.bracket == null);
    const last = winners.at(-1);
    if ((last?.matches ?? []).length === 1) return last.matches[0];
  }
  return null;
}

export function isCompetitionFinished(competition) {
  return Boolean(getCompetitionChampion(competition));
}

export function getCompetitionChampion(competition) {
  const stages = listCompetitionStages(competition);
  const last = stages.at(-1);
  if (!last) return null;
  if (last.type === 'swiss') {
    if (!isSwissStageFinished(last) || !last.seedSnapshot?.[0]?.teamId) return null;
    const team = teamById(competition, last.seedSnapshot[0].teamId);
    return team ? cloneCompetitionTeam(team) : null;
  }
  const winnerTeamId = eliminationChampionTeamId(last);
  if (!winnerTeamId) return null;
  const team = teamById(competition, winnerTeamId);
  return team ? cloneCompetitionTeam(team) : null;
}

function refreshStageStatus(competition, stage) {
  if ((stage.rounds ?? []).length === 0) {
    stage.status = 'pending';
    return;
  }
  if (stage.type === 'swiss') {
    if (isSwissStageFinished(stage)) {
      stage.status = 'finished';
      if (!stage.seedSnapshot) {
        stage.seedSnapshot = freezeSwissSeedSnapshot(getSwissStandings(stage, swissTeamIds(competition, stage)));
      }
    } else {
      stage.status = 'in_progress';
      stage.seedSnapshot = null;
    }
    return;
  }
  stage.status = isEliminationStageFinished(stage) ? 'finished' : 'in_progress';
}

export function recalculateCompetitionProgression(competition) {
  const next = resolveCompetitionParticipants(competition);
  for (const stage of next.stages) {
    refreshStageStatus(next, stage);
  }
  if (getCompetitionChampion(next)) {
    next.status = 'finished';
  } else if (listCompetitionRounds(next).length > 0) {
    next.status = 'in_progress';
  } else {
    next.status = 'draft';
  }
  return next;
}

function validateSource(source, field, matchIds, teamIds, seedCount) {
  if (!isPlainObject(source)) {
    return [error('COMPETITION_SOURCE_INVALID', 'A origem do participante é inválida.', { field })];
  }
  if (!SOURCE_TYPE_SET.has(source.type)) {
    return [
      error(
        'COMPETITION_SOURCE_TYPE_INVALID',
        'A origem do participante precisa ser time, vencedor, perdedor ou seed.',
        { field }
      ),
    ];
  }
  if (source.type === 'team') {
    if (!isNonEmptyId(source.teamId) || (teamIds && !teamIds.has(source.teamId))) {
      return [error('COMPETITION_SOURCE_TEAM_INVALID', 'O time de origem é inválido.', { field })];
    }
    return [];
  }
  if (source.type === 'seed') {
    if (!Number.isInteger(source.seed) || source.seed < 1 || (seedCount != null && source.seed > seedCount)) {
      return [error('COMPETITION_SOURCE_SEED_INVALID', 'O seed de origem é inválido.', { field })];
    }
    return [];
  }
  if (!isNonEmptyId(source.matchId) || (matchIds && !matchIds.has(source.matchId))) {
    return [error('COMPETITION_SOURCE_MATCH_INVALID', 'A partida de origem é inválida.', { field })];
  }
  return [];
}

function validateMembers(members, teamSize, seenPlayerIds) {
  const errors = [];
  if (!Array.isArray(members)) {
    return [error('COMPETITION_TEAM_MEMBERS_INVALID', 'Os integrantes do time são inválidos.')];
  }
  if (members.length > teamSize) {
    errors.push(
      error('COMPETITION_TEAM_OVER_CAPACITY', `O time não pode ter mais de ${teamSize} jogadores.`)
    );
  }

  const localIds = [];
  members.forEach((member, index) => {
    if (!isPlainObject(member) || !isNonEmptyId(member.playerId)) {
      errors.push(
        error('COMPETITION_MEMBER_ID_INVALID', 'O jogador do time precisa ter um identificador.', { index })
      );
      return;
    }
    if (typeof member.playerName !== 'string') {
      errors.push(
        error('COMPETITION_MEMBER_NAME_INVALID', 'O nome do jogador no time é inválido.', {
          playerId: member.playerId,
        })
      );
    }
    localIds.push(member.playerId);
    if (seenPlayerIds.has(member.playerId)) {
      errors.push(
        error('COMPETITION_PLAYER_DUPLICATE', 'O mesmo jogador não pode estar em dois times.', {
          playerId: member.playerId,
        })
      );
    }
    seenPlayerIds.add(member.playerId);
  });

  if (new Set(localIds).size !== localIds.length) {
    errors.push(error('COMPETITION_TEAM_PLAYER_DUPLICATE', 'Há jogadores repetidos no mesmo time.'));
  }

  return errors;
}

export function validateCompetitionFormat(format) {
  if (!isPlainObject(format)) {
    return fail([error('COMPETITION_FORMAT_REQUIRED', 'O formato da competição é obrigatório.')]);
  }
  const teamSize = format.teamSize;
  if (!Number.isInteger(teamSize) || teamSize < MIN_TEAM_SIZE || teamSize > MAX_TEAM_SIZE) {
    return fail([
      error(
        'COMPETITION_TEAM_SIZE_INVALID',
        `O tamanho do time deve ser um inteiro entre ${MIN_TEAM_SIZE} e ${MAX_TEAM_SIZE}.`
      ),
    ]);
  }
  return ok();
}

function validateStageConfig(stage) {
  const errors = [];
  if (!STAGE_TYPE_SET.has(stage.type)) {
    errors.push(error('COMPETITION_STAGE_TYPE_INVALID', 'O tipo da fase é inválido.', { stageId: stage.id }));
    return errors;
  }
  if (stage.type === 'swiss') {
    const roundCount = stage.config?.roundCount;
    if (!Number.isInteger(roundCount) || roundCount < 1) {
      errors.push(
        error('SWISS_ROUND_COUNT_INVALID', 'A fase suíça precisa de uma quantidade de rodadas inteira e positiva.', {
          stageId: stage.id,
        })
      );
    }
  }
  if (stage.type === 'double_elimination') {
    const mode = stage.config?.grandFinalMode;
    if (mode != null && !GRAND_FINAL_MODE_SET.has(mode)) {
      errors.push(
        error('COMPETITION_GRAND_FINAL_MODE_INVALID', 'O modo da Grand Final é inválido.', { stageId: stage.id })
      );
    }
  }
  return errors;
}

function validateMatchList(stage, teamIds, errors) {
  const roundIds = new Set();
  const matchIds = new Set();
  const allMatches = [];
  const seedCount = (stage.seedTeamIds ?? []).length;

  (stage.rounds ?? []).forEach((round, roundIndex) => {
    if (!isPlainObject(round) || !isNonEmptyId(round.id)) {
      errors.push(
        error('COMPETITION_ROUND_ID_REQUIRED', 'O identificador da rodada é obrigatório.', {
          stageId: stage.id,
          roundIndex,
        })
      );
      return;
    }
    if (roundIds.has(round.id)) {
      errors.push(error('COMPETITION_ROUND_ID_DUPLICATE', 'Há rodadas com o mesmo identificador.', { roundId: round.id }));
    }
    roundIds.add(round.id);
    if (!Number.isInteger(round.number) || round.number < 1) {
      errors.push(error('COMPETITION_ROUND_NUMBER_INVALID', 'O número da rodada é inválido.', { roundId: round.id }));
    }
    if (round.bracket != null && !BRACKET_SET.has(round.bracket)) {
      errors.push(error('COMPETITION_ROUND_BRACKET_INVALID', 'O bracket da rodada é inválido.', { roundId: round.id }));
    }
    if (!Array.isArray(round.matches)) {
      errors.push(error('COMPETITION_ROUND_MATCHES_INVALID', 'As partidas da rodada são inválidas.', { roundId: round.id }));
      return;
    }
    if (round.byes != null && !Array.isArray(round.byes)) {
      errors.push(error('COMPETITION_ROUND_BYES_INVALID', 'Os BYEs da rodada são inválidos.', { roundId: round.id }));
    }
    (round.byes ?? []).forEach((bye) => {
      if (!isNonEmptyId(bye?.teamId) || !teamIds.has(bye.teamId)) {
        errors.push(error('COMPETITION_BYE_TEAM_INVALID', 'O time do BYE é inválido.', { roundId: round.id }));
      }
    });
    round.matches.forEach((match, matchIndex) => {
      if (!isPlainObject(match) || !isNonEmptyId(match.id)) {
        errors.push(
          error('COMPETITION_MATCH_ID_REQUIRED', 'O identificador da partida é obrigatório.', {
            roundId: round.id,
            matchIndex,
          })
        );
        return;
      }
      if (matchIds.has(match.id)) {
        errors.push(error('COMPETITION_MATCH_ID_DUPLICATE', 'Há partidas com o mesmo identificador.', { matchId: match.id }));
      }
      matchIds.add(match.id);
      allMatches.push({ match, seedCount });
      if (match.roundId !== round.id) {
        errors.push(
          error('COMPETITION_MATCH_ROUND_MISMATCH', 'A partida não pertence à rodada informada.', {
            matchId: match.id,
          })
        );
      }
    });
  });

  allMatches.forEach(({ match, seedCount: count }) => {
    errors.push(...validateSource(match.sourceA, 'sourceA', matchIds, teamIds, count));
    errors.push(...validateSource(match.sourceB, 'sourceB', matchIds, teamIds, count));

    for (const side of ['teamAId', 'teamBId']) {
      const teamId = match[side];
      if (teamId != null && (!isNonEmptyId(teamId) || !teamIds.has(teamId))) {
        errors.push(error('COMPETITION_MATCH_TEAM_INVALID', 'O time da partida é inválido.', { matchId: match.id, field: side }));
      }
    }

    if (match.teamAId && match.teamBId && match.teamAId === match.teamBId) {
      errors.push(error('COMPETITION_MATCH_SAME_TEAM', 'Uma partida precisa ter dois times distintos.', { matchId: match.id }));
    }

    const scoreResult = validateScore(match.scoreA, match.scoreB);
    if (!scoreResult.ok) {
      errors.push(...scoreResult.errors.map((item) => ({ ...item, matchId: match.id })));
    }

    if (match.playedDate != null) {
      const dateResult = validateDate(match.playedDate);
      if (!dateResult.ok) {
        errors.push(...dateResult.errors.map((item) => ({ ...item, matchId: match.id, field: 'playedDate' })));
      }
    }

    if (isMatchCompleted(match) && match.playedDate == null) {
      errors.push(
        error('COMPETITION_PLAYED_DATE_REQUIRED', 'A data da partida é obrigatória quando há placar.', {
          matchId: match.id,
        })
      );
    }

    if (match.winnerTeamId != null) {
      if (!teamIds.has(match.winnerTeamId)) {
        errors.push(error('COMPETITION_WINNER_INVALID', 'O vencedor da partida é inválido.', { matchId: match.id }));
      } else if (match.winnerTeamId !== match.teamAId && match.winnerTeamId !== match.teamBId) {
        errors.push(
          error('COMPETITION_WINNER_NOT_IN_MATCH', 'O vencedor precisa ser um dos times da partida.', {
            matchId: match.id,
          })
        );
      }
    }

    if (isMatchCompleted(match) && match.teamAId && match.teamBId) {
      const expectedWinner = match.scoreA > match.scoreB ? match.teamAId : match.teamBId;
      if (match.winnerTeamId !== expectedWinner) {
        errors.push(
          error('COMPETITION_WINNER_SCORE_MISMATCH', 'O vencedor não corresponde ao placar.', { matchId: match.id })
        );
      }
    }
  });
}

export function validateCompetition(competition) {
  if (!isPlainObject(competition)) {
    return fail([error('COMPETITION_INVALID', 'A competição precisa ser um objeto.')]);
  }

  const errors = [];
  if (!isNonEmptyId(competition.id)) {
    errors.push(error('COMPETITION_ID_REQUIRED', 'O identificador da competição é obrigatório.'));
  }
  if (competition.name != null && typeof competition.name !== 'string') {
    errors.push(error('COMPETITION_NAME_INVALID', 'O nome da competição é inválido.'));
  }
  if (competition.date != null && competition.date !== '') {
    const dateResult = validateDate(competition.date);
    if (!dateResult.ok) {
      errors.push(...dateResult.errors.map((item) => ({ ...item, field: 'date' })));
    }
  }
  if (!STATUS_SET.has(competition.status)) {
    errors.push(
      error(
        'COMPETITION_STATUS_INVALID',
        'O status da competição precisa ser rascunho, em andamento ou finalizado.'
      )
    );
  }
  if (typeof competition.createdAt !== 'string' || competition.createdAt.trim() === '') {
    errors.push(error('COMPETITION_CREATED_AT_REQUIRED', 'A data de criação é obrigatória.'));
  }
  if (typeof competition.updatedAt !== 'string' || competition.updatedAt.trim() === '') {
    errors.push(error('COMPETITION_UPDATED_AT_REQUIRED', 'A data de atualização é obrigatória.'));
  }

  const formatResult = validateCompetitionFormat(competition.format);
  if (!formatResult.ok) errors.push(...formatResult.errors);
  const teamSize = competition.format?.teamSize;

  if (!Array.isArray(competition.teams)) {
    errors.push(error('COMPETITION_TEAMS_INVALID', 'A lista de times é inválida.'));
    return fail(errors);
  }
  if (!Array.isArray(competition.stages)) {
    errors.push(error('COMPETITION_STAGES_INVALID', 'A lista de fases é inválida.'));
    return fail(errors);
  }
  if (competition.stages.length < 1) {
    errors.push(error('COMPETITION_STAGES_REQUIRED', 'A competição precisa de pelo menos uma fase.'));
  }

  const teamIds = new Set();
  const seenPlayerIds = new Set();
  competition.teams.forEach((team, index) => {
    if (!isPlainObject(team) || !isNonEmptyId(team.id)) {
      errors.push(error('COMPETITION_TEAM_ID_REQUIRED', 'O identificador do time é obrigatório.', { index }));
      return;
    }
    if (teamIds.has(team.id)) {
      errors.push(error('COMPETITION_TEAM_ID_DUPLICATE', 'Há times com o mesmo identificador.', { teamId: team.id }));
    }
    teamIds.add(team.id);
    if (Number.isInteger(teamSize)) {
      errors.push(...validateMembers(team.members, teamSize, seenPlayerIds));
    }
  });

  const stageIds = new Set();
  competition.stages.forEach((stage, index) => {
    if (!isPlainObject(stage) || !isNonEmptyId(stage.id)) {
      errors.push(error('COMPETITION_STAGE_ID_REQUIRED', 'O identificador da fase é obrigatório.', { index }));
      return;
    }
    if (stageIds.has(stage.id)) {
      errors.push(error('COMPETITION_STAGE_ID_DUPLICATE', 'Há fases com o mesmo identificador.', { stageId: stage.id }));
    }
    stageIds.add(stage.id);
    if (!Number.isInteger(stage.number) || stage.number !== index + 1) {
      errors.push(error('COMPETITION_STAGE_NUMBER_INVALID', 'O número da fase é inválido.', { stageId: stage.id }));
    }
    if (!STAGE_STATUS_SET.has(stage.status)) {
      errors.push(error('COMPETITION_STAGE_STATUS_INVALID', 'O status da fase é inválido.', { stageId: stage.id }));
    }
    errors.push(...validateStageConfig(stage));
    if (!Array.isArray(stage.rounds)) {
      errors.push(error('COMPETITION_ROUNDS_INVALID', 'A lista de rodadas é inválida.', { stageId: stage.id }));
      return;
    }
    validateMatchList(stage, teamIds, errors);
  });

  const hasRounds = listCompetitionRounds(competition).length > 0;
  if (competition.status !== 'draft' && !hasRounds) {
    errors.push(
      error('COMPETITION_ROUNDS_REQUIRED', 'Uma competição em andamento precisa ter a chave gerada.')
    );
  }

  if (competition.status === 'finished' && !isCompetitionFinished(competition)) {
    errors.push(
      error('COMPETITION_FINISHED_WITHOUT_CHAMPION', 'Uma competição finalizada precisa ter um campeão.')
    );
  }

  return errors.length > 0 ? fail(errors) : ok();
}

export function validateCompetitionDocument(document) {
  if (!isPlainObject(document)) {
    return fail([error('COMPETITION_DOCUMENT_INVALID', 'O documento de competições precisa ser um objeto.')]);
  }
  if (!Object.prototype.hasOwnProperty.call(document, 'schemaVersion')) {
    return fail([error('SCHEMA_VERSION_REQUIRED', 'A versão do schema é obrigatória.')]);
  }
  if (document.schemaVersion !== COMPETITION_SCHEMA_VERSION) {
    return fail([
      error(
        'SCHEMA_VERSION_UNSUPPORTED',
        `Versão de schema de competições não suportada: ${String(document.schemaVersion)}.`
      ),
    ]);
  }
  if (!Array.isArray(document.competitions)) {
    return fail([error('COMPETITIONS_INVALID', 'O documento precisa ter uma lista de competições.')]);
  }

  const errors = [];
  const ids = new Set();
  document.competitions.forEach((competition, index) => {
    const result = validateCompetition(competition);
    if (!result.ok) {
      errors.push(
        ...result.errors.map((item) => ({
          ...item,
          competitionIndex: index,
          competitionId: competition?.id,
        }))
      );
    }
    if (isNonEmptyId(competition?.id)) {
      if (ids.has(competition.id)) {
        errors.push(
          error('COMPETITION_ID_DUPLICATE', 'Há competições com o mesmo identificador.', {
            competitionId: competition.id,
          })
        );
      }
      ids.add(competition.id);
    }
  });

  return errors.length > 0 ? fail(errors) : ok();
}

function defaultStageInputs() {
  return [{ type: 'single_elimination', config: {} }];
}

function normalizeStageInput(input, index, createId) {
  const type = input?.type ?? 'single_elimination';
  let config = isPlainObject(input?.config) ? { ...input.config } : {};
  if (type === 'swiss') {
    config = { roundCount: Number.isInteger(input?.config?.roundCount) ? input.config.roundCount : 3 };
  }
  if (type === 'double_elimination') {
    config = { grandFinalMode: input?.config?.grandFinalMode ?? 'bracket_reset' };
  }
  return {
    id: isNonEmptyId(input?.id) ? input.id : createId(),
    number: index + 1,
    name: typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : stageNameForType(type, index),
    type,
    status: 'pending',
    config,
    seedTeamIds: [],
    seedSnapshot: null,
    rounds: [],
  };
}

export function createDraftCompetition(input = {}, { idGenerator, now } = {}) {
  const format = { teamSize: input?.format?.teamSize ?? MIN_TEAM_SIZE };
  const formatResult = validateCompetitionFormat(format);
  if (!formatResult.ok) {
    throw new Error(formatResult.errors[0]?.message || 'O formato da competição é inválido.');
  }

  const createId = resolveIdGenerator(idGenerator);
  const instant = resolveNow(now)();
  let date = localDateString(instant);
  if (Object.prototype.hasOwnProperty.call(input ?? {}, 'date') && input.date != null && input.date !== '') {
    const dateResult = validateDate(input.date);
    if (!dateResult.ok) {
      throw new Error(dateResult.errors[0]?.message || 'A data da competição é inválida.');
    }
    date = input.date;
  }

  const createdAt = instant.toISOString();
  const stageInputs = Array.isArray(input?.stages) && input.stages.length > 0 ? input.stages : defaultStageInputs();
  return {
    id: createId(),
    name: normalizeName(input?.name),
    date,
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    format,
    seedTeamIds: [],
    teams: [],
    stages: stageInputs.map((stage, index) => normalizeStageInput(stage, index, createId)),
  };
}

function normalizeTeamInput(team, createId) {
  const members = Array.isArray(team?.members) ? cloneTeamMembers(team.members) : cloneTeamMembers(team);
  return {
    id: isNonEmptyId(team?.id) ? team.id : createId(),
    members,
  };
}

function hasGeneratedRounds(competition) {
  return listCompetitionRounds(competition).length > 0;
}

export function setDraftCompetitionTeams(competition, teamsInput, { idGenerator } = {}) {
  if (competition?.status !== 'draft' || hasGeneratedRounds(competition)) {
    return fail([
      error('COMPETITION_TEAMS_LOCKED', 'Os times só podem ser alterados no rascunho, antes de gerar a chave.'),
    ]);
  }
  if (!Array.isArray(teamsInput)) {
    return fail([error('COMPETITION_TEAMS_INVALID', 'A lista de times é inválida.')]);
  }

  const createId = resolveIdGenerator(idGenerator);
  const next = cloneCompetition(competition);
  next.teams = teamsInput.map((team) => normalizeTeamInput(team, createId));
  const result = validateCompetition(next);
  if (!result.ok) return result;
  return { ok: true, errors: [], competition: next };
}

function assertTeamsReadyForBracket(competition) {
  const teams = competition?.teams ?? [];
  if (teams.length < MIN_COMPETITION_TEAM_COUNT) {
    return fail([
      error(
        'COMPETITION_TOO_FEW_TEAMS',
        `A chave precisa de pelo menos ${MIN_COMPETITION_TEAM_COUNT} times.`
      ),
    ]);
  }

  const teamSize = competition.format?.teamSize;
  const incomplete = teams.filter((team) => (team.members ?? []).length !== teamSize);
  if (incomplete.length > 0) {
    return fail([
      error(
        'COMPETITION_TEAM_INCOMPLETE',
        `Cada time precisa ter exatamente ${teamSize} jogadores para gerar a chave.`
      ),
    ]);
  }

  return ok();
}

function orderedSeedTeams(competition, seedTeamIds) {
  const byId = new Map((competition.teams ?? []).map((team) => [team.id, team]));
  const ids = seedTeamIds ?? competition.seedTeamIds;
  if (ids == null || ids.length === 0) {
    return (competition.teams ?? []).map((team) => team);
  }
  if (!Array.isArray(ids) || ids.length !== competition.teams.length) return null;
  const seen = new Set();
  const ordered = [];
  for (const teamId of ids) {
    if (seen.has(teamId) || !byId.has(teamId)) return null;
    seen.add(teamId);
    ordered.push(byId.get(teamId));
  }
  return ordered;
}

export function generateSingleEliminationRounds(teams, { idGenerator } = {}) {
  const seedTeamIds = (teams ?? []).map((team) => team.id);
  return generateSingleEliminationStageRounds(seedTeamIds, { idGenerator });
}

function seedsForStage(competition, stage, seedTeamIds) {
  if ((stage.number ?? 1) > 1) {
    const previous = competition.stages.find((item) => item.number === stage.number - 1);
    if (previous?.seedSnapshot?.length) {
      return previous.seedSnapshot.map((row) => row.teamId);
    }
  }
  const ordered = orderedSeedTeams(competition, seedTeamIds);
  return ordered ? ordered.map((team) => team.id) : null;
}

function generateStageRounds(stage, seedTeamIds, { idGenerator }) {
  if (stage.type === 'swiss') {
    return [createFirstSwissRound(seedTeamIds, { idGenerator })];
  }
  if (stage.type === 'single_elimination') {
    return generateSingleEliminationStageRounds(seedTeamIds, { idGenerator });
  }
  if (stage.type === 'double_elimination') {
    return generateDoubleEliminationRounds(seedTeamIds, {
      grandFinalMode: stage.config?.grandFinalMode ?? 'bracket_reset',
      idGenerator,
    });
  }
  return null;
}

function nextActionableStage(competition) {
  for (const stage of competition.stages ?? []) {
    if (stage.type === 'swiss' && stage.status === 'in_progress') {
      const roundCount = stage.config?.roundCount ?? 0;
      const rounds = stage.rounds ?? [];
      const last = rounds.at(-1);
      if (rounds.length < roundCount && last && isSwissRoundComplete(last)) {
        return { stage, action: 'swiss-next' };
      }
      if (rounds.length < roundCount && last && !isSwissRoundComplete(last)) {
        return { stage, action: 'swiss-wait' };
      }
    }
    if (stage.status === 'pending' || (stage.rounds ?? []).length === 0) {
      const previous = (competition.stages ?? []).find((item) => item.number === stage.number - 1);
      if (!previous || previous.status === 'finished') {
        return { stage, action: 'start' };
      }
    }
  }
  return null;
}

export function getCompetitionGenerateTarget(competition) {
  return nextActionableStage(competition);
}

function regenerateTarget(competition) {
  return (competition.stages ?? []).find((stage) => (stage.rounds ?? []).length > 0) ?? null;
}

function resetLaterStages(competition, fromNumber) {
  for (const stage of competition.stages ?? []) {
    if ((stage.number ?? 0) <= fromNumber) continue;
    stage.rounds = [];
    stage.seedTeamIds = [];
    stage.seedSnapshot = null;
    stage.status = 'pending';
  }
}

export function generateCompetitionBracket(
  competition,
  { seedTeamIds, idGenerator, generateConfirmed = false } = {}
) {
  const ready = assertTeamsReadyForBracket(competition);
  if (!ready.ok) return ready;

  const next = cloneCompetition(competition);
  let target = nextActionableStage(next);
  if (!target) {
    const existing = regenerateTarget(next);
    if (existing) {
      target = { stage: existing, action: 'start' };
    } else {
      return fail([error('COMPETITION_STAGE_NOT_READY', 'Não há fase pendente para gerar.')]);
    }
  }
  if (target.action === 'swiss-wait') {
    return assertSwissRoundCompleteForNext(target.stage);
  }

  if (target.action === 'swiss-next') {
    const pairing = createNextSwissRound(target.stage, swissTeamIds(next, target.stage), { idGenerator });
    if (!pairing.ok) return pairing;
    target.stage.rounds = [...target.stage.rounds, pairing.round];
    const progressed = recalculateCompetitionProgression(next);
    const result = validateCompetition(progressed);
    if (!result.ok) return result;
    return { ok: true, errors: [], competition: progressed };
  }

  if ((target.stage.rounds ?? []).length > 0 && !generateConfirmed) {
    return fail([error(GENERATE_BRACKET_CONFIRMATION_REQUIRED, GENERATE_BRACKET_CONFIRMATION_MESSAGE)]);
  }

  const seeds = seedsForStage(next, target.stage, seedTeamIds);
  if (!seeds) {
    return fail([
      error(
        'COMPETITION_SEED_INVALID',
        'A ordem dos times da chave precisa listar todos os times exatamente uma vez.'
      ),
    ]);
  }
  if ((target.stage.number ?? 1) > 1 && !next.stages.find((stage) => stage.number === target.stage.number - 1)?.seedSnapshot) {
    return fail([
      error('COMPETITION_STAGE_SEED_MISSING', 'A fase anterior precisa ter a classificação congelada antes de gerar a próxima chave.'),
    ]);
  }

  const rounds = generateStageRounds(target.stage, seeds, { idGenerator });
  if (!rounds) {
    return fail([
      error('COMPETITION_STAGE_TYPE_UNSUPPORTED', 'Este tipo de fase ainda não pode ser gerado.', {
        stageId: target.stage.id,
      }),
    ]);
  }

  if ((target.stage.number ?? 1) === 1) next.seedTeamIds = seeds;
  target.stage.seedTeamIds = seeds;
  target.stage.rounds = rounds;
  target.stage.seedSnapshot = null;
  resetLaterStages(next, target.stage.number);
  const progressed = recalculateCompetitionProgression(next);
  const result = validateCompetition(progressed);
  if (!result.ok) return result;
  return { ok: true, errors: [], competition: progressed };
}

function requireResolvedMatch(match) {
  if (!isNonEmptyId(match?.teamAId) || !isNonEmptyId(match?.teamBId)) {
    return fail([
      error('COMPETITION_MATCH_TEAMS_UNRESOLVED', 'A partida ainda não tem os dois times definidos.'),
    ]);
  }
  return ok();
}

function validatePlayedDate(playedDate) {
  if (playedDate == null || playedDate === '') {
    return fail([
      error('COMPETITION_PLAYED_DATE_REQUIRED', 'A data da partida é obrigatória.', { field: 'playedDate' }),
    ]);
  }
  return validateDate(playedDate);
}

function clearMatchResult(match) {
  Object.assign(match, pendingMatchFields());
}

function confirmationForDownstream(competition, matchId, code, message) {
  const affected = downstreamMatchesWithResults(competition, matchId).map((match) => ({
    id: match.id,
    roundId: match.roundId,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    playedDate: match.playedDate,
    winnerTeamId: match.winnerTeamId,
  }));
  return fail([
    error(code, message, {
      affectedMatchIds: affected.map((item) => item.id),
      affectedMatches: affected,
    }),
  ]);
}

function applySwissDownstreamClear(competition, matchId) {
  const context = findMatchContext(competition, matchId);
  if (!context) return;
  if (context.stage.type === 'swiss') {
    context.stage.rounds = (context.stage.rounds ?? []).filter(
      (round) => (round.number ?? 0) <= (context.round?.number ?? 0)
    );
    context.stage.seedSnapshot = null;
  }
  resetLaterStages(competition, context.stage.number ?? 0);
}

function clearDownstreamResults(competition, matchId) {
  const affectedIds = new Set(collectDownstreamMatches(competition, matchId).map((match) => match.id));
  for (const match of listCompetitionMatches(competition)) {
    if (!affectedIds.has(match.id)) continue;
    clearMatchResult(match);
  }
  applySwissDownstreamClear(competition, matchId);
}

function maybeGenerateNextSwissRound(competition, matchId, idGenerator, { skip = false } = {}) {
  if (skip) return competition;
  const context = findMatchContext(competition, matchId);
  if (!context || context.stage.type !== 'swiss') return competition;
  const stage = context.stage;
  const roundCount = stage.config?.roundCount ?? 0;
  const current = stage.rounds.at(-1);
  if (!current || !isSwissRoundComplete(current)) return competition;
  if ((stage.rounds ?? []).length >= roundCount) return competition;
  const pairing = createNextSwissRound(stage, swissTeamIds(competition, stage), { idGenerator });
  if (!pairing.ok) return competition;
  stage.rounds = [...stage.rounds, pairing.round];
  return competition;
}

export function applyCompetitionMatchResult(
  competition,
  matchId,
  { scoreA, scoreB, playedDate } = {},
  { downstreamConfirmed = false, idGenerator } = {}
) {
  const next = cloneCompetition(competition);
  const match = findCompetitionMatch(next, matchId);
  if (!match) {
    return fail([error('COMPETITION_MATCH_NOT_FOUND', 'Partida não encontrada.')]);
  }

  const resolvedCheck = requireResolvedMatch(match);
  if (!resolvedCheck.ok) return resolvedCheck;

  const scoreResult = validateScore(scoreA, scoreB);
  if (!scoreResult.ok) return scoreResult;
  if (isMatchPending({ scoreA, scoreB })) {
    return fail([
      error('COMPETITION_SCORE_REQUIRED', 'Informe o placar dos dois lados para registrar o resultado.'),
    ]);
  }

  const dateResult = validatePlayedDate(playedDate);
  if (!dateResult.ok) return dateResult;

  const nextWinner = scoreA > scoreB ? match.teamAId : match.teamBId;
  const winnerChanged = match.winnerTeamId != null && match.winnerTeamId !== nextWinner;
  const scoreChanged = match.scoreA !== scoreA || match.scoreB !== scoreB;
  const affected = downstreamMatchesWithResults(next, matchId);
  const context = findMatchContext(next, matchId);
  const swissLater =
    context?.stage?.type === 'swiss' &&
    (context.stage.rounds ?? []).some((round) => (round.number ?? 0) > (context.round?.number ?? 0));
  const needsConfirm =
    (winnerChanged && affected.length > 0) ||
    (context?.stage?.type === 'swiss' && (winnerChanged || scoreChanged) && (affected.length > 0 || swissLater));

  if (needsConfirm && !downstreamConfirmed) {
    return confirmationForDownstream(
      next,
      matchId,
      COMPETITION_DOWNSTREAM_CONFIRMATION_REQUIRED,
      COMPETITION_DOWNSTREAM_CONFIRMATION_MESSAGE
    );
  }

  if (needsConfirm && downstreamConfirmed) {
    clearDownstreamResults(next, matchId);
  }

  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.playedDate = playedDate;
  match.winnerTeamId = nextWinner;

  maybeGenerateNextSwissRound(next, matchId, idGenerator, { skip: Boolean(needsConfirm && downstreamConfirmed) });
  const progressed = recalculateCompetitionProgression(next);
  const result = validateCompetition(progressed);
  if (!result.ok) return result;
  return { ok: true, errors: [], competition: progressed };
}

export function clearCompetitionMatchResult(
  competition,
  matchId,
  { clearConfirmed = false, downstreamConfirmed = false } = {}
) {
  const next = cloneCompetition(competition);
  const match = findCompetitionMatch(next, matchId);
  if (!match) {
    return fail([error('COMPETITION_MATCH_NOT_FOUND', 'Partida não encontrada.')]);
  }

  if (isMatchPending(match) && match.winnerTeamId == null) {
    return { ok: true, errors: [], competition: next, unchanged: true };
  }

  const affected = downstreamMatchesWithResults(next, matchId);
  if (!clearConfirmed && !downstreamConfirmed) {
    return fail([
      error(CLEAR_COMPETITION_RESULT_CONFIRMATION_REQUIRED, CLEAR_COMPETITION_RESULT_CONFIRMATION_MESSAGE, {
        affectedMatchIds: affected.map((item) => item.id),
        affectedMatches: affected.map((item) => ({
          id: item.id,
          roundId: item.roundId,
          winnerTeamId: item.winnerTeamId,
        })),
      }),
    ]);
  }

  if (affected.length > 0 || findMatchContext(next, matchId)?.stage?.type === 'swiss') {
    clearDownstreamResults(next, matchId);
  }
  clearMatchResult(match);

  const progressed = recalculateCompetitionProgression(next);
  const result = validateCompetition(progressed);
  if (!result.ok) return result;
  return { ok: true, errors: [], competition: progressed };
}

export function countPlayedMatches(competition) {
  return listCompetitionMatches(competition).filter((match) => isMatchCompleted(match)).length;
}

export { cloneCompetitionSource, cloneCompetitionMatch, cloneCompetitionRound };
export { generateDoubleEliminationRounds } from './competitionDoubleElimination.js';
export {
  pairFirstSwissRound,
  pairSwissTeams,
  selectSwissBye,
  swissByeHistory,
  swissPlayedPairKeys,
  isSwissRoundComplete,
} from './competitionSwiss.js';
