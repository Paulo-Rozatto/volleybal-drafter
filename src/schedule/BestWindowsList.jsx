import { formatZonedRange, WINDOW_DURATIONS } from '../domain/groupAvailability.js';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { durationLabel, memberDisplayName } from './labels.js';

export default function BestWindowsList({
  windows = [],
  members = [],
  timeZone,
  durationMinutes,
  onDurationChange,
  onCreate,
}) {
  const memberById = new Map(members.map((member) => [member.userId, member]));
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {WINDOW_DURATIONS.map((duration) => (
          <Button
            key={duration}
            variant={duration === durationMinutes ? 'primary' : 'secondary'}
            onClick={() => onDurationChange?.(duration)}
          >
            {durationLabel(duration)}
          </Button>
        ))}
      </div>
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Horários com mais pessoas disponíveis. Isso não é uma decisão automática do PaDre.
      </p>
      {windows.length === 0 ? (
        <EmptyState
          title="Ainda não há sobreposição"
          description="Quando o grupo marcar disponibilidade, os horários com mais gente aparecem aqui."
        />
      ) : null}
      {windows.map((window) => (
        <article
          key={`${window.start}-${window.durationMinutes}`}
          className="rounded-2xl border p-4 space-y-2"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <p className="font-bold">{formatZonedRange(window.start, window.end, timeZone)}</p>
          <p className="text-small">
            {window.count} de {members.length} disponíveis
          </p>
          <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
            {window.userIds.map((id) => memberDisplayName(memberById.get(id))).join(', ')}
          </p>
          <Button onClick={() => onCreate?.(window)}>Criar proposta</Button>
        </article>
      ))}
    </section>
  );
}
