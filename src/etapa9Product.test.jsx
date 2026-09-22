import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AuthPanel from './AuthPanel.jsx';
import BrandLogo from './ui/BrandLogo.jsx';
import EmptyState from './ui/EmptyState.jsx';
import ErrorState from './ui/ErrorState.jsx';
import { BRAND_NAME, BRAND_TAGLINE, documentTitleForView } from './ui/brand.js';
import { translateEntityStatus, translateRole } from './ui/labels.js';

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(srcRoot, '..');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'migration' || entry === 'persistence') continue;
      walk(full, acc);
    } else if (/\.(js|jsx)$/.test(entry) && !entry.endsWith('.test.js') && !entry.endsWith('.test.jsx')) {
      acc.push(full);
    }
  }
  return acc;
}

function read(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

describe('etapa 9: marca e produto PaDre', () => {
  it('mostra PaDre na entrada e não usa branding antigo', () => {
    const html = renderToStaticMarkup(
      <AuthPanel configured ready user={null} />
    );
    expect(html).toContain(BRAND_NAME);
    expect(html).toContain(BRAND_TAGLINE);
    expect(html).toContain('Entrar');
    expect(html).toContain('Enviaremos um link de acesso para seu e-mail.');
    expect(html).not.toMatch(/\bonline\b/i);
    expect(html).not.toContain('Cortada');
    expect(html).not.toContain('Supabase');
    expect(html).not.toContain('magic-link');
    expect(renderToStaticMarkup(<BrandLogo />)).toContain(BRAND_NAME);
  });

  it('menu principal não inclui migration nem online', () => {
    const app = read('App.jsx');
    const shell = read('ui/AppShell.jsx');
    expect(shell).toMatch("id: 'sessions'");
    expect(shell).toMatch("id: 'competitions'");
    expect(shell).toMatch("id: 'groups'");
    expect(shell).toMatch("id: 'profile'");
    expect(shell).toMatch('const PRIMARY');
    expect(shell).not.toMatch("id: 'migration'");
    expect(app).toMatch('Importar dados antigos');
    expect(app).toMatch('#/migration');
    expect(app).toMatch('lazy(() => import(\'./LegacyMigrationView.jsx\'))');
    expect(app).toMatch('lazy(() => import(\'./CloudCompetitionsView.jsx\'))');
    expect(app).not.toMatch(/\bonline\b/);
    expect(app).not.toMatch('Cortada');
    expect(documentTitleForView('sessions')).toBe('Encontros · PaDre');
  });

  it('empty e error/retry padronizados', () => {
    const empty = renderToStaticMarkup(
      <EmptyState title="Você ainda não tem encontros" description="Crie um encontro." actionLabel="Criar primeiro encontro" onAction={() => {}} />
    );
    expect(empty).toContain('Você ainda não tem encontros');
    expect(empty).toContain('Criar primeiro encontro');
    const error = renderToStaticMarkup(
      <ErrorState message="Falha" onRetry={() => {}} onBack={() => {}} backLabel="← Encontros" />
    );
    expect(error).toContain('Tentar novamente');
    expect(error).toContain('← Encontros');
  });

  it('join explica o convite sem expor o código como título técnico', () => {
    expect(read('JoinSessionView.jsx')).toContain('Você recebeu um convite para um encontro');
    expect(read('JoinGroupView.jsx')).toContain('Você recebeu um convite para um grupo');
    expect(read('JoinCompetitionView.jsx')).toContain('Você recebeu um convite para uma competição');
    expect(read('JoinSessionView.jsx')).toMatch('rememberPendingJoinCode');
  });

  it('papéis e status em português', () => {
    expect(translateRole('owner')).toBe('Dono');
    expect(translateRole('admin')).toBe('Administrador');
    expect(translateRole('member')).toBe('Membro');
    expect(translateRole('viewer')).toBe('Visualizador');
    expect(translateEntityStatus('draft')).toBe('Rascunho');
    expect(translateEntityStatus('in_progress')).toBe('Em andamento');
    expect(translateEntityStatus('finished')).toBe('Finalizado');
  });

  it('fluxo normal não importa src/migration/legacy', () => {
    const files = walk(srcRoot).filter((file) => /Cloud|Join|AuthPanel|App\.jsx|ui\//.test(file));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/migration\/legacy\//);
    }
  });

  it('PWA manifesto usa PaDre e o base path do GitHub Pages', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('PaDre');
    expect(manifest.short_name).toBe('PaDre');
    expect(manifest.start_url).toBe('/volleybal-drafter/');
    expect(manifest.scope).toBe('/volleybal-drafter/');
    expect(manifest.display).toBe('standalone');
    const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');
    expect(html).toContain('<title>PaDre</title>');
    expect(html).toContain('lang="pt-BR"');
    const vite = readFileSync(join(repoRoot, 'vite.config.js'), 'utf8');
    expect(vite).toContain("base: '/volleybal-drafter/'");
  });
});
