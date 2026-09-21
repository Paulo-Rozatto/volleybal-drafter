import { isMatchCompleted, isMatchPending } from './sessionValidation.js';

export const MATCH_SOURCE_SESSION = 'session';
export const MATCH_SOURCE_COMPETITION = 'competition';
export const MATCH_SOURCE_TYPES = Object.freeze([MATCH_SOURCE_SESSION, MATCH_SOURCE_COMPETITION]);

export const ANALYZABLE_MATCH_INCLUDED = 'included';
export const ANALYZABLE_MATCH_PENDING = 'pending';
export const ANALYZABLE_MATCH_INVALID = 'invalid';

export function classifyPerformanceMatch(match) {
  if (isMatchPending(match)) return ANALYZABLE_MATCH_PENDING;
  if (!isMatchCompleted(match)) return ANALYZABLE_MATCH_INVALID;
  return ANALYZABLE_MATCH_INCLUDED;
}

function trimmedName(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function roundNumberOf(round, roundIndex) {
  return Number.isInteger(round?.number) ? round.number : roundIndex + 1;
}

function freezeAnalyzableMatch(match) {
  return Object.freeze(match);
}

export function createAnalyzableMatch({
  sourceType,
  sourceId,
  sourceName,
  date,
  sourceUpdatedAt,
  sourceCreatedAt,
  sourceIndex,
  matchId,
  roundId,
  roundNumber,
  roundLabel,
  roundIndex,
  matchIndex,
  cycleNumber = null,
  lineupA,
  lineupB,
  scoreA,
  scoreB,
  originKey = null,
} = {}) {
  return freezeAnalyzableMatch({
    status: classifyPerformanceMatch({ scoreA, scoreB }),
    sourceType,
    sourceId: sourceId ?? null,
    sourceName: trimmedName(sourceName),
    date: date ?? null,
    sourceUpdatedAt,
    sourceCreatedAt,
    sourceIndex,
    matchId: matchId ?? null,
    roundId: roundId ?? null,
    roundNumber,
    roundLabel: trimmedName(roundLabel),
    roundIndex,
    matchIndex,
    cycleNumber: cycleNumber ?? null,
    lineupA,
    lineupB,
    scoreA,
    scoreB,
    originKey: originKey ?? null,
  });
}

function teamNameSnapshots(teams, recencyBase) {
  return (teams ?? []).map((team, teamIndex) =>
    Object.freeze({
      members: team?.members,
      recency: Object.freeze({
        ...recencyBase,
        roundIndex: -2,
        matchIndex: -2,
        sideIndex: teamIndex,
      }),
    })
  );
}

export function listSessionPerformanceMatches(document) {
  const nameSnapshots = [];
  const matches = [];

  (document?.sessions ?? []).forEach((session, sessionIndex) => {
    const recencyBase = {
      date: session?.date ?? null,
      updatedAt: session?.updatedAt,
      createdAt: session?.createdAt,
      sessionIndex,
    };
    nameSnapshots.push(...teamNameSnapshots(session?.teams, recencyBase));

    (session?.rounds ?? []).forEach((round, roundIndex) => {
      (round?.matches ?? []).forEach((match, matchIndex) => {
        matches.push(
          createAnalyzableMatch({
            sourceType: MATCH_SOURCE_SESSION,
            sourceId: session?.id ?? null,
            sourceName: trimmedName(session?.name),
            date: session?.date ?? null,
            sourceUpdatedAt: session?.updatedAt,
            sourceCreatedAt: session?.createdAt,
            sourceIndex: sessionIndex,
            matchId: match?.id ?? null,
            roundId: round?.id ?? null,
            roundNumber: roundNumberOf(round, roundIndex),
            roundLabel: trimmedName(round?.name),
            roundIndex,
            matchIndex,
            cycleNumber: round?.cycleNumber ?? null,
            lineupA: match?.lineupA,
            lineupB: match?.lineupB,
            scoreA: match?.scoreA,
            scoreB: match?.scoreB,
          })
        );
      });
    });
  });

  return Object.freeze({
    nameSnapshots: Object.freeze(nameSnapshots),
    matches: Object.freeze(matches),
  });
}

export function listCompetitionPerformanceMatches(document, { sourceIndexOffset = 0 } = {}) {
  const nameSnapshots = [];
  const matches = [];

  (document?.competitions ?? []).forEach((competition, competitionIndex) => {
    const sourceIndex = sourceIndexOffset + competitionIndex;
    const recencyBase = {
      date: competition?.date ?? null,
      updatedAt: competition?.updatedAt,
      createdAt: competition?.createdAt,
      sessionIndex: sourceIndex,
    };
    nameSnapshots.push(...teamNameSnapshots(competition?.teams, recencyBase));

    (competition?.stages ?? []).forEach((stage) => {
      (stage?.rounds ?? []).forEach((round, roundIndex) => {
        (round?.matches ?? []).forEach((match, matchIndex) => {
          const playedDate = typeof match?.playedDate === 'string' ? match.playedDate : null;
          matches.push(
            createAnalyzableMatch({
              sourceType: MATCH_SOURCE_COMPETITION,
              sourceId: competition?.id ?? null,
              sourceName: trimmedName(competition?.name),
              date: playedDate,
              sourceUpdatedAt: competition?.updatedAt,
              sourceCreatedAt: competition?.createdAt,
              sourceIndex,
              matchId: match?.id ?? null,
              roundId: round?.id ?? null,
              roundNumber: roundNumberOf(round, roundIndex),
              roundLabel: trimmedName(round?.name),
              roundIndex,
              matchIndex,
              lineupA: match?.lineupA,
              lineupB: match?.lineupB,
              scoreA: match?.scoreA,
              scoreB: match?.scoreB,
            })
          );
        });
      });
    });
  });

  return Object.freeze({
    nameSnapshots: Object.freeze(nameSnapshots),
    matches: Object.freeze(matches),
  });
}

export function combinePerformanceMatchSources(sessionDocument, competitionsDocument = null) {
  const sessions = listSessionPerformanceMatches(sessionDocument);
  const competitions = competitionsDocument
    ? listCompetitionPerformanceMatches(competitionsDocument, {
        sourceIndexOffset: (sessionDocument?.sessions ?? []).length,
      })
    : { nameSnapshots: Object.freeze([]), matches: Object.freeze([]) };

  return Object.freeze({
    nameSnapshots: Object.freeze([...sessions.nameSnapshots, ...competitions.nameSnapshots]),
    matches: Object.freeze([...sessions.matches, ...competitions.matches]),
  });
}
