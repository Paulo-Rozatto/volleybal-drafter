import IconButton from './IconButton.jsx';

export default function ScoreStepper({
  label,
  value,
  onChange,
  disabled = false,
}) {
  const display = value === '' || value == null ? '0' : String(value);
  const numeric = Number.parseInt(String(value || '0'), 10);
  const current = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;

  return (
    <div className="flex items-center gap-2">
      <p className="flex-1 text-small font-semibold leading-snug">{label}</p>
      <IconButton
        label={`Diminuir ${label}`}
        disabled={disabled || current <= 0}
        onClick={() => onChange?.(String(Math.max(0, current - 1)))}
        className="border"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}
      >
        −
      </IconButton>
      <span className="w-10 text-center text-h2 tabular-nums" aria-live="polite">
        {display}
      </span>
      <IconButton
        label={`Aumentar ${label}`}
        disabled={disabled}
        onClick={() => onChange?.(String(current + 1))}
        className="border"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}
      >
        +
      </IconButton>
    </div>
  );
}
