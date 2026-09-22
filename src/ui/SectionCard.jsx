export default function SectionCard({ as: Tag = 'section', title, children, className = '' }) {
  return (
    <Tag
      className={`rounded-2xl border p-4 space-y-3 ${className}`.trim()}
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
    >
      {title ? <h3 className="text-h3">{title}</h3> : null}
      {children}
    </Tag>
  );
}
