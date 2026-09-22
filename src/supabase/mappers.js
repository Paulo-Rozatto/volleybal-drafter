function snapshotMember(row) {
  return {
    playerId: row.player_id,
    playerName: row.player_name_snapshot,
    sortIndex: row.sort_index ?? 0,
    side: row.side ?? null,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asProfile(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name ?? '',
  };
}

export function mapSessionMember(row) {
  const profile = asProfile(row.profiles ?? row.profile ?? null);
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role,
    displayName: profile?.display_name ?? profile?.displayName ?? '',
  };
}

export function mapPlayer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    score: row.skill_score ?? 3,
    gender: row.gender ?? 'F',
    height: row.height ?? 'short',
    linkedUserId: row.linked_user_id ?? null,
    createdBy: row.created_by ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

export function mapTeam(row) {
  const members = asArray(row.team_members ?? row.members).map(snapshotMember);
  members.sort((left, right) => left.sortIndex - right.sortIndex);
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name ?? null,
    sortIndex: row.sort_index ?? 0,
    members: members.map(({ playerId, playerName }) => ({ playerId, playerName })),
  };
}

export function attachMatchPlayersToMatches(matches, matchPlayers) {
  const grouped = new Map();
  for (const row of asArray(matchPlayers)) {
    const matchId = row.match_id;
    if (!matchId) continue;
    const list = grouped.get(matchId);
    if (list) list.push(row);
    else grouped.set(matchId, [row]);
  }

  return asArray(matches).map((match) => ({
    ...match,
    match_players: grouped.get(match.id) ?? [],
  }));
}

export function mapMatch(row) {
  const matchPlayers = asArray(row.match_players);
  const lineupA = matchPlayers
    .filter((item) => item.side === 'a')
    .sort((left, right) => (left.sort_index ?? 0) - (right.sort_index ?? 0))
    .map(snapshotMember)
    .map(({ playerId, playerName }) => ({ playerId, playerName }));
  const lineupB = matchPlayers
    .filter((item) => item.side === 'b')
    .sort((left, right) => (left.sort_index ?? 0) - (right.sort_index ?? 0))
    .map(snapshotMember)
    .map(({ playerId, playerName }) => ({ playerId, playerName }));

  return {
    id: row.id,
    sessionId: row.session_id,
    roundId: row.round_id,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    lineupA,
    lineupB,
    scoreA: row.score_a ?? null,
    scoreB: row.score_b ?? null,
    version: Number(row.version ?? 0),
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function mapRound(row, matches = []) {
  const roundMatches = matches
    .filter((match) => match.roundId === row.id || match.round_id === row.id)
    .map((match) => (match.roundId ? match : mapMatch(match)));

  return {
    id: row.id,
    sessionId: row.session_id,
    number: row.number,
    cycleNumber: row.cycle_number ?? 1,
    byeTeamId: row.bye_team_id ?? null,
    matches: roundMatches,
  };
}

export function mapCloudSession({
  session,
  members = [],
  teams = [],
  rounds = [],
  matches = [],
  sessionPlayers = [],
  matchEvents = [],
  myUserId,
} = {}) {
  if (!session) return null;

  const mappedMatches = asArray(matches).map(mapMatch);
  const mappedRounds = asArray(rounds)
    .map((round) => mapRound(round, mappedMatches))
    .sort((left, right) => {
      if (left.cycleNumber !== right.cycleNumber) return left.cycleNumber - right.cycleNumber;
      return left.number - right.number;
    });

  const mappedMembers = asArray(members).map(mapSessionMember);
  const myMembership = mappedMembers.find((member) => member.userId === myUserId) ?? null;

  return {
    id: session.id,
    createdBy: session.created_by,
    name: session.name ?? null,
    date: session.date,
    status: session.status,
    joinCode: session.join_code,
    groupId: session.group_id ?? null,
    format: {
      teamSize: session.team_size,
      teamCount: session.team_count,
    },
    courtCount: session.court_count ?? null,
    structureVersion: Number(session.structure_version ?? 0),
    legacySourceId: session.legacy_source_id ?? null,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    members: mappedMembers,
    players: mapSessionPlayers(sessionPlayers),
    matchEvents: asArray(matchEvents).map(mapMatchEvent),
    teams: asArray(teams).map(mapTeam).sort((left, right) => left.sortIndex - right.sortIndex),
    rounds: mappedRounds,
    myRole: myMembership?.role ?? null,
  };
}

export function mapSessionPlayers(rows = []) {
  return asArray(rows).map((row) => {
    const live = asProfile(row.players);
    return {
      playerId: row.player_id,
      playerName: live?.name ?? row.player_name_snapshot,
      snapshotName: row.player_name_snapshot,
      id: row.player_id,
      name: live?.name ?? row.player_name_snapshot,
      score: live?.skill_score ?? 3,
      gender: live?.gender ?? 'F',
      height: live?.height ?? 'short',
      linkedUserId: live?.linked_user_id ?? null,
      createdBy: live?.created_by ?? null,
      archivedAt: live?.archived_at ?? null,
    };
  });
}

export function mapMatchEvent(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    matchId: row.match_id,
    userId: row.user_id,
    eventType: row.event_type,
    oldScoreA: row.old_score_a,
    oldScoreB: row.old_score_b,
    newScoreA: row.new_score_a,
    newScoreB: row.new_score_b,
    versionBefore: Number(row.match_version_before ?? 0),
    versionAfter: Number(row.match_version_after ?? 0),
    createdAt: row.created_at,
  };
}

export function applyMatchRealtimeChange(session, payload) {
  if (!session || !payload?.id) return session;

  const nextVersion = Number(payload.version ?? 0);
  let changed = false;

  const rounds = session.rounds.map((round) => ({
    ...round,
    matches: round.matches.map((match) => {
      if (match.id !== payload.id) return match;
      if (nextVersion <= Number(match.version ?? 0)) return match;
      changed = true;
      return {
        ...match,
        scoreA: payload.score_a ?? null,
        scoreB: payload.score_b ?? null,
        version: nextVersion,
        updatedBy: payload.updated_by ?? null,
        updatedAt: payload.updated_at ?? null,
      };
    }),
  }));

  return changed ? { ...session, rounds } : session;
}
