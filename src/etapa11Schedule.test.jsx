import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudGroupOpenPanel } from './CloudGroupDetail.jsx';
import { COMMUNITY_BETA_ENABLED, isCommunityBetaEnabled } from './community/flags.js';
import { mapGroup } from './supabase/groupMappers.js';
import { groupProposalHash, groupScheduleHash, parseGroupScheduleHash } from './schedule/hash.js';
import { applyAvailabilityChange, AVAILABILITY_REALTIME_STRATEGY } from './schedule/availabilityRealtime.js';
import { applyProposalChange, PROPOSAL_REALTIME_STRATEGY } from './schedule/proposalRealtime.js';
import { canEditProposal, mapAvailabilityPayload, mapProposal, mergeAvailabilitySlots } from './schedule/mappers.js';
import AvailabilityGrid from './schedule/AvailabilityGrid.jsx';
import BestWindowsList from './schedule/BestWindowsList.jsx';
import ConvertProposalForm from './schedule/ConvertProposalForm.jsx';
import LocationField from './schedule/LocationField.jsx';
import ProposalCard from './schedule/ProposalCard.jsx';
import ProposalDetail from './schedule/ProposalDetail.jsx';
import ProposalLocation from './schedule/ProposalLocation.jsx';
import GroupScheduleView from './schedule/GroupScheduleView.jsx';
import { buildAvailabilityGrid, rankAvailabilityWindows, zonedLocalToUtc } from './domain/groupAvailability.js';

const srcRoot = dirname(fileURLToPath(import.meta.url));
function read(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

const tz = 'America/Sao_Paulo';
const start = zonedLocalToUtc(tz, 2026, 9, 26, 19, 0).toISOString();
const end = zonedLocalToUtc(tz, 2026, 9, 26, 21, 0).toISOString();
const members = [
  { userId: 'u1', displayName: 'André', username: 'andre' },
  { userId: 'u2', displayName: 'Paulo', username: 'paulo' },
];
const proposal = mapProposal({
  id: '11111111-1111-1111-1111-111111111111',
  group_id: 'g1',
  created_by: 'u1',
  title: 'Jogo de sábado',
  starts_at: start,
  ends_at: end,
  location_name: 'Quadra X',
  location_details: 'Rua X',
  notes: 'Levar bola',
  status: 'open',
  linked_session_id: null,
  version: 1,
  counts: { yes: 1, maybe: 1, no: 0, unanswered: 0 },
  responses: [
    { user_id: 'u1', display_name: 'André', username: 'andre', response: 'yes', player_id: 'p1', player_name: 'André' },
    { user_id: 'u2', display_name: 'Paulo', username: 'paulo', response: 'maybe', player_id: null },
  ],
  creator: { user_id: 'u1', display_name: 'André', username: 'andre' },
});

const ownerGroup = mapGroup({
  myUserId: 'u1',
  group: {
    id: 'g1',
    name: 'Vôlei Quinta',
    join_code: 'AB23CD56',
    timezone: 'America/Sao_Paulo',
    created_by: 'u1',
  },
  members: [
    { user_id: 'u1', role: 'owner', profiles: { display_name: 'André' } },
    { user_id: 'u2', role: 'member', profiles: { display_name: 'Paulo' } },
  ],
});

describe('etapa 11: disponibilidade e propostas', () => {
  it('flag community esconde/mostra a aba e não cria item no bottom nav', () => {
    expect(COMMUNITY_BETA_ENABLED).toBe(true);
    expect(isCommunityBetaEnabled()).toBe(true);
    expect(read('CloudGroupDetail.jsx')).toContain("id: 'disponibilidade'");
    expect(read('CloudGroupDetail.jsx')).toContain('isCommunityBetaEnabled');
    expect(read('ui/AppShell.jsx')).not.toContain('Disponibilidade');
    const html = renderToStaticMarkup(
      <CloudGroupOpenPanel
        groupLoading={false}
        groupError={null}
        group={ownerGroup}
        sessions={[]}
        user={{ id: 'u1' }}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
    expect(html).toContain('Disponibilidade');
    expect(html).toContain('Visão geral');
    expect(html).toContain('Chat');
  });

  it('rotas hash de schedule e proposal', () => {
    const groupId = '667d0098-60e4-4f3b-8a4b-3094c76e6b51';
    const proposalId = '11111111-1111-1111-1111-111111111111';
    expect(groupScheduleHash(groupId)).toBe(`#/group/${groupId}/schedule`);
    expect(parseGroupScheduleHash(`#/group/${groupId}/schedule`)).toEqual({
      groupId,
      section: 'disponibilidade',
      proposalId: null,
    });
    expect(parseGroupScheduleHash(groupProposalHash(groupId, proposalId))).toEqual({
      groupId,
      section: 'disponibilidade',
      proposalId,
    });
    expect(read('App.jsx')).toContain('parseGroupScheduleHash');
    expect(read('../vite.config.js')).toContain("/volleybal-drafter/");
  });

  it('grade, marcar slot, melhores horários e empty states', () => {
    const slot = zonedLocalToUtc(tz, 2026, 9, 21, 19, 0).toISOString();
    const grid = buildAvailabilityGrid({
      timeZone: tz,
      start: zonedLocalToUtc(tz, 2026, 9, 21, 12, 0),
      dayCount: 7,
      members,
      slots: [{ userId: 'u1', slotStart: slot }],
    });
    const html = renderToStaticMarkup(
      <AvailabilityGrid grid={grid} members={members} myUserId="u1" selected={new Set([slot])} editing />
    );
    expect(html).toContain('Horários em America/Sao_Paulo');
    expect(html).toContain('grade 08:00–23:00');
    expect(html).toContain('19:00');
    expect(html).toContain('você');

    const ranked = rankAvailabilityWindows({
      members,
      slots: [
        { userId: 'u1', slotStart: start },
        { userId: 'u1', slotStart: zonedLocalToUtc(tz, 2026, 9, 26, 19, 30).toISOString() },
        { userId: 'u1', slotStart: zonedLocalToUtc(tz, 2026, 9, 26, 20, 0).toISOString() },
        { userId: 'u1', slotStart: zonedLocalToUtc(tz, 2026, 9, 26, 20, 30).toISOString() },
      ],
      durationMinutes: 120,
    });
    const best = renderToStaticMarkup(
      <BestWindowsList windows={ranked} members={members} timeZone={tz} durationMinutes={120} />
    );
    expect(best).toContain('Horários com mais pessoas disponíveis');
    expect(best).toContain('Criar proposta');
    expect(best).toContain('André');
  });

  it('proposal card, detalhe RSVP, permissões e local texto', () => {
    const card = renderToStaticMarkup(<ProposalCard proposal={proposal} timeZone={tz} />);
    expect(card).toContain('Jogo de sábado');
    expect(card).toContain('Quadra X');
    expect(card).toContain('1 vão');
    expect(card).toContain('Aberta');

    const detail = renderToStaticMarkup(
      <ProposalDetail proposal={proposal} members={members} timeZone={tz} myUserId="u1" myRole="owner" />
    );
    expect(detail).toContain('Vou');
    expect(detail).toContain('Talvez');
    expect(detail).toContain('Não vou');
    expect(detail).toContain('Quem vai');
    expect(detail).toContain('Confirmar horário');
    expect(detail).toContain('Horários em America/Sao_Paulo');
    expect(canEditProposal(proposal, 'u2', 'member')).toBe(false);
    expect(canEditProposal(proposal, 'u1', 'member')).toBe(true);

    const location = renderToStaticMarkup(
      <LocationField locationName="Quadra do São Mateus" locationDetails="Rua X" onChange={() => {}} />
    );
    expect(location).toContain('data-location-mode="text"');
    expect(renderToStaticMarkup(<ProposalLocation locationName="Quadra X" />)).toContain('Quadra X');
  });

  it('criar encontro lista Vou, player vinculado e sem player', () => {
    const confirmed = {
      ...proposal,
      status: 'confirmed',
      responses: [
        { userId: 'u1', displayName: 'André', response: 'yes', playerId: 'p1', playerName: 'André' },
        { userId: 'u2', displayName: 'Paulo', response: 'yes', playerId: null },
      ],
    };
    const html = renderToStaticMarkup(
      <ConvertProposalForm proposal={confirmed} members={members} />
    );
    expect(html).toContain('Adicionar jogador ao encontro');
    expect(html).toContain('Sem jogador vinculado');
    expect(html).toContain('não entra sozinho');
    expect(html).not.toContain('Dar acesso ao encontro aos participantes confirmados');
  });

  it('loading/error/empty da agenda e realtime merge', () => {
    const loading = renderToStaticMarkup(
      <GroupScheduleView group={ownerGroup} user={{ id: 'u1' }} />
    );
    expect(loading).toContain('Carregando disponibilidade');

    let slots = mergeAvailabilitySlots([], { user_id: 'u2', slot_start: start }, 'INSERT');
    slots = applyAvailabilityChange(slots, {
      eventType: 'INSERT',
      new: { user_id: 'u2', slot_start: start },
    });
    expect(slots).toHaveLength(1);
    slots = applyAvailabilityChange(slots, {
      eventType: 'DELETE',
      old: { user_id: 'u2', slot_start: start },
    });
    expect(slots).toHaveLength(0);
    expect(AVAILABILITY_REALTIME_STRATEGY).toBe('rpc-then-dedupe-by-user-slot');

    const listed = applyProposalChange([], {
      eventType: 'INSERT',
      new: {
        id: proposal.id,
        group_id: 'g1',
        created_by: 'u1',
        title: 'Jogo de sábado',
        starts_at: start,
        ends_at: end,
        status: 'open',
        version: 1,
      },
    });
    const duped = applyProposalChange(listed, {
      eventType: 'UPDATE',
      new: { id: proposal.id, status: 'confirmed', title: 'Jogo de sábado', starts_at: start, ends_at: end, version: 2 },
    });
    expect(duped).toHaveLength(1);
    expect(duped[0].status).toBe('confirmed');
    expect(PROPOSAL_REALTIME_STRATEGY).toBe('rpc-then-reload-by-id');
  });

  it('mappers de disponibilidade e invariantes de domínio', () => {
    const payload = mapAvailabilityPayload({
      group_id: 'g1',
      timezone: 'America/Sao_Paulo',
      members: [{ user_id: 'u1', username: 'andre', display_name: 'André', avatar_path: null }],
      slots: [{ user_id: 'u1', slot_start: start }],
    });
    expect(payload.members[0].userId).toBe('u1');
    expect(JSON.stringify(payload)).not.toContain('email');
    expect(read('schedule/GroupScheduleView.jsx')).toContain('addCloudSessionPlayer');
    expect(read('schedule/GroupScheduleView.jsx')).toContain('createSessionFromGroupProposal');
    expect(read('schedule/GroupScheduleView.jsx')).not.toContain(".from('session_players')");
    expect(read('schedule/GroupScheduleView.jsx')).not.toContain('session_members');
    expect(read('../supabase/migrations/20260922160000_group_scheduling.sql')).toContain(
      'create_session_from_group_proposal'
    );
    expect(read('../vite.config.js')).toContain("base: '/volleybal-drafter/'");
  });
});
