const PALETTE = [
  '#0f766e',
  '#0369a1',
  '#7c3aed',
  '#c2410c',
  '#be185d',
  '#365314',
  '#1e40af',
  '#9a3412',
];

function initialsFrom(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function colorFrom(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export default function Avatar({ name, seed, size = 36, src }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="inline-block rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  const label = initialsFrom(name);
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.36)),
        backgroundColor: colorFrom(seed || name),
      }}
    >
      {label}
    </span>
  );
}
