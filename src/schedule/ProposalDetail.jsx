import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { formatZonedRange, userHasFullWindow } from '../domain/groupAvailability.js';
import { canEditProposal, PROPOSAL_STATUS_LABELS, RSVP_LABELS } from './mappers.js';
import ProposalLocation from './ProposalLocation.jsx';
import { memberDisplayName, timezoneHint } from './labels.js';

function groupByResponse(members, responses) {
  const byUser = new Map(responses.map((item) => [item.userId, item]));
  const buckets = { yes: [], maybe: [], no: [], unanswered: [] };
  for (const member of members) {
    const row = byUser.get(member.userId);
    if (!row) buckets.unanswered.push(member);
    else buckets[row.response]?.push({ ...member, ...row });
  }
  return buckets;
}

export default function ProposalDetail({
  proposal,
  members = [],
  slots = [],
  timeZone,
  myUserId,
  myRole,
  busy = false,
  onRespond,
  onConfirm,
  onCancelProposal,
  onEdit,
  onConvert,
  onShare,
  onOpenSession,
  onBack,
}) {
  if (!proposal) {
    return <EmptyState title="Proposta não encontrada" actionLabel="Voltar" onAction={onBack} />;
  }

  const buckets = groupByResponse(members, proposal.responses ?? []);
  const mine = (proposal.responses ?? []).find((item) => item.userId === myUserId)?.response ?? null;
  const canManage = canEditProposal(proposal, myUserId, myRole);
  const durationMinutes = Math.round(
    (new Date(proposal.endsAt).getTime() - new Date(proposal.startsAt).getTime()) / 60000
  );
  const availableHint =
    myUserId && userHasFullWindow(slots, myUserId, proposal.startsAt, durationMinutes);

  return (
    <section className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        ← Propostas
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-h3">{proposal.title}</h3>
        <span className="text-caption font-bold">{PROPOSAL_STATUS_LABELS[proposal.status]}</span>
      </div>
      <p className="text-small font-semibold">
        {formatZonedRange(proposal.startsAt, proposal.endsAt, timeZone, { weekday: 'long' })}
      </p>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Duração {durationMinutes} min · {timezoneHint(timeZone)}
      </p>
      <ProposalLocation locationName={proposal.locationName} locationDetails={proposal.locationDetails} />
      {proposal.notes ? <p className="text-small">{proposal.notes}</p> : null}
      {availableHint ? (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          Você marcou que está disponível neste horário. Isso não confirma presença neste jogo.
        </p>
      ) : null}

      {proposal.status !== 'cancelled' && !proposal.linkedSessionId ? (
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(RSVP_LABELS).map(([value, label]) => (
            <Button
              key={value}
              variant={mine === value ? 'primary' : 'secondary'}
              disabled={busy}
              aria-pressed={mine === value}
              onClick={() => onRespond?.(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      {[
        ['yes', 'Quem vai'],
        ['maybe', 'Talvez'],
        ['no', 'Não vai'],
        ['unanswered', 'Sem resposta'],
      ].map(([key, title]) => (
        <div key={key}>
          <h4 className="text-small font-bold">
            {title} ({buckets[key].length})
          </h4>
          {buckets[key].length === 0 ? (
            <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
              Ninguém nesta lista.
            </p>
          ) : (
            <ul className="text-small">
              {buckets[key].map((member) => (
                <li key={member.userId}>{memberDisplayName(member)}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {proposal.linkedSessionId ? (
        <div className="space-y-2">
          <p className="text-small font-semibold">Encontro criado</p>
          <Button onClick={() => onOpenSession?.(proposal.linkedSessionId)}>Abrir encontro</Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {onShare ? (
          <Button variant="secondary" disabled={busy} onClick={onShare}>
            Compartilhar no chat
          </Button>
        ) : null}
        {canManage && proposal.status === 'open' ? (
          <Button disabled={busy} onClick={onConfirm}>
            Confirmar horário
          </Button>
        ) : null}
        {canManage && proposal.status === 'confirmed' && !proposal.linkedSessionId ? (
          <Button disabled={busy} onClick={onConvert}>
            Criar encontro
          </Button>
        ) : null}
        {canManage && proposal.status !== 'cancelled' && !proposal.linkedSessionId ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={onEdit}>
              Editar
            </Button>
            <Button variant="danger" disabled={busy} onClick={onCancelProposal}>
              Cancelar proposta
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
