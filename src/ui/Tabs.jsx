export default function Tabs({ label, value, options, onChange }) {
  return (
    <div
      className="flex gap-1 overflow-x-auto rounded-xl p-1"
      style={{ backgroundColor: 'var(--bg-subtle)' }}
      role="tablist"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(option.id)}
            className="flex-1 min-h-11 min-w-[5.5rem] px-3 rounded-lg text-small font-bold cursor-pointer whitespace-nowrap"
            style={{
              backgroundColor: selected ? 'var(--primary)' : 'transparent',
              color: selected ? 'var(--text-on-primary)' : 'var(--text-muted)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
