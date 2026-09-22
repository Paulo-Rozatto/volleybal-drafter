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
3. No projeto Supabase, rode **as quatro** migrations em `supabase/migrations/` (SQL Editor, na ordem dos timestamps, ou `supabase db push`):
   - `20260921120000_cloud_sessions.sql`
   - `20260921140000_cloud_sessions_etapa2.sql`
   - `20260921160000_player_identity_performance.sql`
   - `20260921180000_cloud_groups.sql`
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

Se as etapas 1–3 já estavam aplicadas, rode só `20260921180000_cloud_groups.sql` (já no hospedado). As etapas 5 e 6 (`20260921200000_group_performance.sql`, `20260921220000_cloud_competitions.sql`) **não** devem ir ao remoto até revisão.

O login **não** é exigido para sorteio, elenco Gist, encontros Gist, competições Gist ou desempenho local. A conta vale para **Encontros online**, **Grupos**, **Competições online** e **Migrar dados antigos**.

Convite de encontro: `#/join/CODIGO` (já logado) ou `?join=CODIGO` no redirect do magic link.
Convite de grupo: `#/group/join/CODIGO` ou `?groupJoin=CODIGO`. Os dois códigos ficam em chaves distintas do `sessionStorage` e **não** se misturam.

Estrutura (times, rodadas, elenco, escalação, finalizar) usa `structure_version`. Placar usa `matches.version`, independente. Depois de finalizado, só organizador/admin corrigem placar; limpar continua proibido.

Identidade: `link_player` só vale para jogador que **você criou**. `create_and_link_player` cria e vincula o seu jogador. Jogador de outra pessoa exige `request_player_link_claim`; só o `created_by` aprova ou recusa. O desempenho do perfil cloud lê as partidas via `get_my_performance_matches` e calcula no cliente com a mesma engine dos encontros Gist.

A `anon key` é a chave pública do cliente; a segurança vem do RLS. A `service_role` **nunca** entra no Vite nem no browser.

### Etapa 4 — Grupos

Grupo é uma comunidade (`Vôlei Quinta`, `Turma UFJF`). Não é o elenco da pelada.

Três relações distintas:

- `group_members` — usuários da comunidade
- `session_members` — quem tem acesso àquele encontro
- `session_players` — jogadores que podem jogar naquele encontro

Entrar no grupo **não** copia ninguém para `session_members` nem para `session_players`. Entrar no encontro **não** entra no grupo. Identidade user ↔ player continua a da etapa 3.

`sessions.group_id` é opcional. `null` = encontro avulso (todos os encontros já existentes). Preenchido = encontro daquele grupo. Qualquer `group_member` pode criar um encontro no grupo; só o criador vira `session` owner. Os outros entram pelo convite da sessão. A listagem no grupo só mostra sessões que o RLS atual já deixa o usuário ler.

Papéis do grupo: owner, admin, member. Owner/admin editam nome, rotacionam código, promovem member → admin e rebaixam admin → member. Admin não altera owner. O criador permanece owner nesta etapa (sem transferência). Member pode sair; o último owner não.

Roteiro manual:

1. André cria o grupo, vê-se Owner, copia o código, cria um encontro no grupo.
2. Paulo entra no grupo pelo código, vê-se Membro, **não** vê o encontro até entrar pelo mecanismo da sessão.
3. Paulo entra no encontro pelo código da sessão. Identidade/player dele continua independente da membership do grupo.

### Etapa 5 — Ranking e perfis no grupo

O ranking de um grupo considera partidas de `sessions.group_id = grupo atual` **e**, na etapa 6, `competitions.group_id` do mesmo grupo. Encontros/competições avulsos, outros grupos e Gist ficam de fora.

População do leaderboard: `group_members` com player vinculado (`players.linked_user_id`). Membro sem player aparece como “Jogador ainda não vinculado”. Player vinculado sem partida válida aparece sem posição, em “Ainda sem partidas no grupo”. Convidados (`session_players` / `competition_players` que não são `group_members`) podem entrar no histórico, parceiros e adversários; **não** entram no ranking.

Uma leitura sanitizada:

`get_group_performance_matches(group_id)`

O RPC exige autenticação e membership do grupo (`AUTH_REQUIRED` / `GROUP_NOT_FOUND` / `GROUP_ACCESS_DENIED`). Não concede `SELECT` bruto de `sessions`, não adiciona `session_members`, não devolve `join_code`, email, papéis de sessão nem métricas prontas. O cliente monta o índice com `mapCloudPerformanceMatches` + `buildPlayerPerformanceIndexFromMatches` — o mesmo motor do perfil pessoal. `sourceType` continua `"session"` ou `"competition"`; `originKey = legacy_source_id ?? session_id|competition_id`.

Perfil pessoal cloud segue em `get_my_performance_matches()`. Perfil no grupo é outro contexto: só as partidas daquele `group_id`, inclusive as de outro membro do mesmo grupo.

Migration: `supabase/migrations/20260921200000_group_performance.sql`. **Não aplicar no hospedado até revisão.**

Roteiro manual (depois do `db push` desta migration):

Grupo **Vôlei Quinta** — André, Paulo, Davi.

1. Dois encontros no grupo. Ex.: André+Paulo vs Davi+convidado; André+Davi vs Paulo+convidado. Registrar placares.
2. Ranking contém André/Paulo/Davi; convidado não entra; convidado pode aparecer em histórico/adversários.
3. Perfil do Paulo no grupo mostra só jogos do Vôlei Quinta.
4. Jogos avulsos de Paulo e jogos de outro grupo não aparecem no ranking/perfil do grupo.
5. Outsider não consulta o RPC.
6. Perfil pessoal cloud de Paulo continua no escopo global anterior (`get_my_performance_matches`).

Competições Gist permanecem. A etapa 6 (abaixo) ainda **não** deve ir ao remoto.

### Etapa 6 — Competições cloud

O domínio JS de `Competition` continua a fonte de verdade para formatos (`swiss`, `double_elimination`, `single_elimination`, `round_robin`, `groups`), geração de chave, standings e validade. O PostgreSQL persiste, autoriza, versiona e audita. Não há algoritmo de bracket no SQL.

Cinco relações distintas:

- `group_members` — usuários da comunidade
- `session_members` / `session_players` — acesso e elenco do encontro
- `competition_members` — quem colabora na competição (owner/admin/member/viewer)
- `competition_players` — jogadores no roster da competição

Entrar no grupo **não** vira `competition_member`. Entrar na competição **não** vira `competition_player`. Identidade continua `players.linked_user_id` + claims da etapa 3.

`competitions.group_id` é opcional. `null` = competição avulsa. Preenchido = associada ao grupo. Criar no grupo exige `group_member`; só o criador vira owner. Demais membros do grupo entram pelo código da competição (`#/competition/join/CODIGO` ou `?competitionJoin=CODIGO`, chave `volleyPendingCompetitionJoinCode` — distinta de encontro e grupo).

JS gera o plano → `save_competition_structure` / `replace_competition_teams` / `set_competition_match_score` persistem atomicamente com `expected_structure_version`. Placar usa `competition_matches.version` + `competition_match_events` na mesma transação. Conflito stale **não** gera evento. Partidas de competição **não** reutilizam `public.matches`. Lineups carregam em lote por `competition_id` (sem embed PostgREST).

Performance:

- perfil pessoal: `get_my_performance_matches()` = sessions + competitions em que o player vinculado jogou
- ranking do grupo: `get_group_performance_matches(group_id)` = sessions daquele grupo + competitions daquele grupo
- `sourceType` continua `"session"` | `"competition"` (nunca `cloudCompetition`)
- `originKey` = `legacy_source_id ?? session_id|competition_id`

`legacy_source_id` nas competições prepara a etapa 7. Esta etapa **não** importa Gist, **não** faz dual-write e **não** remove competições locais.

Migration: `supabase/migrations/20260921220000_cloud_competitions.sql`. **Não aplicar no hospedado até revisão** (migration, RLS, RPC de score/estrutura e RPCs de performance).

Realtime (checklist da publication `supabase_realtime`, replica identity full; a migration declara, o apply hospedado espera revisão):

- `competitions`, `competition_members`, `competition_players`
- `competition_stages`, `competition_matches`, `competition_match_players`, `competition_match_events`

Roteiro manual (depois do `db push` desta migration):

1. André cria competição, monta roster, gera estrutura, adiciona Paulo como member.
2. Paulo entra pelo código, registra placar; André recebe Realtime.
3. Viewer bloqueado no placar; member sem estrutura; outsider sem leitura.
4. Score conflict e structure conflict como nas sessões.
5. Perfil pessoal: a competition aparece. Grupo: só a competition com `group_id` daquele grupo. Avulsa não mexe no ranking do grupo.

### Etapa 7 — Migração do legado

Importação **unidirecional** e explícita de Gist/localStorage → Supabase. **Não** é sincronização permanente. **Não** há dual-write. O Gist **não** é apagado, editado nem marcado como migrado. As telas e a persistência legadas continuam até a etapa 8.

Identidade de importação: `sessions.legacy_source_id` e `competitions.legacy_source_id` (texto; UUID legado permanece texto). `already_imported` só vale quando `created_by` é o importador atual; membership (`session_members` / `competition_members`) **não** prova importação — outro usuário, mesmo member, recebe `LEGACY_ID_CONFLICT` sem detalhes da entidade. Reexecutar a mesma entidade pelo dono devolve `already_imported` e **não** atualiza o cloud. Fingerprint SHA-256 do snapshot é auditoria do lote, não identidade. Itens de lote são únicos por batch (`batch_id` + usuário + tipo + legado); lote novo não apaga o relatório do lote anterior.

Players: nome **não** é identidade. Dois “João” continuam dois IDs. Cloud “João” + legado “João” **não** mesclam sozinhos. Mapping explícito do usuário (`legacy_player_mappings`) reutiliza um player cloud ao qual ele tem legitimidade (`created_by` ou `linked_user_id`). Importação **nunca** preenche `linked_user_id`. Convidados continuam sem conta.

Encontros e competições importados nascem **avulsos** (`group_id` nulo). O importador vira owner. Roster vira `session_players` / `competition_players`; **não** copia outros usuários para `session_members` / `competition_members`. As cinco relações continuam distintas.

RPCs específicas (`import_legacy_player`, `import_legacy_session`, `import_legacy_competition`) criam o estado histórico validado em **uma transação por entidade**. Não enfraquecem `save_competition_structure` / `set_match_score` / `set_competition_match_score`. Placar histórico entra com `version = 0` e `updated_by` nulo, **sem** `match_events` / `competition_match_events` falsos. A primeira correção cloud incrementa version e audita normalmente.

UI: `#/migration` (autenticado). Preview/dry-run, resolução de jogadores, progresso retomável, relatório por item. Falha de um item não desfaz os demais. Cancelar para de enviar novos itens; não há botão “desfazer migração”.

`originKey` no motor local passou a ser o id da sessão/competição. Cloud continua `legacy_source_id ?? entity_id`. `dedupePerformanceMatchesByOrigin` evita contar o mesmo encontro duas vezes se legado e cloud importado forem combinados. Métricas continuam no JS.

Migration: `supabase/migrations/20260922000000_legacy_import.sql`. **Não aplicar no hospedado até revisão.** Tabelas de import não entram no realtime.

### Validação hospedada (etapa 3.5)

Circuito já validado no projeto hospedado (Auth, RLS, RPC, Realtime, grupos). As etapas 5, 6 e 7 ainda são só locais — não rode `20260921200000_group_performance.sql`, `20260921220000_cloud_competitions.sql` nem `20260922000000_legacy_import.sql` no SQL Editor até a revisão.

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
