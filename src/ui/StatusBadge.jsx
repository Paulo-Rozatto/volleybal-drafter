import { translateEntityStatus } from './labels.js';

const TONE = {
  draft: { background: 'var(--bg-subtle)', color: 'var(--text-muted)' },
  in_progress: { background: 'color-mix(in srgb, var(--primary) 16%, transparent)', color: 'var(--primary)' },
  finished: { background: 'color-mix(in srgb, var(--success) 16%, transparent)', color: 'var(--success)' },
};

export default function StatusBadge({ status }) {
  const tone = TONE[status] ?? TONE.draft;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-caption font-bold"
      style={{ backgroundColor: tone.background, color: tone.color }}
    >
      {translateEntityStatus(status)}
    </span>
  );
}
