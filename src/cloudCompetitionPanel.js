const LOAD_FAILED_MESSAGE = 'Não foi possível abrir a competição.';

export function createdCloudCompetitionId(created) {
  if (!created?.ok) return null;
  const id = created.competitionId ?? created.competition?.id;
  return typeof id === 'string' && id ? id : null;
}

export function shouldApplyCompetitionLoad(requestId, openCompetitionId) {
  return Boolean(requestId) && requestId === openCompetitionId;
}

export async function fetchOpenCloudCompetition(loadCompetition, competitionId, userId) {
  try {
    const result = await loadCompetition(competitionId, userId);
    if (result?.ok && result.loaded) {
      return { ok: true, loaded: result.loaded, error: null };
    }
    return {
      ok: false,
      loaded: null,
      error: result?.error?.message || LOAD_FAILED_MESSAGE,
    };
  } catch (error) {
    return {
      ok: false,
      loaded: null,
      error: error?.message || LOAD_FAILED_MESSAGE,
    };
  }
}

export function teamsPayloadFromCompetition(competition) {
  return (competition?.teams ?? []).map((team) => ({
    id: team.id,
    members: (team.members ?? []).map((member) => ({
      playerId: member.playerId,
      playerName: member.playerName,
    })),
  }));
}

export function listCompetitionMatchRows(competition) {
  return (competition?.stages ?? []).flatMap((stage) =>
    (stage.rounds ?? []).flatMap((round) => round.matches ?? [])
  );
}

export function findChangedCompetitionMatch(before, after) {
  const previous = new Map(listCompetitionMatchRows(before).map((match) => [match.id, match]));
  for (const match of listCompetitionMatchRows(after)) {
    const prior = previous.get(match.id);
    if (!prior) continue;
    if (prior.scoreA !== match.scoreA || prior.scoreB !== match.scoreB) return match;
  }
  return listCompetitionMatchRows(after).find((match) => match.id) ?? null;
}

export function classifyCompetitionPersist(before, after) {
  const beforeRounds = listCompetitionMatchRows(before).length;
  const afterRounds = listCompetitionMatchRows(after).length;
  if ((after?.status ?? 'draft') === 'draft' && afterRounds === 0) return 'teams';
  if (beforeRounds === 0 && afterRounds > 0) return 'structure';
  return 'score';
}
