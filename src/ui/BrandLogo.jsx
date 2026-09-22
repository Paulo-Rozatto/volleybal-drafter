import { BRAND_NAME } from './brand.js';

function Mark({ size }) {
  const px = size === 'lg' ? 40 : size === 'sm' ? 24 : 32;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <rect x="7" y="18" width="4.5" height="7" rx="1" fill="#fff" />
      <rect x="13.75" y="13" width="4.5" height="12" rx="1" fill="#fff" />
      <rect x="20.5" y="8" width="4.5" height="17" rx="1" fill="#fff" />
    </svg>
  );
}

export default function BrandLogo({
  size = 'md',
  showWordmark = true,
  className = '',
  wordmarkClassName = '',
}) {
  const wordSize =
    size === 'lg' ? 'text-display' : size === 'sm' ? 'text-h3' : 'text-h2';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <Mark size={size} />
      {showWordmark ? (
        <span className={`font-extrabold tracking-tight ${wordSize} ${wordmarkClassName}`.trim()}>
          {BRAND_NAME}
        </span>
      ) : (
        <span className="sr-only">{BRAND_NAME}</span>
      )}
    </span>
  );
}
