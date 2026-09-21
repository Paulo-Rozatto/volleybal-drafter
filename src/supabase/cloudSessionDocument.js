import { TEAM_SESSION_SCHEMA_VERSION } from '../domain/teamSession.js';

export function cloudSessionToDocument(session) {
  if (!session) {
    return { schemaVersion: TEAM_SESSION_SCHEMA_VERSION, sessions: [] };
  }
  return {
    schemaVersion: TEAM_SESSION_SCHEMA_VERSION,
    sessions: [
      {
        id: session.id,
        date: session.date,
        name: session.name ?? null,
        status: session.status,
        createdAt: session.createdAt ?? new Date().toISOString(),
        updatedAt: session.updatedAt ?? new Date().toISOString(),
        format: {
          teamSize: session.format?.teamSize ?? 2,
          teamCount: session.format?.teamCount ?? 2,
        },
        courtCount: session.courtCount ?? undefined,
        teams: session.teams ?? [],
        rounds: session.rounds ?? [],
      },
    ],
  };
}

export function teamsPlanFromSession(session) {
  return (session?.teams ?? []).map((team, index) => ({
    id: team.id,
    name: team.name ?? null,
    sort_index: team.sortIndex ?? index,
    members: (team.members ?? []).map((member) => ({
      player_id: member.playerId,
      player_name_snapshot: member.playerName,
    })),
  }));
}

export function lineupPlan(members) {
  return (members ?? []).map((member, index) => ({
    player_id: member.playerId,
    player_name_snapshot: member.playerName,
    sort_index: index,
  }));
}

export function roundsPlanFromSession(session, { cycleNumber } = {}) {
  const rounds = session?.rounds ?? [];
  const selected =
    cycleNumber == null ? rounds : rounds.filter((round) => (round.cycleNumber ?? 1) === cycleNumber);
  return selected.map((round) => ({
    id: round.id,
    number: round.number,
    cycle_number: round.cycleNumber ?? 1,
    bye_team_id: round.byeTeamId ?? null,
    matches: (round.matches ?? []).map((match) => ({
      id: match.id,
      team_a_id: match.teamAId,
      team_b_id: match.teamBId,
      lineup_a: lineupPlan(match.lineupA),
      lineup_b: lineupPlan(match.lineupB),
    })),
  }));
}

export function shouldAcceptCloudSession(current, incoming) {
  if (!incoming) return false;
  if (!current) return true;
  return Number(incoming.structureVersion ?? 0) >= Number(current.structureVersion ?? 0);
}

export function parseScoreConflictDetail(error) {
  const raw = error?.details ?? error?.detail ?? error?.hint;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      scoreA: parsed.score_a ?? null,
      scoreB: parsed.score_b ?? null,
      version: Number(parsed.version ?? 0),
    };
  } catch {
    return null;
  }
}
