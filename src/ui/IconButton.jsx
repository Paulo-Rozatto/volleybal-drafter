export default function IconButton({
  label,
  type = 'button',
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center min-h-11 min-w-11 rounded-xl cursor-pointer disabled:opacity-50 ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
