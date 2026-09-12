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

## Sorteio Rápido

Cole a lista de confirmados, identifique o elenco, escolha o formato e sorteie times equilibrados. Esse fluxo não grava encontros até você registrar um encontro à parte.
