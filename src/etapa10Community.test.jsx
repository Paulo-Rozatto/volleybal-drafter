import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AppShell from './ui/AppShell.jsx';
import CommunityView from './community/CommunityView.jsx';
import { COMMUNITY_BETA_ENABLED, isCommunityBetaEnabled } from './community/flags.js';
import { communityHash, parseCommunityHash, playerProfileHash } from './community/hash.js';
import { applyGroupChatChange, GROUP_CHAT_REALTIME_STRATEGY } from './community/chatRealtime.js';
import { mapGroupMessage, mergeGroupMessage, payloadLooksPrivate, sortGroupMessages } from './community/mappers.js';
import { mapSocialPerformanceMatches } from './community/socialMatches.js';
import { mapCloudPerformanceMatches } from './supabase/cloudPerformance.js';
import { buildPlayerPerformanceIndexFromMatches, getPlayerPerformance } from './domain/playerPerformance.js';
import { buildGlobalPerformance, splitGlobalLeaderboard } from './community/globalPerformance.js';
import { formatUsername, isValidUsername, normalizeUsernameInput } from './community/usernames.js';
import { GlobalStatsPanel } from './community/GlobalStatsView.jsx';
import { PlayerProfilePanel } from './community/PlayerProfileView.jsx';
import { CloudGroupRankingPanel } from './CloudGroupRanking.jsx';
import FriendRosterSection from './community/FriendRosterSection.jsx';
import GroupChatPanel from './community/GroupChatPanel.jsx';

const srcRoot = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

const groupPayload = {
  group_id: 'g1',
  members: [
    {
      user_id: 'u1',
      display_name: 'André',
      username: 'andre',
      avatar_path: null,
      role: 'owner',
      player_id: 'p1',
      player_name: 'André',
    },
    {
      user_id: 'u2',
      display_name: 'Paulo',
      username: 'paulo',
      avatar_path: null,
      role: 'member',
      player_id: 'p2',
      player_name: 'Paulo',
    },
  ],
  matches: [
    {
      source_kind: 'session',
      match_id: 'm1',
      session_id: 's1',
      session_name: 'Quinta',
      session_date: '2026-09-21',
      session_updated_at: '2026-09-21T12:00:00.000Z',
      session_created_at: '2026-09-21T12:00:00.000Z',
      legacy_source_id: null,
      round_id: 'r1',
      round_number: 1,
      cycle_number: 1,
      score_a: 21,
      score_b: 18,
      lineup_a: [
        { player_id: 'p1', player_name_snapshot: 'André', sort_index: 0 },
        { player_id: 'p2', player_name_snapshot: 'Paulo', sort_index: 1 },
      ],
      lineup_b: [
        { player_id: 'p-guest', player_name_snapshot: 'Convidado', sort_index: 0 },
        { player_id: 'p-other', player_name_snapshot: 'Outro', sort_index: 1 },
      ],
    },
  ],
};

const socialMatches = [
  {
    source_kind: 'session',
    social_match_id: 'a'.repeat(32),
    source_token: 'b'.repeat(32),
    origin_key: 'c'.repeat(32),
    round_token: 'd'.repeat(32),
    date: '2026-09-21',
    round_number: 1,
    cycle_number: 1,
    score_a: 21,
    score_b: 18,
    lineup_a: groupPayload.matches[0].lineup_a,
    lineup_b: groupPayload.matches[0].lineup_b,
  },
];

describe('etapa 10: comunidade beta', () => {
  it('flag default true e menu Comunidade Beta fora do bottom nav', () => {
    expect(COMMUNITY_BETA_ENABLED).toBe(true);
    expect(isCommunityBetaEnabled()).toBe(true);
    const shell = read('ui/AppShell.jsx');
    expect(shell).toMatch("id: 'sessions'");
    expect(shell).toContain('Comunidade');
    expect(shell).toContain('Beta');
    expect(shell).toContain('communityEnabled');
    expect(shell).toContain('grid-cols-4');
    expect(shell).not.toMatch('PRIMARY.push');
    const html = renderToStaticMarkup(
      <AppShell currentView="sessions" user={{ email: 'a@b.c' }} showPrimaryNav communityEnabled onNavigate={() => {}}>
        <p>ok</p>
      </AppShell>
    );
    expect(html).toContain('Comunidade');
    expect(html).toContain('Beta');
    const off = renderToStaticMarkup(
      <AppShell currentView="sessions" user={{ email: 'a@b.c' }} showPrimaryNav communityEnabled={false} onNavigate={() => {}}>
        <p>ok</p>
      </AppShell>
    );
    expect(off).not.toContain('Comunidade');
  });

  it('rotas hash e telas Amigos/Estatísticas', () => {
    expect(parseCommunityHash('#/community')).toEqual({ view: 'community', playerId: null, section: 'friends' });
    expect(parseCommunityHash('#/community/stats')).toEqual({ view: 'community', playerId: null, section: 'stats' });
    expect(parseCommunityHash('#/player/667d0098-60e4-4f3b-8a4b-3094c76e6b51')).toEqual({
      view: 'player',
      playerId: '667d0098-60e4-4f3b-8a4b-3094c76e6b51',
      section: null,
    });
    expect(communityHash('stats')).toBe('#/community/stats');
    expect(playerProfileHash('p1')).toBe('#/player/p1');
    const friends = renderToStaticMarkup(<CommunityView section="friends" onSection={() => {}} />);
    expect(friends).toContain('Comunidade');
    expect(friends).toContain('Beta');
    expect(friends).toContain('Amigos');
    expect(friends).toContain('Estatísticas');
    expect(friends).toContain('Carregando amigos');
    const stats = renderToStaticMarkup(<CommunityView section="stats" onSection={() => {}} />);
    expect(stats).toContain('Carregando estatísticas');
  });

  it('username público simples e avatar cai em iniciais', () => {
    expect(normalizeUsernameInput('@Andre')).toBe('andre');
    expect(isValidUsername('andre')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(formatUsername('andre')).toBe('@andre');
    const profile = renderToStaticMarkup(
      <PlayerProfilePanel
        loading={false}
        error={null}
        payload={{
          profile: {
            userId: 'u1',
            username: 'andre',
            displayName: 'André',
            avatarPath: null,
            playerId: 'p1',
            playerName: 'André',
          },
          player: { id: 'p1', name: 'André' },
          matches: socialMatches,
        }}
        onBack={() => {}}
      />
    );
    expect(profile).toContain('André');
    expect(profile).toContain('@andre');
    expect(profile).toContain('Geral');
    expect(profile).toContain('AN');
  });

  it('ranking global usa o motor, guest fora, clique abre perfil', () => {
    const model = buildGlobalPerformance({
      players: [
        { user_id: 'u1', username: 'andre', display_name: 'André', avatar_path: null, player_id: 'p1', player_name: 'André' },
        { user_id: 'u2', username: 'paulo', display_name: 'Paulo', avatar_path: null, player_id: 'p2', player_name: 'Paulo' },
      ],
      matches: socialMatches,
    });
    const board = splitGlobalLeaderboard(model);
    expect(board.ranked.map((row) => row.playerId)).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(board.ranked.map((row) => row.playerId)).not.toContain('p-guest');
    const html = renderToStaticMarkup(
      <GlobalStatsPanel
        loading={false}
        error={null}
        model={model}
        selectedPlayerId={null}
        lineupSize={null}
        onRetry={() => {}}
        onSelectPlayer={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(html).toContain('André');
    expect(html).toContain('@andre');
    expect(html).toContain('2x2');
    expect(payloadLooksPrivate(groupPayload)).toBe(false);
  });

  it('payload social preserva métricas do motor e omite nome privado da origem', () => {
    const roster = [
      { id: 'p1', name: 'André' },
      { id: 'p2', name: 'Paulo' },
    ];
    const social = mapSocialPerformanceMatches(socialMatches);
    const cloud = mapCloudPerformanceMatches(groupPayload.matches);
    const socialBuilt = buildPlayerPerformanceIndexFromMatches({ matches: social, roster });
    const cloudBuilt = buildPlayerPerformanceIndexFromMatches({ matches: cloud, roster });
    expect(social[0].sourceName).toBeNull();
    expect(cloud[0].sourceName).toBe('Quinta');
    expect(getPlayerPerformance(socialBuilt.index, 'p1')).toMatchObject({
      wins: getPlayerPerformance(cloudBuilt.index, 'p1').wins,
      matches: getPlayerPerformance(cloudBuilt.index, 'p1').matches,
      losses: getPlayerPerformance(cloudBuilt.index, 'p1').losses,
      winRate: getPlayerPerformance(cloudBuilt.index, 'p1').winRate,
      pointDifference: getPlayerPerformance(cloudBuilt.index, 'p1').pointDifference,
    });
  });

  it('perfil no grupo deixa o contexto explícito e lista parceiros/adversários', () => {
    const html = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error={null}
        payload={groupPayload}
        selectedUserId="u1"
        lineupSize={null}
        groupName="Vôlei Quinta"
        onRetry={() => {}}
        onSelectUser={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(html).toContain('← Ranking');
    expect(html).toContain('Grupo Vôlei Quinta');
    expect(html).toContain('somente partidas deste grupo');
    expect(html).toContain('Melhores parceiros');
    expect(html).toContain('Adversários mais difíceis');
    expect(html).toContain('partidas juntos');
  });

  it('chat empty/loading/error, ordenação e dedupe realtime', () => {
    const empty = renderToStaticMarkup(
      <GroupChatPanel group={{ id: 'g1', members: [] }} user={{ id: 'u1' }} />
    );
    expect(empty).toContain('Carregando chat');
    const mapped = [
      mapGroupMessage({
        id: 'm2',
        group_id: 'g1',
        sender_user_id: 'u1',
        body: 'depois',
        created_at: '2026-09-21T13:00:00.000Z',
      }),
      mapGroupMessage({
        id: 'm1',
        group_id: 'g1',
        sender_user_id: 'u1',
        body: 'antes',
        created_at: '2026-09-21T12:00:00.000Z',
      }),
    ];
    expect(sortGroupMessages(mapped).map((item) => item.id)).toEqual(['m1', 'm2']);
    const first = applyGroupChatChange([], {
      eventType: 'INSERT',
      new: { id: 'm1', group_id: 'g1', sender_user_id: 'u1', body: 'oi', created_at: '2026-09-21T12:00:00.000Z' },
    });
    const duped = applyGroupChatChange(first, {
      eventType: 'INSERT',
      new: { id: 'm1', group_id: 'g1', sender_user_id: 'u1', body: 'oi', created_at: '2026-09-21T12:00:00.000Z' },
    });
    expect(duped).toHaveLength(1);
    expect(GROUP_CHAT_REALTIME_STRATEGY).toBe('rpc-then-dedupe-by-id');
    const removed = mapGroupMessage({
      id: 'm3',
      sender_user_id: 'u1',
      body: 'segredo',
      deleted_at: '2026-09-21T14:00:00.000Z',
    });
    expect(removed.deleted).toBe(true);
    expect(removed.body).toBe('');
    expect(mergeGroupMessage(first, first[0])).toHaveLength(1);
  });

  it('amigos na seleção do encontro e APIs isoladas', () => {
    const html = renderToStaticMarkup(
      <FriendRosterSection roster={[]} onAddFriend={() => {}} />
    );
    expect(html).toContain('Amigos');
    expect(html).toContain('Adicionar ao elenco não dá acesso');
    const friendsApi = read('community/friendsApi.js');
    expect(friendsApi).toContain('search_users_for_friendship');
    expect(friendsApi).not.toContain(".from('profiles')");
    expect(friendsApi).not.toContain('select *');
    const globalApi = read('community/globalPerformance.js');
    expect(globalApi).toContain('export async function loadGlobalPerformance');
    expect(globalApi).toContain('get_global_performance_matches');
    expect(read('App.jsx')).toContain('communityHash');
    expect(read('App.jsx')).toContain('playerProfileHash');
    expect(read('CloudGroupDetail.jsx')).toContain("id: 'chat'");
    expect(read('CloudSessionDetail.jsx')).toContain('FriendRosterSection');
    expect(read('CloudSessionDetail.jsx')).toContain('addFriendToRoster');
    expect(read('community/flags.js')).toContain('COMMUNITY_BETA_ENABLED');
  });
});
