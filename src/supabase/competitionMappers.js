function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return value ?? null;
}

function toDateString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value ?? null;
}

function memberFromRow(row) {
  return {
    playerId: row.player_id ?? row.playerId,
    playerName: row.player_name_snapshot ?? row.playerName,
  };
}

function lineupFromPlayers(players, matchId, side) {
  return (players ?? [])
    .filter((row) => row.match_id === matchId && row.side === side)
    .sort((left, right) => (left.sort_index ?? 0) - (right.sort_index ?? 0))
    .map(memberFromRow);
}

export function mapCompetitionMember(row, myUserId) {
  return {
    userId: row.user_id,
    role: row.role,
    displayName: row.profiles?.display_name ?? row.display_name ?? '',
    isSelf: row.user_id === myUserId,
  };
}

export function mapCompetitionCard(row) {
  return {
    id: row.id,
    name: row.name,
    date: toDateString(row.date),
    status: row.status,
    groupId: row.group_id ?? null,
    joinCode: row.join_code,
    formatTeamSize: row.format_team_size,
    structureVersion: Number(row.structure_version ?? 0),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function assembleCloudCompetition({
  competition,
  members = [],
  players = [],
  teams = [],
  teamMembers = [],
  stages = [],
  rounds = [],
  byes = [],
  matches = [],
  matchPlayers = [],
  events = [],
  myUserId,
} = {}) {
  if (!competition) return null;

  const membersByTeam = new Map();
  for (const row of teamMembers) {
    const list = membersByTeam.get(row.team_id) ?? [];
    list.push(row);
    membersByTeam.set(row.team_id, list);
  }

  const mappedTeams = [...teams]
    .sort((left, right) => (left.sort_index ?? 0) - (right.sort_index ?? 0))
    .map((team) => ({
      id: team.id,
      members: (membersByTeam.get(team.id) ?? [])
        .sort((left, right) => (left.sort_index ?? 0) - (right.sort_index ?? 0))
        .map(memberFromRow),
    }));

  const roundsByStage = new Map();
  for (const round of rounds) {
    const list = roundsByStage.get(round.stage_id) ?? [];
    list.push(round);
    roundsByStage.set(round.stage_id, list);
  }

  const matchesByRound = new Map();
  for (const match of matches) {
    const list = matchesByRound.get(match.round_id) ?? [];
    list.push(match);
    matchesByRound.set(match.round_id, list);
  }

  const byesByRound = new Map();
  for (const bye of byes) {
    const list = byesByRound.get(bye.round_id) ?? [];
    list.push({ teamId: bye.team_id });
    byesByRound.set(bye.round_id, list);
  }

  const mappedStages = [...stages]
    .sort((left, right) => (left.number ?? 0) - (right.number ?? 0))
    .map((stage) => ({
      id: stage.id,
      number: stage.number,
      name: stage.name ?? null,
      type: stage.type,
      status: stage.status,
      config: stage.config ?? {},
      seedTeamIds: Array.isArray(stage.seed_team_ids) ? [...stage.seed_team_ids] : [],
      seedSnapshot: stage.seed_snapshot ?? null,
      rounds: (roundsByStage.get(stage.id) ?? [])
        .sort((left, right) => (left.number ?? 0) - (right.number ?? 0))
        .map((round) => ({
          id: round.id,
          number: round.number,
          name: round.name ?? null,
          bracket: round.bracket ?? null,
          byes: byesByRound.get(round.id) ?? [],
          matches: (matchesByRound.get(round.id) ?? []).map((match) => ({
            id: match.id,
            roundId: round.id,
            sourceA: match.source_a,
            sourceB: match.source_b,
            teamAId: match.team_a_id ?? null,
            teamBId: match.team_b_id ?? null,
            lineupA: lineupFromPlayers(matchPlayers, match.id, 'a'),
            lineupB: lineupFromPlayers(matchPlayers, match.id, 'b'),
            scoreA: match.score_a ?? null,
            scoreB: match.score_b ?? null,
            playedDate: toDateString(match.played_date),
            winnerTeamId: match.winner_team_id ?? null,
          })),
        })),
    }));

  const matchVersions = Object.fromEntries((matches ?? []).map((match) => [match.id, Number(match.version ?? 0)]));
  const myMember = members.find((row) => row.user_id === myUserId);

  return {
    competition: {
      id: competition.id,
      name: competition.name ?? null,
      date: toDateString(competition.date),
      status: competition.status,
      createdAt: toIsoString(competition.created_at),
      updatedAt: toIsoString(competition.updated_at),
      format: { teamSize: Number(competition.format_team_size) },
      seedTeamIds: Array.isArray(competition.seed_team_ids) ? [...competition.seed_team_ids] : [],
      teams: mappedTeams,
      stages: mappedStages,
    },
    structureVersion: Number(competition.structure_version ?? 0),
    joinCode: competition.join_code,
    groupId: competition.group_id ?? null,
    myRole: myMember?.role ?? null,
    members: members.map((row) => mapCompetitionMember(row, myUserId)),
    roster: (players ?? []).map((row) => ({
      id: row.player_id,
      name: row.player_name_snapshot,
    })),
    matchVersions,
    events,
  };
}

export function competitionDocumentOf(competition) {
  return {
    schemaVersion: 2,
    competitions: [competition],
  };
}

export function canManageCloudCompetition(role) {
  return role === 'owner' || role === 'admin';
}

export function canScoreCloudCompetition(role, status) {
  if (role === 'viewer' || !role) return false;
  if (status === 'finished') return role === 'owner' || role === 'admin';
  return status === 'in_progress';
}

export function competitionRoleLabel(role) {
  if (role === 'owner') return 'organizador';
  if (role === 'admin') return 'admin';
  if (role === 'member') return 'membro';
  if (role === 'viewer') return 'visitante';
  return role ?? '';
}

export function applyCompetitionMatchRealtimeChange(loaded, payload) {
  if (!loaded?.competition || !payload?.id) return loaded;
  const nextVersion = Number(payload.version ?? 0);
  const previousVersion = Number(loaded.matchVersions?.[payload.id] ?? 0);
  if (nextVersion <= previousVersion) return loaded;

  let changed = false;
  const stages = (loaded.competition.stages ?? []).map((stage) => ({
    ...stage,
    rounds: (stage.rounds ?? []).map((round) => ({
      ...round,
      matches: (round.matches ?? []).map((match) => {
        if (match.id !== payload.id) return match;
        changed = true;
        return {
          ...match,
          scoreA: payload.score_a ?? null,
          scoreB: payload.score_b ?? null,
          playedDate: payload.played_date ?? match.playedDate ?? null,
          winnerTeamId: payload.winner_team_id ?? match.winnerTeamId ?? null,
          teamAId: payload.team_a_id ?? match.teamAId ?? null,
          teamBId: payload.team_b_id ?? match.teamBId ?? null,
        };
      }),
    })),
  }));

  if (!changed) return loaded;
  return {
    ...loaded,
    competition: { ...loaded.competition, stages },
    matchVersions: { ...loaded.matchVersions, [payload.id]: nextVersion },
  };
}
