import { formatZonedRange } from '../domain/groupAvailability.js';
import { PROPOSAL_STATUS_LABELS } from './mappers.js';
import ProposalLocation from './ProposalLocation.jsx';

const TONE = {
  open: { background: 'color-mix(in srgb, var(--primary) 16%, transparent)', color: 'var(--primary)' },
  confirmed: { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' },
  cancelled: { background: 'var(--bg-subtle)', color: 'var(--text-muted)' },
};

export default function ProposalCard({ proposal, timeZone, onOpen }) {
  const tone = TONE[proposal.status] ?? TONE.open;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(proposal.id)}
      className="w-full text-left p-4 rounded-2xl border cursor-pointer min-h-11 space-y-2"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold leading-snug">{proposal.title}</p>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-caption font-bold"
          style={{ backgroundColor: tone.background, color: tone.color }}
        >
          {PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status}
        </span>
      </div>
      <p className="text-small" style={{ color: 'var(--text-muted)' }}>
        {formatZonedRange(proposal.startsAt, proposal.endsAt, timeZone, { weekday: 'short' })}
      </p>
      <ProposalLocation locationName={proposal.locationName} locationDetails={proposal.locationDetails} />
      <p className="text-small font-semibold">
        {proposal.counts.yes} vão · {proposal.counts.maybe} talvez
      </p>
    </button>
  );
}
