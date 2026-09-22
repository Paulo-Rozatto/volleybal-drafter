export const BRAND_NAME = 'PaDre';
export const BRAND_TAGLINE = 'Cada jogo conta.';
export const BRAND_SUBTITLE =
  'Plataforma de Acompanhamento de Disputas, Rankings e Estatísticas';
export const BRAND_PITCH =
  'Organize encontros, competições, rankings e histórico em um só lugar.';
export const BRAND_THEME_STORAGE_KEY = 'padreTheme';

export const PAGE_TITLES = Object.freeze({
  sessions: 'Encontros',
  competitions: 'Competições',
  groups: 'Grupos',
  profile: 'Perfil',
  migration: 'Importar dados antigos',
  join: 'Convite',
  groupJoin: 'Convite de grupo',
  competitionJoin: 'Convite de competição',
  draft: 'Sorteio rápido',
  preview: 'Prévia do sorteio',
  history: 'Histórico de sorteios',
  community: 'Comunidade',
  player: 'Perfil',
});

export function documentTitleForView(view) {
  const page = PAGE_TITLES[view];
  return page ? `${page} · ${BRAND_NAME}` : BRAND_NAME;
}
