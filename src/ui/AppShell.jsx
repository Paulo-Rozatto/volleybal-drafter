import { useEffect, useState } from 'react';
import BrandLogo from './BrandLogo.jsx';
import IconButton from './IconButton.jsx';
import OfflineBanner from './OfflineBanner.jsx';
import ToastHost from './ToastHost.jsx';
import { persistTheme, readStoredTheme } from './theme.js';

const PRIMARY = [
  { id: 'sessions', label: 'Encontros' },
  { id: 'competitions', label: 'Competições' },
  { id: 'groups', label: 'Grupos' },
  { id: 'profile', label: 'Perfil' },
];

function navActive(currentView, id) {
  if (id === 'sessions') return currentView === 'sessions' || currentView === 'join';
  if (id === 'competitions') return currentView === 'competitions' || currentView === 'competitionJoin';
  if (id === 'groups') return currentView === 'groups' || currentView === 'groupJoin';
  if (id === 'community') return currentView === 'community' || currentView === 'player';
  return currentView === id;
}

export default function AppShell({
  currentView,
  user,
  onNavigate,
  onOpenMigration,
  onSignOut,
  showPrimaryNav,
  communityEnabled = false,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  const go = (view) => {
    onNavigate?.(view);
    setMenuOpen(false);
  };

  return (
    <div
      className="min-h-screen font-sans"
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
    >
      <div className="padre-shell relative mx-auto min-h-screen flex flex-col md:flex-row">
        {showPrimaryNav ? (
          <aside
            className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:border-r p-4 gap-1"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
            }}
          >
            <button type="button" onClick={() => go('sessions')} className="mb-4 text-left cursor-pointer">
              <BrandLogo size="sm" className="text-[var(--primary)]" />
            </button>
            <nav aria-label="Principal" className="flex flex-col gap-1">
              {PRIMARY.map((item) => {
                const active = navActive(currentView, item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className="min-h-11 px-3 rounded-xl text-left text-small font-bold cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--bg-subtle)' : 'transparent',
                      color: 'var(--text-main)',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            {communityEnabled ? (
              <button
                type="button"
                onClick={() => go('community')}
                aria-current={navActive(currentView, 'community') ? 'page' : undefined}
                className="mt-3 min-h-11 px-3 rounded-xl text-left text-small font-bold cursor-pointer flex items-center justify-between gap-2"
                style={{
                  backgroundColor: navActive(currentView, 'community') ? 'var(--bg-subtle)' : 'transparent',
                  color: 'var(--text-muted)',
                }}
              >
                <span>Comunidade</span>
                <span className="text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  Beta
                </span>
              </button>
            ) : null}
          </aside>
        ) : null}

        <div className="flex-1 flex flex-col min-w-0">
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 border-b"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)',
            }}
          >
            <button
              type="button"
              onClick={() => go('sessions')}
              className="cursor-pointer text-[var(--primary)]"
              aria-label="PaDre, ir para encontros"
            >
              <BrandLogo size="sm" />
            </button>
            <IconButton label={menuOpen ? 'Fechar menu' : 'Abrir menu'} onClick={() => setMenuOpen((open) => !open)}>
              <span aria-hidden="true" className="text-xl leading-none">
                {menuOpen ? '✕' : '☰'}
              </span>
            </IconButton>
          </header>

          <OfflineBanner />

          {menuOpen ? (
            <div
              className="border-b p-3 space-y-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
            >
              {user ? (
                <p className="px-3 py-2 text-caption" style={{ color: 'var(--text-muted)' }}>
                  {user.email}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => go('profile')}
                className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer"
              >
                Perfil
              </button>
              {communityEnabled ? (
                <button
                  type="button"
                  onClick={() => go('community')}
                  aria-current={navActive(currentView, 'community') ? 'page' : undefined}
                  className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer flex items-center justify-between"
                >
                  <span>Comunidade</span>
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Beta
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => go('draft')}
                className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer"
              >
                Sorteio rápido
              </button>
              <button
                type="button"
                onClick={() => go('history')}
                className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer"
              >
                Histórico de sorteios
              </button>
              {user && onOpenMigration ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenMigration();
                    setMenuOpen(false);
                  }}
                  className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer"
                  aria-current={currentView === 'migration' ? 'page' : undefined}
                >
                  Importar dados antigos
                </button>
              ) : null}
              <div className="px-3 py-2">
                <p className="text-caption font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                  Tema
                </p>
                <div className="flex gap-2">
                  {[
                    ['system', 'Sistema'],
                    ['light', 'Claro'],
                    ['dark', 'Escuro'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme(id)}
                      className="flex-1 min-h-11 rounded-xl text-caption font-bold cursor-pointer"
                      style={{
                        backgroundColor: theme === id ? 'var(--primary)' : 'var(--bg-subtle)',
                        color: theme === id ? 'var(--text-on-primary)' : 'var(--text-main)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {user && onSignOut ? (
                <button
                  type="button"
                  onClick={() => {
                    onSignOut();
                    setMenuOpen(false);
                  }}
                  className="w-full min-h-11 px-3 rounded-xl text-left text-small font-semibold cursor-pointer"
                  style={{ color: 'var(--danger)' }}
                >
                  Sair
                </button>
              ) : null}
            </div>
          ) : null}

          <main className="flex-1 p-4 pb-24 md:pb-6 overflow-y-auto space-y-4">{children}</main>

          {showPrimaryNav ? (
            <nav
              aria-label="Principal"
              className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 border-t"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-color)',
                paddingBottom: 'env(safe-area-inset-bottom)',
              }}
            >
              {PRIMARY.map((item) => {
                const active = navActive(currentView, item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className="min-h-14 text-caption font-bold cursor-pointer"
                    style={{ color: active ? 'var(--primary)' : 'var(--text-muted)' }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          ) : null}
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
