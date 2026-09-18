import { isMatchCompleted, isMatchPending, validateDate } from './domain/sessionValidation.js';
import {
  getCompetitionChampion,
  getCompetitionGenerateTarget,
  getFinalMatch,
  getSwissStandings,
  listCompetitionMatches,
  listCompetitionRounds,
  listCompetitionStages,
  MIN_COMPETITION_TEAM_COUNT,
  validateCompetitionFormat,
} from './domain/competition.js';
import { stageNameForType } from './domain/competitionPrimitives.js';
import { parseRequiredInteger } from './teamFormationUi.js';
import { formatSessionDate } from './teamGameSessions.js';
import {
  formatFormatLabel,
  formatSessionTeamLabel,
  memberNames,
  missingTeamLabel,
  SESSION_FORMAT_OPTIONS,
  teamUnitNoun,
} from './teamPresentation.js';
import { formatMatchScore, matchWinningSide } from './roundDisplay.js';

export const COMPETITION_STATUS_LABELS = Object.freeze({
  draft: 'Rascunho',
  in_progress: 'Em andamento',
  finished: 'Finalizado',
});

export const COMPETITION_STAGE_STATUS_LABELS = Object.freeze({
  pending: 'Pendente',
  in_progress: 'Em andamento',
  finished: 'Finalizado',
});

export const COMPETITION_STRUCTURE_OPTIONS = Object.freeze([
  {
    id: 'swiss_then_double',
    label: 'Suíço + double elimination',
  },
  {
    id: 'single_elimination',
    label: 'Eliminação simples',
  },
  {
    id: 'swiss',
    label: 'Somente sistema suíço',
  },
  {
    id: 'double_elimination',
    label: 'Somente double elimination',
  },
]);

export const COMPETITION_GRAND_FINAL_MODE_OPTIONS = Object.freeze([
  { id: 'bracket_reset', label: 'Grand Final com reset' },
  { id: 'single_final', label: 'Grand Final única' },
]);

export const COMPETITION_BYE_LABEL = 'BYE';
export const COMPETITION_BYE_HINT = 'Avança sem jogar';
export const COMPETITION_WINNER_LABEL = 'Venceu';
export const COMPETITION_CHAMPION_HEADING = 'Campeão';
export const COMPETITION_PENDING_SIDE_LABEL = 'Aguardando vencedor';
export const COMPETITION_UNRESOLVED_MATCH_HINT = 'Aguardando os dois times';

const STATUS_ORDER = {
  in_progress: 0,
  draft: 1,
  finished: 2,
};

export function translateCompetitionStatus(status) {
  return COMPETITION_STATUS_LABELS[status] ?? status ?? '';
}

export function competitionDisplayName(competition) {
  const name = typeof competition?.name === 'string' ? competition.name.trim() : '';
  return name || 'Competição sem nome';
}

export function competitionDateValue(competition) {
  if (typeof competition?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(competition.date)) {
    return competition.date;
  }
  if (typeof competition?.createdAt === 'string' && competition.createdAt.length >= 10) {
    return competition.createdAt.slice(0, 10);
  }
  return '';
}

export function formatCompetitionDate(competition) {
  return formatSessionDate(competitionDateValue(competition));
}

export function competitionTeamSize(competition) {
  const teamSize = competition?.format?.teamSize;
  return Number.isInteger(teamSize) ? teamSize : 2;
}

export function competitionTeamLabel(team, { teamSize = 2, index = 0 } = {}) {
  if (!team) return missingTeamLabel(teamSize);
  return formatSessionTeamLabel(team, { teamSize, index });
}

export function competitionTeamById(competition, teamId) {
  return (competition?.teams ?? []).find((team) => team?.id === teamId) ?? null;
}

export function competitionSideLabel(competition, teamId, lineup) {
  const teamSize = competitionTeamSize(competition);
  const names = memberNames(lineup);
  if (names.length > 0) {
    return formatSessionTeamLabel({ members: lineup }, { teamSize, index: 0 });
  }
  if (!teamId) return COMPETITION_PENDING_SIDE_LABEL;
  const index = (competition?.teams ?? []).findIndex((team) => team?.id === teamId);
  const team = index >= 0 ? competition.teams[index] : null;
  return competitionTeamLabel(team, { teamSize, index: Math.max(index, 0) });
}

export function currentCompetitionPhase(competition) {
  const rounds = listCompetitionRounds(competition);
  if (!competition || competition.status === 'draft' || rounds.length === 0) {
    return 'Rascunho';
  }
  const stages = listCompetitionStages(competition);
  const stage =
    stages.find((item) => item.status === 'in_progress') ??
    (competition.status === 'finished' ? stages.at(-1) : stages.find((item) => item.status === 'pending')) ??
    stages.at(-1);
  const stageLabel = stage?.name || stageNameForType(stage?.type, (stage?.number ?? 1) - 1);
  const stageRounds = [...(stage?.rounds ?? [])].sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
  if (stageRounds.length === 0) return stageLabel;
  const pendingRound = stageRounds.find((round) =>
    (round.matches ?? []).some((match) => !isMatchCompleted(match))
  );
  const roundName =
    (competition.status === 'finished' ? stageRounds.at(-1)?.name : pendingRound?.name || stageRounds.at(-1)?.name) ||
    '';
  return roundName ? `${stageLabel} · ${roundName}` : stageLabel;
}

export function competitionsForDisplay(competitions) {
  return [...(Array.isArray(competitions) ? competitions : [])].sort((left, right) => {
    const byStatus =
      (STATUS_ORDER[left?.status] ?? 9) - (STATUS_ORDER[right?.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    const byDate = String(competitionDateValue(right)).localeCompare(String(competitionDateValue(left)));
    if (byDate !== 0) return byDate;
    return String(right?.createdAt ?? '').localeCompare(String(left?.createdAt ?? ''));
  });
}

export function competitionListItem(competition) {
  const teamSize = competitionTeamSize(competition);
  const teamCount = Array.isArray(competition?.teams) ? competition.teams.length : 0;
  const champion = getCompetitionChampion(competition);
  const championIndex = champion
    ? (competition.teams ?? []).findIndex((team) => team.id === champion.id)
    : -1;
  return Object.freeze({
    id: competition?.id,
    name: competitionDisplayName(competition),
    dateLabel: formatCompetitionDate(competition),
    teamCountLabel: `${teamCount} ${teamUnitNoun(teamSize, teamCount)}`,
    formatLabel: formatFormatLabel(teamSize),
    status: competition?.status,
    statusLabel: translateCompetitionStatus(competition?.status),
    phaseLabel: currentCompetitionPhase(competition),
    championLabel: champion
      ? competitionTeamLabel(champion, { teamSize, index: Math.max(championIndex, 0) })
      : null,
  });
}

export function canPlayCompetitionMatch(match) {
  return Boolean(match?.teamAId && match?.teamBId);
}

export function isCompetitionByeSlot(slot) {
  return slot?.type === 'bye';
}

function feederSource(source) {
  return source?.type === 'winner' || source?.type === 'loser';
}

function childFromSource(source, match, roundNumber, matchById, teamsById, { followLosers = true } = {}) {
  if (source?.type === 'loser' && !followLosers) return null;
  if (feederSource(source)) {
    if (source.type === 'loser' && !followLosers) return null;
    const origin = matchById.get(source.matchId);
    return origin
      ? buildMatchNode(origin, matchById, teamsById, { followLosers })
      : { type: 'pending', id: `pending-${match.id}-${source.matchId}` };
  }
  if ((source?.type === 'team' || source?.type === 'seed') && roundNumber > 1) {
    const teamId =
      source.type === 'team'
        ? source.teamId
        : source === match.sourceA
          ? match.teamAId
          : match.teamBId;
    return {
      type: 'bye',
      id: `bye-${match.id}-${teamId || source.seed}`,
      teamId,
      team: teamsById.get(teamId) ?? null,
      advancesToMatchId: match.id,
    };
  }
  return null;
}

function buildMatchNode(match, matchById, teamsById, options = {}) {
  const roundNumber = match?.roundNumber ?? 1;
  return {
    type: 'match',
    id: match.id,
    match,
    left: childFromSource(match.sourceA, match, roundNumber, matchById, teamsById, options),
    right: childFromSource(match.sourceB, match, roundNumber, matchById, teamsById, options),
  };
}

function columnCountForRounds(rounds) {
  const maxRound = rounds.reduce((highest, round) => Math.max(highest, round?.number ?? 0), 0);
  return Math.max(maxRound, 0);
}

function collectSlots(node, parentRoundNumber, columns) {
  if (!node) return;
  if (node.type === 'bye') {
    const columnIndex = Math.max(0, parentRoundNumber - 2);
    if (!columns[columnIndex].some((item) => item.id === node.id)) {
      columns[columnIndex].push(node);
    }
    return;
  }
  if (node.type !== 'match') return;
  collectSlots(node.left, node.match.roundNumber, columns);
  collectSlots(node.right, node.match.roundNumber, columns);
  const columnIndex = Math.max(0, (node.match.roundNumber ?? 1) - 1);
  if (!columns[columnIndex].some((item) => item.id === node.id)) {
    columns[columnIndex].push(node);
  }
}

function annotatedMatches(rounds) {
  const roundById = new Map(rounds.map((round) => [round.id, round]));
  return rounds.flatMap((round) =>
    (round.matches ?? []).map((match) => ({
      ...match,
      roundNumber: roundById.get(match.roundId)?.number ?? round.number ?? 1,
      roundName: roundById.get(match.roundId)?.name ?? round.name ?? '',
    }))
  );
}

function freezeByeFromRound(competition, round, bye, index) {
  const team = competitionTeamById(competition, bye?.teamId);
  return freezeSlot(
    {
      type: 'bye',
      id: `bye-${round.id}-${bye?.teamId || index}`,
      teamId: bye?.teamId ?? null,
      team,
    },
    competition
  );
}

function freezeMatchFromRound(competition, round, match) {
  return freezeSlot(
    {
      type: 'match',
      id: match.id,
      match: {
        ...match,
        roundNumber: round.number ?? 1,
        roundName: round.name ?? '',
      },
      left: null,
      right: null,
    },
    competition
  );
}

function buildRoundColumns(competition, rounds) {
  return (rounds ?? []).map((round, index) =>
    Object.freeze({
      index,
      name: round.name || `Rodada ${round.number ?? index + 1}`,
      slots: Object.freeze([
        ...(round.byes ?? []).map((bye, byeIndex) => freezeByeFromRound(competition, round, bye, byeIndex)),
        ...(round.matches ?? []).map((match) => freezeMatchFromRound(competition, round, match)),
      ]),
    })
  );
}

function buildTreeColumns(competition, rounds, rootMatch, { followLosers = true } = {}) {
  const teamsById = new Map((competition?.teams ?? []).map((team) => [team.id, team]));
  const matches = annotatedMatches(rounds);
  const matchById = new Map(matches.map((match) => [match.id, match]));
  if (!rootMatch || !matchById.has(rootMatch.id)) {
    return [];
  }
  const root = buildMatchNode(matchById.get(rootMatch.id), matchById, teamsById, { followLosers });
  const columns = Array.from({ length: columnCountForRounds(rounds) }, () => []);
  collectSlots(root, root.match.roundNumber, columns);
  return columns.map((slots, index) => {
    const matchSlot = slots.find((slot) => slot.type === 'match');
    const name =
      matchSlot?.match?.roundName ||
      rounds.find((round) => round.number === index + 1)?.name ||
      (index === columns.length - 1 ? 'Final' : 'Fase');
    return Object.freeze({
      index,
      name,
      slots: Object.freeze(slots.map((slot) => freezeSlot(slot, competition))),
    });
  });
}

export function buildCompetitionBracketModel(competition, stage = null) {
  const sourceStage = stage ?? (competition?.stages ?? [])[0] ?? competition;
  const rounds = [...(sourceStage?.rounds ?? listCompetitionRounds(competition))].sort(
    (left, right) => (left.number ?? 0) - (right.number ?? 0)
  );

  if (rounds.length === 0) {
    return Object.freeze({ layout: 'empty', columns: Object.freeze([]), sections: Object.freeze([]) });
  }

  if (sourceStage?.type === 'swiss') {
    const columns = buildRoundColumns(competition, rounds);
    return Object.freeze({
      layout: 'rounds',
      columns: Object.freeze(columns),
      sections: Object.freeze([]),
    });
  }

  if (sourceStage?.type === 'double_elimination') {
    const winners = rounds.filter((round) => round.bracket === 'winners');
    const losers = rounds.filter((round) => round.bracket === 'losers');
    const finals = rounds.filter(
      (round) => round.bracket === 'grand_final' || round.bracket === 'grand_final_reset'
    );
    const sections = [
      {
        id: 'winners',
        name: 'Winners',
        columns: buildTreeColumns(competition, winners, winners.at(-1)?.matches?.[0], { followLosers: false }),
      },
      {
        id: 'losers',
        name: 'Losers',
        columns: buildRoundColumns(competition, losers),
      },
      {
        id: 'grand_final',
        name: 'Grand Final',
        columns: buildRoundColumns(competition, finals),
      },
    ].filter((section) => section.columns.length > 0);
    return Object.freeze({
      layout: 'double',
      columns: Object.freeze(sections.flatMap((section) => section.columns)),
      sections: Object.freeze(sections.map((section) => Object.freeze(section))),
    });
  }

  const matches = annotatedMatches(rounds);
  const rootMatch = rounds.at(-1)?.matches?.[0] ?? matches.at(-1);
  const columns = buildTreeColumns(competition, rounds, rootMatch, { followLosers: true });
  return Object.freeze({
    layout: 'tree',
    columns: Object.freeze(columns),
    sections: Object.freeze([]),
  });
}

function freezeSlot(slot, competition) {
  if (slot.type === 'bye') {
    const teamSize = competitionTeamSize(competition);
    const index = (competition?.teams ?? []).findIndex((team) => team.id === slot.teamId);
    return Object.freeze({
      type: 'bye',
      id: slot.id,
      teamId: slot.teamId,
      playable: false,
      leftId: null,
      rightId: null,
      teamLabel: competitionTeamLabel(slot.team, { teamSize, index: Math.max(index, 0) }),
      memberNames: memberNames(slot.team?.members),
      byeLabel: COMPETITION_BYE_LABEL,
      byeHint: COMPETITION_BYE_HINT,
    });
  }

  if (slot.type !== 'match') {
    return Object.freeze({
      type: slot.type,
      id: slot.id,
      playable: false,
      leftId: null,
      rightId: null,
    });
  }

  const match = slot.match;
  const playable = canPlayCompetitionMatch(match);
  const winnerSide = matchWinningSide(match);
  return Object.freeze({
    type: 'match',
    id: match.id,
    match,
    roundName: match.roundName,
    roundNumber: match.roundNumber,
    playable,
    pending: isMatchPending(match),
    completed: isMatchCompleted(match),
    unresolvedHint: playable ? null : COMPETITION_UNRESOLVED_MATCH_HINT,
    scoreLabel: formatMatchScore(match),
    leftId: slot.left?.id ?? null,
    rightId: slot.right?.id ?? null,
    sideA: Object.freeze({
      teamId: match.teamAId,
      label: competitionSideLabel(competition, match.teamAId, match.lineupA),
      members: memberNames(match.lineupA),
      winner: winnerSide === 'A',
    }),
    sideB: Object.freeze({
      teamId: match.teamBId,
      label: competitionSideLabel(competition, match.teamBId, match.lineupB),
      members: memberNames(match.lineupB),
      winner: winnerSide === 'B',
    }),
  });
}

export function competitionChampionView(competition) {
  const champion = getCompetitionChampion(competition);
  if (!champion) return null;
  const teamSize = competitionTeamSize(competition);
  const index = (competition?.teams ?? []).findIndex((team) => team.id === champion.id);
  const finalMatch = getFinalMatch(competition);
  return Object.freeze({
    heading: COMPETITION_CHAMPION_HEADING,
    teamLabel: competitionTeamLabel(champion, { teamSize, index: Math.max(index, 0) }),
    memberNames: memberNames(champion.members),
    scoreLabel: finalMatch ? formatMatchScore(finalMatch) : '',
    finalRoundName: finalMatch?.roundId
      ? listCompetitionRounds(competition).find((round) => round.id === finalMatch.roundId)?.name || 'Final'
      : 'Final',
  });
}

export function translateCompetitionStageStatus(status) {
  return COMPETITION_STAGE_STATUS_LABELS[status] ?? status ?? '';
}

export function translateCompetitionStageType(type, index = 0) {
  return stageNameForType(type, index);
}

export function stagesFromStructure({ structure, roundCount, grandFinalMode }) {
  if (structure === 'swiss') {
    return [{ type: 'swiss', config: { roundCount } }];
  }
  if (structure === 'double_elimination') {
    return [{ type: 'double_elimination', config: { grandFinalMode } }];
  }
  if (structure === 'swiss_then_double') {
    return [
      { type: 'swiss', config: { roundCount } },
      { type: 'double_elimination', config: { grandFinalMode } },
    ];
  }
  return [{ type: 'single_elimination', config: {} }];
}

export function parseCompetitionStructureInput({ structure, roundCount, grandFinalMode } = {}) {
  const selected = COMPETITION_STRUCTURE_OPTIONS.some((option) => option.id === structure)
    ? structure
    : 'single_elimination';
  const needsSwiss = selected === 'swiss' || selected === 'swiss_then_double';
  const needsDe = selected === 'double_elimination' || selected === 'swiss_then_double';
  const parsedRoundCount = Number.parseInt(String(roundCount ?? ''), 10);
  if (needsSwiss && (!Number.isInteger(parsedRoundCount) || parsedRoundCount < 1)) {
    return {
      ok: false,
      stages: [],
      roundCountError: 'Informe um número de rodadas suíças maior que zero.',
      grandFinalModeError: null,
    };
  }
  const mode = grandFinalMode ?? 'bracket_reset';
  if (needsDe && !COMPETITION_GRAND_FINAL_MODE_OPTIONS.some((option) => option.id === mode)) {
    return {
      ok: false,
      stages: [],
      roundCountError: null,
      grandFinalModeError: 'Escolha o modo da Grand Final.',
    };
  }
  return {
    ok: true,
    stages: stagesFromStructure({
      structure: selected,
      roundCount: parsedRoundCount,
      grandFinalMode: mode,
    }),
    roundCountError: null,
    grandFinalModeError: null,
  };
}

export function swissStandingsView(competition, stage) {
  if (!stage || stage.type !== 'swiss') return [];
  const teamSize = competitionTeamSize(competition);
  return getSwissStandings(stage, stage.seedTeamIds).map((row, index) => {
    const team = competitionTeamById(competition, row.teamId);
    const teamIndex = (competition?.teams ?? []).findIndex((item) => item.id === row.teamId);
    return Object.freeze({
      ...row,
      position: index + 1,
      teamLabel: competitionTeamLabel(team, { teamSize, index: Math.max(teamIndex, 0) }),
    });
  });
}

export function competitionStageViews(competition) {
  return listCompetitionStages(competition).map((stage, index) =>
    Object.freeze({
      id: stage.id,
      number: stage.number,
      name: stage.name || translateCompetitionStageType(stage.type, index),
      type: stage.type,
      status: stage.status,
      statusLabel: translateCompetitionStageStatus(stage.status),
      hasRounds: (stage.rounds ?? []).length > 0,
      standings: swissStandingsView(competition, stage),
      seedSnapshot: stage.seedSnapshot,
      model: buildCompetitionBracketModel(competition, stage),
    })
  );
}

export function canGenerateCompetitionBracket(competition) {
  const teams = competition?.teams ?? [];
  const teamSize = competitionTeamSize(competition);
  const teamsReady =
    teams.length >= MIN_COMPETITION_TEAM_COUNT &&
    teams.every((team) => (team.members ?? []).length === teamSize);
  if (!teamsReady) return false;
  const target = getCompetitionGenerateTarget(competition);
  return Boolean(target && target.action !== 'swiss-wait');
}

export function generateCompetitionBlockedReason(competition) {
  const teams = competition?.teams ?? [];
  const teamSize = competitionTeamSize(competition);
  if (teams.length < MIN_COMPETITION_TEAM_COUNT) {
    return `Monte pelo menos ${MIN_COMPETITION_TEAM_COUNT} ${teamUnitNoun(teamSize, MIN_COMPETITION_TEAM_COUNT)} para gerar a chave.`;
  }
  if (teams.some((team) => (team.members ?? []).length !== teamSize)) {
    return `Cada ${teamUnitNoun(teamSize, 1)} precisa ter ${teamSize} jogadores.`;
  }
  const target = getCompetitionGenerateTarget(competition);
  if (!target) return null;
  if (target.action === 'swiss-wait') {
    return 'Conclua todas as partidas da rodada atual antes de gerar a próxima.';
  }
  return null;
}

export function generateCompetitionButtonLabel(competition) {
  const target = getCompetitionGenerateTarget(competition);
  if (!target) return 'Gerar chave';
  if (target.action === 'swiss-next') return 'Gerar próxima rodada suíça';
  if ((target.stage?.number ?? 1) > 1) {
    return `Gerar ${target.stage.name || translateCompetitionStageType(target.stage.type)}`;
  }
  if (target.stage?.type === 'swiss') return 'Gerar fase suíça';
  if (target.stage?.type === 'double_elimination') return 'Gerar double elimination';
  return 'Gerar chave';
}

export function shouldShowGenerateCompetitionButton(competition) {
  return Boolean(getCompetitionGenerateTarget(competition)) || canGenerateCompetitionBracket(competition);
}

export function availablePlayersForCompetition(roster, teams, ignoredTeamId) {
  const taken = new Set();
  for (const team of teams ?? []) {
    if (team?.id === ignoredTeamId) continue;
    for (const member of team?.members ?? []) {
      if (member?.playerId) taken.add(member.playerId);
    }
  }
  return (roster ?? []).filter((player) => player?.id && !taken.has(player.id));
}

export function competitionFormatOptions() {
  return SESSION_FORMAT_OPTIONS;
}

export function matchEditorTitle(slot) {
  if (!slot || slot.type !== 'match') return 'Resultado';
  return slot.roundName || 'Partida';
}

export function defaultMatchPlayedDate(competition, match) {
  if (typeof match?.playedDate === 'string' && match.playedDate) return match.playedDate;
  return competitionDateValue(competition);
}

export function parseCompetitionDateInput(value) {
  const result = validateDate(value);
  return {
    ok: result.ok,
    date: value,
    dateError: result.ok ? null : result.errors[0]?.message || 'A data da competição é inválida.',
  };
}

export function parseCompetitionFormatInput(teamSize) {
  const parsed = parseRequiredInteger(teamSize);
  const result = validateCompetitionFormat({ teamSize: parsed });
  return {
    ok: result.ok,
    teamSize: parsed,
    teamSizeError: result.ok
      ? null
      : result.errors[0]?.message || 'Informe um formato válido.',
  };
}

export function competitionTeamsHeading(teamCount, teamSize) {
  const title = teamSize === 2 ? 'Duplas formadas' : 'Times formados';
  return `${title} (${teamCount})`;
}

export function competitionTeamsLockedMessage(teamSize) {
  return teamSize === 2
    ? 'A chave já foi gerada. As duplas e a ordem de seeding não podem ser alteradas.'
    : 'A chave já foi gerada. Os times e a ordem de seeding não podem ser alterados.';
}

export function competitionSeedHint(teamSize) {
  return teamSize === 2
    ? 'A ordem abaixo é o seeding da chave. Use as setas para reordenar as duplas.'
    : 'A ordem abaixo é o seeding da chave. Use as setas para reordenar os times.';
}

export function moveItemInList(list, index, delta) {
  const current = Array.isArray(list) ? [...list] : [];
  const target = index + delta;
  if (index < 0 || index >= current.length || target < 0 || target >= current.length) {
    return current;
  }
  const [item] = current.splice(index, 1);
  current.splice(target, 0, item);
  return current;
}

export function seedTeamIdsFromTeams(teams) {
  return (teams ?? []).map((team) => team?.id).filter(Boolean);
}

export function downstreamConfirmationDetails(error, competition) {
  const affected = error?.affectedMatches ?? [];
  const teamSize = competitionTeamSize(competition);
  return affected.map((item) => {
    const match = listCompetitionMatches(competition).find((entry) => entry.id === item.id) ?? item;
    const roundName =
      listCompetitionRounds(competition).find((round) => round.id === match.roundId)?.name || 'Partida';
    const teamA = competitionTeamById(competition, match.teamAId);
    const teamB = competitionTeamById(competition, match.teamBId);
    return `${roundName}: ${competitionTeamLabel(teamA, { teamSize })} × ${competitionTeamLabel(teamB, { teamSize })}`;
  });
}
