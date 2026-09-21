import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudGroupOpenPanel } from './CloudGroupDetail.jsx';
import {
  createdCloudGroupId,
  fetchOpenCloudGroup,
  shouldApplyGroupListLoad,
  shouldApplyGroupLoad,
} from './cloudGroupPanel.js';
import { mapGroup } from './supabase/groupMappers.js';

const ownerGroup = mapGroup({
  myUserId: 'u1',
  group: {
    id: 'g1',
    name: 'Vôlei Quinta',
    description: null,
    join_code: 'AB23CD56',
    created_by: 'u1',
  },
  members: [
    { user_id: 'u1', role: 'owner', profiles: { display_name: 'André' } },
    { user_id: 'u2', role: 'admin', profiles: { display_name: 'Paulo' } },
    { user_id: 'u3', role: 'member', profiles: { display_name: 'Davi' } },
  ],
});

describe('cloud group panel', () => {
  it('createdCloudGroupId e stale load', () => {
    expect(createdCloudGroupId({ ok: true, groupId: 'g1' })).toBe('g1');
    expect(createdCloudGroupId({ ok: false })).toBeNull();
    expect(shouldApplyGroupLoad('g1', 'g1')).toBe(true);
    expect(shouldApplyGroupLoad('g1', 'g2')).toBe(false);
    expect(shouldApplyGroupListLoad('u1', 'u1')).toBe(true);
    expect(shouldApplyGroupListLoad('u1', 'u2')).toBe(false);
    expect(shouldApplyGroupListLoad('u1', null)).toBe(false);
  });

  it('fetchOpenCloudGroup não trata null como loading', async () => {
    const failed = await fetchOpenCloudGroup(async () => ({ ok: false, error: { message: 'boom' } }), 'g1', 'u1');
    expect(failed).toEqual({ ok: false, group: null, error: 'boom' });
  });

  it('mostra loading, erro com retry/back e detalhe com papéis', () => {
    const loading = renderToStaticMarkup(
      <CloudGroupOpenPanel groupLoading groupError={null} group={null} onBack={() => {}} onRetry={() => {}} />
    );
    expect(loading).toContain('Carregando grupo');

    const erro = renderToStaticMarkup(
      <CloudGroupOpenPanel
        groupLoading={false}
        groupError="Falha ao abrir"
        group={null}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(erro).toContain('Falha ao abrir');
    expect(erro).toContain('Recarregar');
    expect(erro).toContain('Grupos');

    const detail = renderToStaticMarkup(
      <CloudGroupOpenPanel
        groupLoading={false}
        groupError={null}
        group={ownerGroup}
        sessions={[]}
        sessionsLoading={false}
        sessionsError={null}
        user={{ id: 'u1' }}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(detail).toContain('Vôlei Quinta');
    expect(detail).toContain('Sem descrição');
    expect(detail).toContain('André');
    expect(detail).toContain('Owner');
    expect(detail).toContain('Promover a admin');
    expect(detail).toContain('Rebaixar a membro');
    expect(detail).toContain('Novo encontro neste grupo');
    expect(detail).toContain('Ranking');
    expect(detail).not.toContain('Carregando grupo');
  });

  it('member não vê controles de admin', () => {
    const memberGroup = { ...ownerGroup, myRole: 'member' };
    const html = renderToStaticMarkup(
      <CloudGroupOpenPanel
        groupLoading={false}
        groupError={null}
        group={memberGroup}
        sessions={[]}
        user={{ id: 'u3' }}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(html).toContain('Sair do grupo');
    expect(html).not.toContain('Promover a admin');
    expect(html).not.toContain('Gerar novo código');
  });
});
