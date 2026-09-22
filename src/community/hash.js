const PLAYER_HASH = /^#\/player\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const COMMUNITY_HASH = /^#\/community(?:\/(friends|stats))?$/;

export function playerProfileHash(playerId) {
  return `#/player/${playerId}`;
}

export function communityHash(section = '') {
  if (section === 'friends') return '#/community/friends';
  if (section === 'stats') return '#/community/stats';
  return '#/community';
}

export function parseCommunityHash(hash) {
  const value = String(hash ?? '');
  const player = value.match(PLAYER_HASH);
  if (player) {
    return { view: 'player', playerId: player[1], section: null };
  }
  const community = value.match(COMMUNITY_HASH);
  if (community) {
    return { view: 'community', playerId: null, section: community[1] || 'friends' };
  }
  return null;
}
