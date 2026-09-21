# Cortada

SPA React para sortear times de vôlei, registrar encontros e sincronizar elenco e placares entre dispositivos.

## Instalação e execução

```bash
npm install
npm run dev
```

Abra:

```text
http://localhost:5173/volleybal-drafter/
```

O caminho `/volleybal-drafter/` é obrigatório (mesmo `base` usado no GitHub Pages). Sem ele a página fica em branco.

## Comandos

```bash
npm test
npm run lint
npm run build
```

## Encontros

O Cortada registra peladas além do Sorteio Rápido.

- Formatos de **2x2** a **6x6**, com quantidade de times definida na criação.
- Encontro pode ser criado **manualmente** (data, formato, nome) ou a partir de um **sorteio automático** de times.
- Times podem ficar **incompletos** ou vazios; o formato só define a capacidade, não exige preenchimento total.
- As rodadas são **todos contra todos**. Time ímpar fica de bye na rodada.
- Cada partida tem **escalação** própria. Dá para emprestar jogador de outro time sem alterar o time-base; o empréstimo aparece na escalação.
- Placar é opcional até a partida ser preenchida. A **finalização** só fica disponível quando as regras do encontro permitem encerrar.

### Schema V2 (resumo)

O documento de encontros usa `schemaVersion: 2`:

- `sessions[]` com `format.teamSize` / `format.teamCount`
- `teams[]` com `members`
- `rounds[]` com `matches[]`
- partidas com `teamAId` / `teamBId`, `lineupA` / `lineupB`, `scoreA` / `scoreB` e `byeTeamId` na rodada

Um Gist ainda em V1 (duplas / `pairs`) é **migrado automaticamente para V2 na leitura**. O App passa a trabalhar só com V2; a gravação no Gist continua manual.

## Cache local

Elenco, histórico de sorteios e encontros ficam no `localStorage` deste navegador. Encontros inválidos no cache não são sobrescritos em silêncio: a edição pede confirmação antes de descartar o cache corrompido.

## Sincronização com Gist

O App lê e grava dois arquivos no Gist:

- `players.json` — elenco
- `game-sessions.json` — encontros V2

O salvamento é **manual**. Não há PATCH automático. O painel mostra quando há **alterações não salvas no Gist**.

### Fluxo recomendado

1. Carregar o Gist.
2. Realizar as alterações.
3. Salvar.
4. Se outro dispositivo tiver gravado no meio do caminho, resolver o conflito **antes** de sobrescrever.

O salvamento compara a revisão remota com a última lida neste dispositivo. Se o Gist mudou, o App bloqueia o PATCH e pede para recarregar. Você escolhe manter os dados locais (e salvar depois) ou substituí-los pelos dados do Gist.

### Truncamento da API

A API do GitHub pode devolver arquivo grande assim:

- `truncated: true`
- `content` parcial
- `raw_url` para o texto completo

O App **nunca interpreta** `content` quando `truncated === true`. Nesse caso ele baixa o arquivo por `raw_url`, só em HTTPS e só em `gist.githubusercontent.com`. A revisão usada no controle de concorrência continua vindo do GET principal do Gist; o download raw não altera a revisão esperada.

Arquivos muito grandes devem, no futuro, ser **arquivados** (encontros antigos fora do documento ativo). O painel mostra o tamanho serializado atual de `game-sessions.json` e avisa a partir de 750 KiB, sem bloquear o salvamento.

### Privacidade

Gist público ou secret **não é armazenamento privado**. Qualquer pessoa com o link pode ler nomes, elenco e placares.

## Encontros online (Supabase)

A etapa 3 adiciona identidade do jogador (criar/vincular/reivindicar) e o desempenho do perfil cloud, reusando a engine JS. Competições, Gist e o ranking global **não** foram migrados.

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave **anon**, nunca `service_role`).
3. No projeto Supabase, rode **as três** migrations em `supabase/migrations/` (SQL Editor, na ordem dos timestamps, ou `supabase db push`):
   - `20260921120000_cloud_sessions.sql`
   - `20260921140000_cloud_sessions_etapa2.sql`
   - `20260921160000_player_identity_performance.sql`
4. Authentication → URL Configuration → Redirect URLs:

```text
http://localhost:5173/volleybal-drafter/
http://localhost:5173/volleybal-drafter/**
http://localhost:5174/volleybal-drafter/
http://localhost:5174/volleybal-drafter/**
https://paulo-rozatto.github.io/volleybal-drafter/
https://paulo-rozatto.github.io/volleybal-drafter/**
```

5. Authentication → Providers → Email: habilite Magic Link.
6. Database → Replication: inclua na publication `supabase_realtime` (replica identity full):
   - `public.matches`
   - `public.sessions`
   - `public.session_members`
   - `public.session_players`
   - `public.teams`
   - `public.team_members`
   - `public.rounds`
   - `public.match_players`
   - `public.match_events`

Se a etapa 1 e a etapa 2 já estavam aplicadas, rode só a migration da etapa 3. Não há backfill de Gist.

O login **não** é exigido para sorteio, elenco Gist, encontros Gist, competições ou desempenho local. A conta vale para **Encontros online**.

Convite: `#/join/CODIGO` (já logado) ou `?join=CODIGO` no redirect do magic link. O hash do Auth substitui `#/join/...`, então o código pendente fica em `sessionStorage` e na query.

Estrutura (times, rodadas, elenco, escalação, finalizar) usa `structure_version`. Placar usa `matches.version`, independente. Depois de finalizado, só organizador/admin corrigem placar; limpar continua proibido.

Identidade: `link_player` só vale para jogador que **você criou**. `create_and_link_player` cria e vincula o seu jogador. Jogador de outra pessoa exige `request_player_link_claim`; só o `created_by` aprova ou recusa. O desempenho do perfil cloud lê as partidas via `get_my_performance_matches` e calcula no cliente com a mesma engine dos encontros Gist.

A `anon key` é a chave pública do cliente; a segurança vem do RLS. A `service_role` **nunca** entra no Vite nem no browser.

### Validação hospedada (etapa 3.5)

Não avance schema de grupos até este circuito passar no projeto hospedado.

1. Preencha `.env` (já copiado de `.env.example`; o arquivo está no `.gitignore`) com a URL e a **anon key** reais. Placeholder do example não conta como configurado.
2. Rode as três migrations no SQL Editor, na ordem dos timestamps.
3. Reinicie `npm run dev`. Se o Vite subir em `5174`, as Redirect URLs acima já cobrem essa porta.
4. **André e Paulo:** Firefox + Chrome, ou dois perfis de navegador. Duas abas do mesmo perfil compartilham o `localStorage` do Supabase e são o mesmo usuário.
5. **Concorrência de placar/estrutura:** duas abas ou dispositivos autenticados com permissão sobre a mesma partida.

Roteiro de aceitação:

- André: magic link → cria/vincula o próprio player (`linked_user_id` preenchido) → cria encontro → adiciona André e Paulo → times → rodadas.
- Paulo (outro perfil): conta → entra pelo código → vê o encontro → não faz mais do que o papel dele → pede claim do player Paulo.
- André aprova o claim.
- Paulo recarrega Meu perfil: o mesmo `player_id`, sem segundo player Paulo; histórico antigo daquele id permanece.
- Paulo grava `21 × 18`; André vê sem refresh; um `match_events`; `matches.version` incrementa.
- Paulo em Meu perfil: jogo, V/D, pontos, modalidade, parceiro, adversários e snapshots.

RLS negativo (UI escondida **não** basta). No Vite em DEV, `window.__paDreSupabase()` devolve o cliente. Há um rascunho em `scripts/etapa35-hosted-probes.js`:

- viewer → `set_match_score`
- member → `replace_session_teams` / `finalize_session`
- usuário de outra sessão → `select` no encontro
- qualquer um → `link_player` de terceiro
- qualquer um → `approve_player_link_claim`

Todos devem falhar no banco.

Concorrência de placar: os dois carregam `version = 0`; A salva `21 × 18` (`expectedVersion = 0` → version 1); B tenta `21 × 19` com `expectedVersion = 0` → `SCORE_VERSION_CONFLICT`, placar permanece `21 × 18`, **sem** novo `match_events`. Só “Tentar substituir” reenvia com `expectedVersion = 1`.

Concorrência de estrutura: dois admins carregam `structure_version = 3`; A reorganiza times → 4; B gera plano com 3 → `STRUCTURE_VERSION_CONFLICT`.

## Sorteio Rápido

Cole a lista de confirmados, identifique o elenco, escolha o formato e sorteie times equilibrados. Esse fluxo não grava encontros até você registrar um encontro à parte.
