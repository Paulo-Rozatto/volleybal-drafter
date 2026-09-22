const VARIANTS = {
  primary:
    'bg-[var(--primary)] text-[var(--text-on-primary)] hover:bg-[var(--primary-hover)]',
  secondary:
    'bg-[var(--bg-subtle)] text-[var(--text-main)] border border-[var(--border-color)]',
  ghost: 'bg-transparent text-[var(--text-main)]',
  danger: 'bg-[var(--danger)] text-white hover:opacity-90',
  accent: 'bg-[var(--accent)] text-white',
};

export default function Button({
  type = 'button',
  variant = 'primary',
  className = '',
  disabled,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center min-h-11 px-4 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
