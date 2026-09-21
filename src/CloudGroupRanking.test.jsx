import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudGroupRankingPanel } from './CloudGroupRanking.jsx';
import { shouldApplyGroupLoad } from './cloudGroupPanel.js';

const payload = {
  group_id: 'g1',
  members: [
    { user_id: 'u1', display_name: 'André', role: 'owner', player_id: 'p1', player_name: 'André' },
    { user_id: 'u2', display_name: 'Paulo', role: 'member', player_id: 'p2', player_name: 'Paulo' },
    { user_id: 'u3', display_name: 'Davi', role: 'member', player_id: null, player_name: null },
    { user_id: 'u4', display_name: 'Idle', role: 'member', player_id: 'p-idle', player_name: 'Idle' },
  ],
  matches: [
    {
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

describe('CloudGroupRankingPanel', () => {
  it('mostra loading, erro com retry e nunca trata payload nulo como loading', () => {
    const loading = renderToStaticMarkup(
      <CloudGroupRankingPanel loading error={null} payload={null} onRetry={() => {}} onSelectUser={() => {}} />
    );
    expect(loading).toContain('Carregando ranking');

    const erro = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error="Falha no ranking"
        payload={null}
        onRetry={() => {}}
        onSelectUser={() => {}}
      />
    );
    expect(erro).toContain('Falha no ranking');
    expect(erro).toContain('Recarregar');
    expect(erro).not.toContain('Carregando ranking');
  });

  it('lista ranking, convidado fora do leaderboard e membro sem player', () => {
    const html = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error={null}
        payload={payload}
        selectedUserId={null}
        lineupSize={null}
        onRetry={() => {}}
        onSelectUser={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(html).toContain('André');
    expect(html).toContain('Paulo');
    expect(html).toContain('Jogador ainda não vinculado');
    expect(html).toContain('Ainda sem partidas no grupo');
    expect(html).toContain('Idle');
    expect(html).not.toMatch(/#\d+ Convidado/);
    expect(html).toContain('2x2');
  });

  it('filtra modalidade sem novo payload e abre perfil', () => {
    const html = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error={null}
        payload={payload}
        selectedUserId="u1"
        lineupSize={2}
        onRetry={() => {}}
        onSelectUser={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(html).toContain('2x2');
    expect(html).toContain('somente partidas deste grupo');
    expect(html).toContain('← Ranking');
  });

  it('abre perfil do membro e volta ao ranking', () => {
    const html = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error={null}
        payload={payload}
        selectedUserId="u1"
        lineupSize={null}
        onRetry={() => {}}
        onSelectUser={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(html).toContain('← Ranking');
    expect(html).toContain('Ranking:');
    expect(html).toContain('somente partidas deste grupo');
  });

  it('grupo sem partidas e stale load helper', () => {
    const empty = renderToStaticMarkup(
      <CloudGroupRankingPanel
        loading={false}
        error={null}
        payload={{ group_id: 'g1', members: payload.members, matches: [] }}
        selectedUserId={null}
        onRetry={() => {}}
        onSelectUser={() => {}}
        onChangeLineupSize={() => {}}
      />
    );
    expect(empty).toContain('Ainda não há partidas válidas no grupo');
    expect(empty).toContain('Jogador ainda não vinculado');
    expect(shouldApplyGroupLoad('g1', 'g2')).toBe(false);
  });
});
