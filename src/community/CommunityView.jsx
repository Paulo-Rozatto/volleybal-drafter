import PageHeader from '../ui/PageHeader.jsx';
import Tabs from '../ui/Tabs.jsx';
import FriendsView from './FriendsView.jsx';
import GlobalStatsView from './GlobalStatsView.jsx';

export default function CommunityView({ section = 'friends', onSection, onOpenPlayer }) {
  const current = section === 'stats' ? 'stats' : 'friends';
  return (
    <div className="space-y-4">
      <PageHeader title="Comunidade">
        <p className="text-caption font-bold" style={{ color: 'var(--text-muted)' }}>
          Beta
        </p>
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Amigos, perfis e estatísticas globais. Não substitui encontros, competições nem grupos.
        </p>
      </PageHeader>
      <Tabs
        label="Comunidade"
        value={current}
        onChange={onSection}
        options={[
          { id: 'friends', label: 'Amigos' },
          { id: 'stats', label: 'Estatísticas' },
        ]}
      />
      {current === 'friends' ? <FriendsView onOpenPlayer={onOpenPlayer} /> : null}
      {current === 'stats' ? <GlobalStatsView onOpenPlayer={onOpenPlayer} /> : null}
    </div>
  );
}
