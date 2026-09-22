export default function PageHeader({ title, action, children }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <h2 className="text-h1">{title}</h2>
        {children}
      </div>
      {action}
    </header>
  );
}
