import { useEffect, useMemo, useState } from 'react';
import {
  AVAILABILITY_UI_DAYS,
  addZonedDays,
  buildAvailabilityGrid,
  DEFAULT_GROUP_TIMEZONE,
  formatZonedRange,
  listZonedDays,
  rankAvailabilityWindows,
  startOfZonedWeek,
  zonedLocalToUtc,
  zonedParts,
} from '../domain/groupAvailability.js';
import { sendGroupMessage } from '../community/chatApi.js';
import { addCloudSessionPlayer } from '../supabase/sessionApi.js';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import ErrorState from '../ui/ErrorState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
import SectionCard from '../ui/SectionCard.jsx';
import Tabs from '../ui/Tabs.jsx';
import { showToast } from '../ui/toast.js';
import { fetchGroupAvailability, saveMyGroupAvailability } from './availabilityApi.js';
import useGroupAvailabilityRealtime from './availabilityRealtime.js';
import AvailabilityGrid from './AvailabilityGrid.jsx';
import BestWindowsList from './BestWindowsList.jsx';
import ConvertProposalForm from './ConvertProposalForm.jsx';
import { groupProposalHash } from './hash.js';
import { proposalShareText, timezoneHint } from './labels.js';
import {
  cancelGroupGameProposal,
  confirmGroupGameProposal,
  createGroupGameProposal,
  createSessionFromGroupProposal,
  fetchGroupGameProposals,
  respondToGroupGameProposal,
  updateGroupGameProposal,
} from './proposalApi.js';
import ProposalCard from './ProposalCard.jsx';
import ProposalDetail from './ProposalDetail.jsx';
import ProposalForm from './ProposalForm.jsx';
import useGroupProposalRealtime from './proposalRealtime.js';

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function weekWindow(timeZone, startDate, dayCount = AVAILABILITY_UI_DAYS) {
  const week = startOfZonedWeek(startDate, timeZone);
  const days = listZonedDays(timeZone, week, dayCount);
  const first = days[0];
  const last = addZonedDays(timeZone, days[days.length - 1].year, days[days.length - 1].month, days[days.length - 1].day, 1);
  return {
    start: zonedLocalToUtc(timeZone, first.year, first.month, first.day, 0, 0).toISOString(),
    end: zonedLocalToUtc(timeZone, last.year, last.month, last.day, 0, 0).toISOString(),
    week,
  };
}

export default function GroupScheduleView({
  group,
  user,
  openProposalId = null,
  onOpenProposal,
  onOpenSession,
}) {
  const timeZone = group?.timezone || DEFAULT_GROUP_TIMEZONE;
  const myUserId = user?.id ?? null;
  const [tab, setTab] = useState(openProposalId ? 'propostas' : 'grade');
  const [panel, setPanel] = useState(openProposalId ? 'detail' : 'list');
  const [anchor, setAnchor] = useState(() => new Date());
  const [members, setMembers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [draft, setDraft] = useState(null);
  const [offline, setOffline] = useState(!isOnline());

  const windowRange = useMemo(() => weekWindow(timeZone, anchor), [timeZone, anchor]);
  const proposal = proposals.find((item) => item.id === openProposalId) ?? null;
  const groupId = group?.id ?? null;

  async function refresh() {
    if (!groupId) return;
    const [availability, listed] = await Promise.all([
      fetchGroupAvailability(groupId, windowRange.start, windowRange.end),
      fetchGroupGameProposals(groupId),
    ]);
    if (availability.ok) {
      setMembers(availability.payload.members);
      setSlots(availability.payload.slots);
      setError(null);
    } else {
      setError(availability.error?.message || 'Não foi possível carregar a disponibilidade.');
    }
    if (listed.ok) setProposals(listed.payload.proposals);
    else if (availability.ok) setError(listed.error?.message || 'Não foi possível carregar as propostas.');
    setLoading(false);
  }

  useEffect(() => {
    if (!groupId) return undefined;
    let cancelled = false;
    (async () => {
      const [availability, listed] = await Promise.all([
        fetchGroupAvailability(groupId, windowRange.start, windowRange.end),
        fetchGroupGameProposals(groupId),
      ]);
      if (cancelled) return;
      if (availability.ok) {
        setMembers(availability.payload.members);
        setSlots(availability.payload.slots);
        setError(null);
      } else {
        setError(availability.error?.message || 'Não foi possível carregar a disponibilidade.');
      }
      if (listed.ok) setProposals(listed.payload.proposals);
      else if (availability.ok) setError(listed.error?.message || 'Não foi possível carregar as propostas.');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, windowRange.end, windowRange.start]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    globalThis.addEventListener?.('online', on);
    globalThis.addEventListener?.('offline', off);
    return () => {
      globalThis.removeEventListener?.('online', on);
      globalThis.removeEventListener?.('offline', off);
    };
  }, []);

  useGroupAvailabilityRealtime(groupId, setSlots);
  useGroupProposalRealtime(groupId, setProposals);

  const grid = useMemo(
    () =>
      buildAvailabilityGrid({
        timeZone,
        start: anchor,
        dayCount: AVAILABILITY_UI_DAYS,
        slots,
        members,
      }),
    [anchor, members, slots, timeZone]
  );

  const ranked = useMemo(
    () =>
      rankAvailabilityWindows({
        members,
        slots,
        durationMinutes,
        from: windowRange.start,
        to: windowRange.end,
        limit: 8,
      }),
    [durationMinutes, members, slots, windowRange.end, windowRange.start]
  );

  function beginEdit() {
    setSelected(new Set(slots.filter((slot) => slot.userId === myUserId).map((slot) => slot.slotStart)));
    setEditing(true);
    setTab('grade');
    setPanel('list');
  }

  function toggleSlot(iso, force) {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = force == null ? !next.has(iso) : force;
      if (shouldSelect) next.add(iso);
      else next.delete(iso);
      return next;
    });
  }

  async function saveAvailability() {
    if (!isOnline()) {
      showToast('Sem conexão. A disponibilidade não foi salva.');
      return;
    }
    setSaving(true);
    const mine = [...selected].filter((iso) => iso >= windowRange.start && iso < windowRange.end);
    const result = await saveMyGroupAvailability(group.id, windowRange.start, windowRange.end, mine);
    setSaving(false);
    if (!result.ok) {
      showToast(result.error?.message || 'Não foi possível salvar a disponibilidade.');
      return;
    }
    setEditing(false);
    showToast('Disponibilidade salva.');
    await refresh();
  }

  async function createProposal(values) {
    if (!isOnline()) {
      showToast('Sem conexão. A proposta não foi criada.');
      return;
    }
    setSaving(true);
    const result = await createGroupGameProposal({
      groupId: group.id,
      ...values,
    });
    setSaving(false);
    if (!result.ok) {
      showToast(result.error?.message || 'Não foi possível criar a proposta.');
      return;
    }
    setProposals((current) => {
      const without = current.filter((item) => item.id !== result.proposal.id);
      return [...without, result.proposal].sort((left, right) => String(left.startsAt).localeCompare(String(right.startsAt)));
    });
    setPanel('detail');
    setTab('propostas');
    onOpenProposal?.(result.proposal.id);
    showToast('Proposta criada.');
  }

  async function runProposal(action, success) {
    if (!isOnline()) {
      showToast('Sem conexão.');
      return;
    }
    setSaving(true);
    const result = await action();
    setSaving(false);
    if (!result.ok) {
      showToast(result.error?.message || 'Não foi possível atualizar a proposta.');
      return;
    }
    if (result.proposal) {
      setProposals((current) => current.map((item) => (item.id === result.proposal.id ? result.proposal : item)));
    }
    if (success) showToast(success);
    return result;
  }

  async function convertProposal({ teamSize, teamCount, playerUserIds }) {
    if (!proposal) return;
    if (!isOnline()) {
      showToast('Sem conexão. O encontro não foi criado.');
      return;
    }
    setSaving(true);
    const created = await createSessionFromGroupProposal(proposal.id, proposal.version, { teamSize, teamCount });
    if (!created.ok) {
      setSaving(false);
      showToast(created.error?.message || 'Não foi possível criar o encontro.');
      return;
    }
    let version = Number(created.structureVersion ?? 0);
    const selectedPeople = (created.proposal?.responses ?? proposal.responses ?? []).filter(
      (item) => playerUserIds.includes(item.userId) && item.playerId
    );
    for (const person of selectedPeople) {
      const added = await addCloudSessionPlayer(
        created.sessionId,
        person.playerId,
        person.playerName || person.displayName,
        version
      );
      if (added.ok) version += 1;
      else showToast(added.error?.message || 'Não foi possível adicionar um jogador ao encontro.');
    }
    setSaving(false);
    if (created.proposal) {
      setProposals((current) => current.map((item) => (item.id === created.proposal.id ? created.proposal : item)));
    }
    setPanel('detail');
    showToast(created.alreadyLinked ? 'Este encontro já existia.' : 'Encontro criado.');
  }

  const upcoming = proposals.filter((item) => item.status !== 'cancelled');

  if (loading) return <LoadingState label="Carregando disponibilidade..." />;
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setLoading(true);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        {timezoneHint(timeZone)}. Disponibilidade não cria proposta, proposta não cria encontro, e Vou não entra no
        elenco sozinho.
      </p>
      {offline ? (
        <p className="text-small font-semibold" style={{ color: 'var(--warning)' }}>
          Sem conexão. Dá para ver o último carregamento, mas não salvar.
        </p>
      ) : null}

      <Tabs
        label="Disponibilidade do grupo"
        value={tab}
        onChange={(next) => {
          setTab(next);
          if (next !== 'propostas') setPanel('list');
        }}
        options={[
          { id: 'grade', label: 'Grade' },
          { id: 'melhores', label: 'Maior disponibilidade' },
          { id: 'propostas', label: 'Próximos jogos' },
        ]}
      />

      {tab === 'grade' ? (
        <SectionCard title="Disponibilidade">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const parts = zonedParts(anchor, timeZone);
                const prev = addZonedDays(timeZone, parts.year, parts.month, parts.day, -7);
                setLoading(true);
                setAnchor(zonedLocalToUtc(timeZone, prev.year, prev.month, prev.day, 12, 0));
              }}
            >
              Semana anterior
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const parts = zonedParts(anchor, timeZone);
                const next = addZonedDays(timeZone, parts.year, parts.month, parts.day, 7);
                setLoading(true);
                setAnchor(zonedLocalToUtc(timeZone, next.year, next.month, next.day, 12, 0));
              }}
            >
              Próxima semana
            </Button>
            {editing ? (
              <>
                <Button disabled={saving || offline} onClick={saveAvailability}>
                  Salvar minha disponibilidade
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button onClick={beginEdit}>Informar minha disponibilidade</Button>
            )}
          </div>
          {slots.length === 0 && !editing ? (
            <EmptyState
              title="Ninguém informou disponibilidade ainda."
              description="Marque os horários em que você pode jogar. Isso não cria uma proposta."
              actionLabel="Informar minha disponibilidade"
              onAction={beginEdit}
            />
          ) : null}
          <AvailabilityGrid
            grid={grid}
            members={members}
            myUserId={myUserId}
            selected={selected}
            editing={editing}
            onToggleSlot={toggleSlot}
            onPaintSlots={toggleSlot}
          />
        </SectionCard>
      ) : null}

      {tab === 'melhores' ? (
        <BestWindowsList
          windows={ranked}
          members={members}
          timeZone={timeZone}
          durationMinutes={durationMinutes}
          onDurationChange={setDurationMinutes}
          onCreate={(window) => {
            setDraft({
              title: 'Jogo',
              startsAt: window.start,
              endsAt: window.end,
            });
            setPanel('create');
            setTab('propostas');
          }}
        />
      ) : null}

      {tab === 'propostas' && panel === 'list' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setDraft(null);
                setPanel('create');
              }}
            >
              Criar proposta
            </Button>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState
              title="Não há propostas de jogo."
              description="Crie uma proposta com horário, duração e local. Marcar disponibilidade não cria proposta."
              actionLabel="Criar proposta"
              onAction={() => {
                setDraft(null);
                setPanel('create');
              }}
            />
          ) : null}
          {proposals.map((item) => (
            <ProposalCard
              key={item.id}
              proposal={item}
              timeZone={timeZone}
              onOpen={(id) => {
                setPanel('detail');
                onOpenProposal?.(id);
              }}
            />
          ))}
        </section>
      ) : null}

      {tab === 'propostas' && panel === 'create' ? (
        <SectionCard title={draft?.id ? 'Editar proposta' : 'Nova proposta'}>
          <ProposalForm
            timeZone={timeZone}
            draft={draft}
            busy={saving}
            submitLabel={draft?.id ? 'Salvar proposta' : 'Criar proposta'}
            onCancel={() => {
              setPanel(openProposalId ? 'detail' : 'list');
              setDraft(null);
            }}
            onSubmit={async (values) => {
              if (draft?.id) {
                await runProposal(
                  () => updateGroupGameProposal(draft.id, draft.version, values),
                  'Proposta atualizada.'
                );
                setPanel('detail');
                setDraft(null);
                return;
              }
              await createProposal(values);
            }}
          />
        </SectionCard>
      ) : null}

      {tab === 'propostas' && panel === 'detail' ? (
        <ProposalDetail
          proposal={proposal}
          members={members}
          slots={slots}
          timeZone={timeZone}
          myUserId={myUserId}
          myRole={group.myRole}
          busy={saving}
          onBack={() => {
            setPanel('list');
            onOpenProposal?.(null);
          }}
          onRespond={(response) =>
            runProposal(() => respondToGroupGameProposal(proposal.id, response), 'Resposta registrada.')
          }
          onConfirm={() =>
            runProposal(() => confirmGroupGameProposal(proposal.id, proposal.version), 'Horário confirmado.')
          }
          onCancelProposal={() =>
            runProposal(() => cancelGroupGameProposal(proposal.id, proposal.version), 'Proposta cancelada.')
          }
          onEdit={() => {
            setDraft(proposal);
            setPanel('create');
          }}
          onConvert={() => setPanel('convert')}
          onOpenSession={onOpenSession}
          onShare={async () => {
            const body = proposalShareText(proposal, timeZone, groupProposalHash(group.id, proposal.id));
            const sent = await sendGroupMessage(group.id, body);
            showToast(sent.ok ? 'Compartilhado no chat.' : sent.error?.message || 'Não foi possível enviar.');
          }}
        />
      ) : null}

      {tab === 'propostas' && panel === 'convert' ? (
        <SectionCard title="Criar encontro">
          <p className="text-small" style={{ color: 'var(--text-muted)' }}>
            {proposal ? formatZonedRange(proposal.startsAt, proposal.endsAt, timeZone) : ''}
          </p>
          <ConvertProposalForm
            proposal={proposal}
            members={members}
            busy={saving}
            onCancel={() => setPanel('detail')}
            onSubmit={convertProposal}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
