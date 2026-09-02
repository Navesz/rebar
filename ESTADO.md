# rebar — estado do projeto

> **Leia este arquivo primeiro.** É o ponto de entrada de qualquer sessão nova.
> Medido e reescrito em **30/08/2026** · repo: `C:\Users\leona\OneDrive\Documents\rebar`
>
> **Revisão de 31/08/2026:** o gerador passou a existir e a rodar — §4.11. As seções 4.2,
> 4.3 e 5.1 foram remedidas nesta data porque o gerador mudou o que elas contavam. O que
> não foi remedido em 31/08 continua com a data e o número de 30/08, e está dito onde é.

---

## 0. A regra deste arquivo

**Todo número vem com o comando que o reproduz.** Se o comando não cabe na linha, ele vai
logo abaixo dela. Se não há comando, o número não entra — escreve-se `não medido`.

Isto não é estilo. É a regra 3 do `CLAUDE.md` do alicerce aplicada ao próprio ESTADO: o
rebar acusa os outros de terem decisão que mora onde nenhuma máquina lê, e um ESTADO com
número sem procedência é exatamente isso.

**Este arquivo errou número três vezes nesta semana.** Disse "20 checagens" quando eram
19; publicou um placar tirado de uma régua descalibrada, em que uma pasta vazia empatava
com o rebar; e manteve uma tabela que soma 56 enquanto o texto ao lado dizia 55. A causa é
estrutural e não vai embora: o arquivo é escrito à mão, e os números envelhecem em horas —
nesta sessão o `verificar` foi de 6 para 8 passos e as provas de 15 para 33 casos.
Registrar o defeito vale mais que a aparência de precisão. **Remeça antes de citar.**

Toda medição abaixo foi refeita nesta sessão, com o comando que está ao lado dela. Onde
uma afirmação veio de relato e não de execução, ela está marcada como **não medido**.

---

## 1. O objetivo final

`rebar` é o **alicerce v2**. Repositório novo, não construído sobre o alicerce atual.

A dor que ele existe para resolver, nas palavras do dono:

> _"Todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador,
> esquecendo do shadcn."_

O diagnóstico já estava escrito pelo próprio alicerce: **"decisão que mora onde nenhuma
máquina lê"**.

### Os seis objetivos

1. **Fazer código errado não passar.** Erro que **barra**, não que vira aviso ignorado.
2. **`npm create rebar`** — projeto que nasce com a stack certa e o portão fechado.
3. **Continuar impondo depois do dia 1** — o gerador não sai de cena; fica como MCP e portão.
4. **Descer as regras de nível** — o que é pedido em prosa e caberia num lint, vira lint.
5. **Manter o MCP vivo** — regra mudou, MCP se regenera, e o portão reprova se estiver velho.
6. **Navegável por agente novo** sem ler tudo.

O **nº 5 fechou em 01/09/2026** (§4.12): o MCP virou artefato gerado, e o passo `mcp` do
portão regenera em memória e reprova se o disco divergir. Com ele, o **nº 3 ganhou a
segunda metade** — o portão já ia no projeto gerado, o MCP passou a ir junto por ponteiro.

---

## 2. Os três princípios

Saíram das rodadas de revisão com o revisor externo — `ls docs/RESPOSTA-REVISAO*.md | wc -l`
devolve **8**. Os dois últimos princípios nasceram de **erros cometidos no próprio
documento**, não de teoria.

**1 · Descer de nível, com uma condição.**

> Se uma regra pode descer de prosa para enforcement, ela deve descer — **mas o
> enforcement precisa ser mais confiável do que a regra que substitui.**

**2 · Nada importante mora só em texto.**

> Qualquer regra importante demais para a IA esquecer é importante demais para existir
> apenas como texto.

**3 · Proveniência é de camada, não de fonte.**

> Afirmação verificável precisa de fonte primária **da camada responsável pela propriedade
> afirmada.** Não pule camada.

| Propriedade                       | Dono          |
| --------------------------------- | ------------- |
| MVCC, `SKIP LOCKED`, `RESET ROLE` | PostgreSQL    |
| Sync por query, `onConnect`       | node-postgres |
| Serialização, mapa de status      | oRPC          |
| SQL gerado                        | Kysely        |

Formato obrigatório de citação em ADR: **`Claim` · `Owner` · `Evidence` · `Assumptions`**,
e cada linha de `Assumptions` vira asserção no fitness test.

---

## 3. Decisões travadas

| Decisão            | Escolha                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Natureza           | Gera **e** fica vigiando                                                                      |
| Alvo               | Presets `site` / `app` / `api`                                                                |
| Dureza             | Bloqueia commit **e** CI                                                                      |
| Banco              | **Postgres.** SQL Server exige licença, e não há migração — o backend do herz nunca existiu   |
| Contrato           | **oRPC 1.15.0**, não ts-rest (ADR 0011 do prumo supersedeu)                                   |
| Componentes        | **shadcn sobre `@base-ui/react`**, style `base-nova`. **Não é Radix**                         |
| Interface          | Aproveitar a do herz — animação por `tw-animate-css` + data-attributes, sem `@keyframes`      |
| Linter             | oxlint rápido + ESLint pequeno para regras próprias                                           |
| Ordem              | **Consumidor antes do gerador** — checar o que existe antes de gerar o próximo                |
| Postura do checker | **Só reporta.** Nunca escreve em repositório nenhum                                           |

### As três decisões travadas em 30/08

**Prettier é a única dependência do repositório.**

```bash
cat package.json    # devDependencies: { "prettier": "3.9.6" } — uma entrada
```

A fronteira é deliberada: `ferramental/rebar-check/index.mjs` continua importando só
built-ins, então `npx github:Navesz/rebar` roda sem instalar nada. Zero dependência é
propriedade do que **confere**, não do que se confere.

As duas alternativas foram descartadas com motivo: aceitar o 90% deixaria o `verificar`
vermelho para sempre, e portão que nunca fica verde é portão que se aprende a ignorar;
estreitar a regra para dispensar repositório sem dependência seria abrir exceção para si
mesmo na única régua que o projeto entrega.

**Coautoria de IA vira allowlist de humanos, não enumeração de agentes.**

```bash
git ls-files .rebar-coautores              # rastreado — se não estiver, o checker o ignora
grep -vE '^\s*#|^\s*$' .rebar-coautores    # 1 identidade humana; o resto é comentário
```

A política era uma lista de 9 agentes de IA, e o ataque de 30/08 furou os dois lugares
onde ela morava (§10, linhas 10 e 11). Agora o arquivo é `.rebar-coautores`, na raiz, com
identidades **humanas** aceitas; qualquer trailer `Co-authored-by:` fora da lista reprova.
Fica na raiz e não em `ferramental/` porque o `rebar-check` roda contra repositório de
terceiro, e terceiro não tem `ferramental/`. Mesma família do `.rebarignore`.

**O repositório é público, em `https://github.com/Navesz/rebar`.** Criado, e **vazio**.

```bash
git remote -v         # origin  https://github.com/Navesz/rebar.git
git ls-remote origin  # exit 0, e ZERO refs — nada foi empurrado
```

---

## 4. O que está FEITO

Dividido em **PROVADO** — tem teste que roda, e que rodei agora — e **EXISTE** — está no
disco, e ninguém o exercita.

### 4.1 PROVADO · Domínio de privilégio de banco — 16 de 16

```bash
cd dominios/privilegio-de-banco && npm test
# tests 16 · suites 0 · pass 16 · fail 0 · exit 0
# (o duration_ms varia a cada execução — o que vale é 16/16 e o exit 0)
```

Contra PostgreSQL 17.2 **real**, não mock. Três identidades: `db_owner` (migrations) ·
`app` (NOLOGIN, DML) · `app_login` (LOGIN, **NOINHERIT**, zero privilégio de aplicação).

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;   -- PG 16+
```

`INHERIT FALSE` é a peça: `RESET ROLE` cai em `app_login` sem nada → **falha fechado**.

**Achado que só o código encontrou** — nem a revisão humana nem seis agentes pegaram:

> `onConnect` é barreira por conexão **FÍSICA**, não por checkout.

```
checkout          current_user = app
RESET ROLE        current_user = app_login
release → pool
próximo checkout  current_user = app_login   ← onConnect não rodou de novo
```

Aqui falha fechado. Num desenho com `session_user` privilegiado — **o estado atual do
prumo** — falharia **aberto**.

**Conserto medido:** `SET LOCAL ROLE app` como primeira instrução da transação, no
`UnitOfWork`. Dois dos 16 testes são exatamente esse par, e saíram verdes nesta medição:

```
✔ ACHADO · onConnect é barreira por conexão FÍSICA — RESET ROLE sobrevive ao release
✔ CONSERTO · SET LOCAL ROLE no UnitOfWork cura a conexão envenenada e reverte sozinho
```

Um terceiro documenta a fronteira que continua aberta:

```
✔ RLS · ACHADO CONHECIDO: o GUC de tenant é USERSET — app troca o próprio contexto
```

### 4.2 PROVADO · `rebar-check` — 21 checagens, zero dependência

_Remedido em 31/08/2026._ `ferramental/rebar-check/index.mjs`. Roda em qualquer
repositório, **nunca escreve**.

```bash
wc -l ferramental/rebar-check/index.mjs                                  # 2206
grep -c "classe: *'determinística'" ferramental/rebar-check/index.mjs    # 17
grep -c "classe: *'heurística'"     ferramental/rebar-check/index.mjs    # 5
```

O grep de determinística devolve **17 e as regras são 16**: a linha 626 é o comentário que
explica a distinção, não uma regra. **16 determinísticas + 5 heurísticas = 21.** Conferido
também em tempo de execução, que é o número que vale:

```bash
node ferramental/rebar-check/index.mjs --json . | grep -c '"classe": "determinística"'   # 16
node ferramental/rebar-check/index.mjs --json . | grep -c '"classe": "heurística"'       # 5
```

Determinísticas, e derrubam o exit code: `editorconfig`, `dependabot`, `ci`, `ci-gateia`,
`testes`, `typecheck`, `formatter`, `env-example`, `licenca`, `readme`, `notice`,
`coautoria-ia`, `identidade-git`, `ui-falso`, `schema-orfao`,
`conteudo-fora-do-codigo`, `telefone`.

Heurísticas, e só informam: `shadcn-completo`, `url-producao`, `hex-cru`, `idioma-unico`.

`telefone` subiu de heurística a determinística em 2026-08-30, com o número que a promoveu
escrito na própria regra: 1 verdadeiro e 0 falsos em 417 arquivos de código medidos.
`url-producao` NÃO subiu, e o porquê também está lá — 6 acusações verdadeiras, das quais só
2 são o defeito que o nome da regra promete.

A separação é medida, e o motivo está escrito em `index.mjs:466-470`: a regra de cor
literal ingênua deu 7 ocorrências e zero verdadeiros positivos no herz — cinco eram
comentários documentando a própria regra.

**O rebar na própria régua**, medido em 31/08/2026 com `novo/` ainda **não rastreado**:

```bash
node ferramental/rebar-check/index.mjs .
# 11 de 11 · 5 não se aplica · exit 0
# 227 arquivo(s) de caso de prova, fora da avaliação
# 2 arquivo(s) de código fora das regras de conteúdo por serem teste
```

Os 5 que não se aplicam: `ci-gateia` (o `package.json` não tem script de lint, typecheck
nem test), `typecheck` (não tem TypeScript), `env-example` (não lê variável de ambiente do
projeto — `NO_COLOR` e `CI` são do ambiente), `ui-falso` (não tem `components/ui/`) e
`schema-orfao` (nenhum `.schema.json`).

**A nota conta só as determinísticas.** `11 de 11` é sobre as 16 determinísticas menos as 5
que não se aplicam. As 5 heurísticas ficam fora do denominador e aparecem como aviso.

**Com `novo/` rastreado — o estado em que o dono vai commitar — a nota é OUTRA, e sobe.**
A régua lê `git ls-files`: hoje ela não enxerga uma linha do gerador. Para medir o que vai
acontecer sem tocar no `.git` deste repositório, montei um espelho da árvore de trabalho
num `os.tmpdir()`, com `git init` próprio e tudo commitado:

```bash
# espelho: cpSync da árvore sem .git nem node_modules → git init → git add -A → commit
node ferramental/rebar-check/index.mjs "$ESPELHO"
# 318 arquivos rastreados · 24 em novo/
# 12 de 12 · 4 não se aplica · exit 0
# 20 arquivo(s) de modelo do gerador, fora da avaliação · novo/portao/arquivos/, novo/site/blocos/
```

`env-example` sai do N/A e passa a **PASSAR**: o gerador lê `GIT_AUTHOR_NAME` e
`GIT_AUTHOR_EMAIL` como segunda fonte da identidade do dono, e as duas estão documentadas
no `.env.example`. A régua ficou mais exercida, não menos.

**O que o gerador quebrou no caminho, e o conserto.** Na primeira medição do espelho o
resultado era **11 de 13, exit 1**:

| regra | sem o conserto | por quê |
| --- | --- | --- |
| `typecheck` | ✗ nenhum `package.json` rastreado tem script typecheck | os 5 `.tsx`/`.ts` de `novo/site/blocos/` |
| `env-example` | ✗ não documentadas: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `novo/index.mjs` |
| `idioma-unico` | ⚠ comentários em pt (21) e en (3) | 3 comentários em português citando `User-Agent`, `<input type="file">`, `cat-file --batch` |

É o **"material de prova não é produto"** de volta, um andar acima: `novo/site/blocos/` e
`novo/portao/arquivos/` são arquivos que o gerador **copia** para dentro do projeto criado.
Não são compilados aqui, não têm `tsconfig` aqui. A saída é a mesma que já existia para os
casos de prova, com a mesma disciplina: fechadura dupla e contagem impressa.

- **Fechadura 1** — o prefixo tem de ser **exatamente** uma das raízes literais
  (`RAIZES_DE_MODELO`), não "começa com", não "qualquer pasta chamada blocos".
- **Fechadura 2** — tem de existir um `modelo.json` rastreado, com `para` e `porque`.
- **Contagem impressa** — a linha `20 arquivo(s) de modelo do gerador, fora da avaliação`
  sai sempre, nomeando as raízes. Exclusão que não se vê é exclusão que ninguém confere.

Nada foi afrouxado: o `env-example` virou documentação de verdade, e os modelos continuam
sendo checados **onde caem** — o passo 5 do gerador roda esta mesma régua dentro do projeto
gerado, com `tsconfig.json` e `package.json` do Next em volta. Os dois casos de prova novos
travam as duas fechaduras (§4.3).

O `idioma-unico` era falso positivo da própria heurística: ela testava o idioma em cima do
texto do comentário **inteiro**, crases e tudo, então um comentário em português que cita
um identificador em inglês contava como comentário em inglês. Passou a descartar o trecho
entre crases antes do teste. Medido no espelho: `en` de **3 para 0**, e os três eram
`index.mjs`, `varrer-segredo.mjs` e `novo/index.mjs`, todos com prosa em português. O caso
de prova `idioma-unico` não tem uma crase e não muda por causa disto.

### 4.3 PROVADO · As provas — 50 casos, 21 de 21 regras

_Remedido em 31/08/2026._

```bash
npm run provar
# 50 de 50 caso(s) bateram
# 21 de 21 regras com prova
# exit 0

ls ferramental/rebar-check/provas/casos | wc -l    # 50
```

Dos 50, **dois são de 31/08 e travam a exclusão de modelo** descrita na §4.2:

```bash
node ferramental/rebar-check/provas/provar.mjs typecheck
# ✓ typecheck                      aprovar passou · reprovar reprovou
# ✓ typecheck__modelo-do-gerador   aprovar na     · reprovar reprovou
# ✓ typecheck__modelo-fora-da-raiz aprovar na     · reprovar reprovou
# ✓ typecheck__nao-se-aplica       aprovar na     · reprovar na
# ✓ typecheck__nome-em-portugues   aprovar passou · reprovar reprovou
# 5 de 5 caso(s) bateram
```

`__modelo-do-gerador` prova o mecanismo: a mesma árvore com e sem o `modelo.json` na raiz.
`__modelo-fora-da-raiz` prova a **fechadura**: o mesmo marcador um nível abaixo,
em `novo/site/blocos/app/`, tem de ser recusado e a árvore continuar avaliada. Sem esse
segundo caso, transformar a exclusão num bypass genérico passaria despercebido.

O caminho é `ferramental/rebar-check/provas/casos/`, **não** `provas/casos/` na raiz.

Toda regra tem caso, determinística e heurística. A caça a falso positivo de 2026-08-30
acrescentou 13 casos e não sobrou buraco: `telefone`, `url-producao`, `idioma-unico` e a
regra nova `conteudo-fora-do-codigo` eram os quatro que faltavam.

**O formato das provas mudou, e a mudança é o conserto de um furo.** O runner lê agora o
`estado` que a regra emite no `--json`, e não o exit code. O motivo está em
`ferramental/rebar-check/provas/provar.mjs:74-95`: o `index.mjs` colapsa `passou` e `na` no
mesmo exit 0, então nenhum ramo "não se aplica" podia ser travado. É por isso que existem
casos com sufixo `__nao-se-aplica`. O mesmo comentário registra que `quebrou` nunca pode
ser esperado — crash é defeito do instrumento, não resultado dele.

### 4.4 PROVADO · `verificar` — 8 de 8 passos

```bash
npm run verificar
# VERIFICAR — APROVADO  8 de 8 passos · 15.7 s
# ✓ higiene · hooks · sintaxe · formato · elos · segredo · provas · auto
# exit 0

grep -c "^\s*nome: '" verificar.config.mjs    # 8
```

A duração varia de máquina e de cache: em 31/08/2026, com 50 casos de prova, duas
execuções deram **13,5 s** e **15,7 s**, contra **51,9 s com 47 casos** em 30/08. A causa
provável é a paralelização das fixtures no passo `provas`, mas **eu não cronometrei o passo
isolado** nesta sessão — o que medi foi o total, com o comando acima.

_Remedido em 31/08/2026 — os dois parágrafos abaixo são de 30/08 e continuam valendo._

Os dois primeiros passos são novos nesta sessão e conferem o **portão**, não o conteúdo:
`higiene` (árvore limpa, índice sem `skip-worktree`) e `hooks` (`core.hooksPath` aponta
para o lugar certo e os dois hooks estão lá).

O `higiene` avisa sem reprovar quando a árvore está suja, e avisou nesta medição:
`⚠ árvore com 1 alteração(ões) não commitada(s) — APROVADO não quer dizer árvore limpa`.
A alteração era este próprio arquivo.

Deliberadamente sem as duas portas destrancadas do original do alicerce: não existe campo
`opcional` — `verificar.mjs` recusa a chave com exit 2 — e `--passo=` imprime PARCIAL e
sai 3, nunca 0.

### 4.5 PROVADO · Hooks — instalados e ativos

```bash
git config --get core.hooksPath  # ferramental/hooks
git ls-files ferramental/hooks   # checar-mensagem.mjs · commit-msg · instalar.mjs · pre-commit
```

`pre-commit` varre segredo no índice e checa coautoria. `commit-msg` é novo e não existia
no alicerce: o `rebar-check` lê `git log` e não enxerga o commit em curso, então ele
impedia o trailer de **ficar**, não de **entrar**.

Isto era, até esta sessão, o "próximo passo" deste documento. Já foi feito.

### 4.6 PROVADO · Os três portes do alicerce

| Porte                        | Prova de que roda                                        |
| ---------------------------- | -------------------------------------------------------- |
| `segredo/varrer-segredo.mjs` | passo `segredo` do `npm run verificar`, e o `pre-commit`  |
| `elos/verificar-elos.mjs`    | execução direta, abaixo                                   |
| `hooks/`                     | `git config --get core.hooksPath` → `ferramental/hooks`   |

```bash
node ferramental/elos/verificar-elos.mjs
# [elos] 45 arquivos, nenhum link relativo quebrado. · exit 0
```

O `varrer-segredo.mjs` recebeu sete consertos documentados no próprio cabeçalho; os dois
mais caros estão na §10, linhas 8 e 9.

### 4.7 EXISTE, e ninguém exercita

| Item                              | Estado                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.github/workflows/verificar.yml` | 2.163 bytes, matriz windows-latest + ubuntu-latest. **Nunca executou** — o remoto está vazio      |
| `rebar-backup-20260825/`          | Existe, e **não é repositório git** — é cópia solta de arquivos, sem `.git`                       |

```bash
ls -l .github/workflows/verificar.yml    # 2163 bytes
ls -d ../rebar-backup-20260825/.git      # No such file or directory
```

### 4.8 O placar — 19 repositórios da máquina

São **19** repositórios git, não 12. O ESTADO anterior deixou 7 de fora.

```bash
# A PARTIR DE Documents/, nao da raiz do rebar — onde o mesmo comando devolve 1.
# Todo comando deste documento roda da raiz do rebar, MENOS estes dois.
cd /c/Users/leona/OneDrive/Documents
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sort | wc -l    # 19
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sed "s|/[.]git$||" \n  | xargs node rebar/ferramental/rebar-check/index.mjs --json
```

O `--json` aceita vários diretórios de uma vez e devolve um array. A coluna `Nota` é o
campo `nota` que a própria ferramenta emite, repo a repo, e o denominador é o número de
regras **determinísticas aplicáveis** naquele repositório.

| Repo                               | Nota     | Aplicáveis | N/A | Avisos |
| ---------------------------------- | -------- | ---------- | --- | ------ |
| **rebar (ele mesmo)**              | **100%** | 10/10      | 4   | 0      |
| prumo                              | 85%      | 11/13      | 1   | 2      |
| ducado                             | 73%      | 8/11       | 3   | 1      |
| Xthird/tools/obsidian-second-brain | 67%      | 4/6        | 8   | 0      |
| openkartline                       | 62%      | 8/13       | 1   | 2      |
| vectra-painel                      | 50%      | 5/10       | 4   | 0      |
| decima-edicoes                     | 42%      | 5/12       | 2   | 2      |
| LinhaK                             | 36%      | 4/11       | 3   | 0      |
| openkartline-notes                 | 33%      | 2/6        | 8   | 0      |
| VectraB-Lab                        | 33%      | 2/6        | 8   | 0      |
| Xthird/sites/constellation         | 33%      | 4/12       | 2   | 1      |
| Galegos                            | 27%      | 3/11       | 3   | 3      |
| alicerce                           | 20%      | 2/10       | 4   | 0      |
| navesz.github.io                   | 20%      | 2/10       | 4   | 2      |
| Pedro/hug-brasil-propostas         | 17%      | 2/12       | 2   | 2      |
| Xthird/sites/navesz-profile        | 17%      | 1/6        | 8   | 0      |
| Readme                             | 13%      | 1/8        | 6   | 2      |
| Xthird/sites/elssom-climatic       | **0%**   | 0/6        | 8   | 1      |
| Pedro                              | **0%**   | 0/4        | 10  | 0      |

**Agregado: 74 de 177 checagens aplicáveis passam — 41,8%.** N/A somados: 89. Avisos
somados: 18.

A conta fecha com a tabela: somando a coluna `Aplicáveis` dá 74 no numerador e 177 no
denominador; 74 ÷ 177 = 0,4180. **Esta soma foi conferida somando a coluna**, que é
exatamente a verificação que faltava na versão anterior — onde a tabela dava 56 e o texto
ao lado dizia 55.

**Mediana: 33%.** Os 19 valores ordenados são
`0, 0, 13, 17, 17, 20, 20, 27, 33, 33, 33, 36, 42, 50, 62, 67, 73, 85, 100`; o décimo é 33.

**Teto: 100%, o rebar, e ele é o único.** Fora da própria ferramenta o teto é **85% no
prumo** — não 69%, como este arquivo publicava.

**Piso: 0%, empate entre `Pedro` e `Xthird/sites/elssom-climatic`.** Os dois estavam fora
da lista antiga, e por isso o piso publicado (17%, `hug-brasil-propostas`) estava errado.
Ressalva honesta: o `Pedro` tem 0 commits, então o 0% dele mede uma pasta praticamente
vazia — é o piso aritmético. O pior repositório de verdade é o `elssom-climatic`, que tem
5 commits e mesmo assim não passa em nenhuma das 6 checagens aplicáveis.

**CI que alcança a verificação que o próprio repositório declara: quatro.** `prumo`,
`openkartline`, `decima-edicoes` e `Xthird/sites/constellation`. O `constellation` ficava
de fora porque só se olhava 12 repositórios.

```bash
# do mesmo --json, campo `estado` da regra ci-gateia, repo a repo:
# passou 4 · reprovou 1 (ducado, "o CI não alcança: lint") · na 14
```

Os 14 `na` se separam em dois motivos: **oito não têm CI nenhum** (`Galegos`, `LinhaK`,
`Pedro`, `Pedro/hug-brasil-propostas`, `VectraB-Lab`, `Xthird/sites/elssom-climatic`,
`openkartline-notes`, `vectra-painel`) e **seis têm CI e não têm script de lint, typecheck
ou teste para ele alcançar** (`rebar`, `Readme`, `alicerce`, `navesz.github.io`,
`Xthird/sites/navesz-profile`, `Xthird/tools/obsidian-second-brain`). O próprio rebar está
no segundo grupo. 4 + 1 + 8 + 6 = 19.

> ⚠️ **A régua foi recalibrada em 30/08 e número velho não é comparável com número novo.**
> A tabela anterior saía de uma régua em que `null` queria dizer duas coisas ao mesmo
> tempo — "passou" e "não havia o que checar". Consequência medida, e registrada em
> `ferramental/rebar-check/index.mjs:45-51`: uma pasta vazia com um `.git/` vazio tirava 8
> de 14 e empatava com o rebar. O nada não conforma. Três consertos entraram juntos: o N/A
> saiu do **denominador** (por isso a nota é percentual e o denominador varia por
> repositório), o crash do git virou erro explícito em vez de aprovação silenciosa, e a
> classe de falso positivo descrita no fim da §10 caiu. **Não subtraia um número do outro.**

### 4.9 Tamanho do repositório

```bash
git ls-files | grep -v '^ferramental/rebar-check/provas/casos/' | wc -l    # 44
```

| Medida                                                           | Valor                                             |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| Arquivos rastreados, fora os casos de prova                      | 44                                                |
| Linhas de código não vazias (.mjs .cjs .js .ts .json .yml .yaml) | 5.957                                             |
| Linhas de prosa não vazias (.md .txt)                            | 3.071                                             |
| Razão prosa/código                                               | 0,52 — ou 1,94 linha de código por linha de prosa |
| Commits                                                          | 13                                                |
| Commits com trailer `Co-Authored-By`                             | 0                                                 |

```bash
git ls-files | grep -v '^ferramental/rebar-check/provas/casos/' \
  | grep -E '\.(mjs|cjs|js|ts|json|yml|yaml)$' | xargs grep -chv '^[[:space:]]*$' \
  | awk '{s+=$1}END{print s}'                                  # 5957
# a mesma linha com  \.(md|txt)$  no lugar da lista de extensões:   3071
git rev-list --all --count                                     # 13
git log --all --format='%B' | grep -icE 'Co-Authored-By:'      # 0
```

O zero é mais forte do que a política exige: não há trailer `Co-Authored-By` nenhum no
histórico, nem de IA nem de humano.

**A contagem de prosa inclui este arquivo**, então ela muda a cada edição do ESTADO. O
valor acima foi medido com a versão que você está lendo já no disco.

### 4.10 Documentos

```bash
wc -l docs/*.md
```

| Arquivo                     | Linhas                     | O quê                                                        |
| --------------------------- | -------------------------- | ------------------------------------------------------------ |
| `docs/PLANO.md`             | 912                        | Painel de decisões, forense dos seis sites, taxonomia N0–N7   |
| `docs/STACK.md`             | 899                        | v1.2, com histórico de 0.1 a 1.2 (não "~780 linhas")          |
| `docs/REVISAO-AGENTES.md`   | 528                        | Revisão por 6 agentes                                         |
| `docs/RESPOSTA-REVISAO*.md` | 1.235 no total, 8 arquivos | As 8 rodadas com o revisor externo                            |

**Uma referência de seção interna continua quebrada:** `docs/PLANO.md:892` aponta para
`§2.3`, e a série 2.x do documento vai de `2.1` direto para o `§3`.

```bash
grep -n '§2\.3' docs/PLANO.md
grep -nE '^#+ (2|3)(\.[0-9]+)*[ .]' docs/PLANO.md
# 74:# 2. Contexto · 85:## 2.1 Decisões travadas · 101:# 3. … — não há 2.2 nem 2.3
```

Pelo assunto — o preset `site` ser o pior servido — o alvo pretendido era provavelmente a
`§3.3 O ponto cego do alicerce é onde os projetos do dono vivem`. **Não corrigi: a tarefa
desta sessão é só o ESTADO.md.** As outras ocorrências de `§N.N` que um grep cru levanta
foram conferidas e não são quebra: a `§12.9` já virou auto-documentação, os `§44/68/86` da
REVISAO-AGENTES são ponteiro para linha e não para seção, e as `§9.27.2`/`§13.3.2` são
citação da documentação do PostgreSQL.

### 4.11 PROVADO · O gerador — `rebar novo`, rodado de ponta a ponta

_Medido em 31/08/2026. Duas execuções completas, com rede, em `os.tmpdir()`._

`novo/index.mjs` (405 linhas) · `novo/portao/aplicar.mjs` (391) · `novo/site/aplicar.mjs`
(135) · `novo/site/og.mjs` (227) · 24 arquivos no total, dos quais 20 são modelo.

```bash
wc -l novo/index.mjs novo/portao/aplicar.mjs novo/site/aplicar.mjs novo/site/og.mjs
# 1158 total
find novo -type f | wc -l     # 24
```

#### Como o `npx` chega no gerador

O `bin` do `package.json` tinha um só comando e o checker não conhecia subcomando: `npx
github:Navesz/rebar novo meu-site` tratava `novo` como caminho a auditar e saía **2**.
A correção é despacho dentro do `index.mjs`, e não um segundo `bin`, porque é assim que o
npx resolve: ele executa o bin com o **nome do pacote** e entrega `novo` como `argv[0]`.
O `bin` extra (`rebar-novo`) existe como forma inequívoca, mas só é alcançável por
`npx -p github:Navesz/rebar rebar-novo …`, que ninguém digita.

O despacho vem **antes** do parse de opções (senão a linha de comando do gerador viraria
"opção desconhecida") e o `import` é **dinâmico** (senão o caminho quente, `npx
github:Navesz/rebar .` em CI, pagaria por o gerador existir).

Provado nos dois caminhos. O `github:` de verdade, contra o remoto público:

```bash
cd $(mktemp -d) && git init -q && git add -A && git commit -q -m t
npx -y github:Navesz/rebar .     # placar impresso · exit 1 (repo vazio, é o esperado)
```

E o caminho do gerador, contra um clone git local da árvore desta sessão — mesmo
instalador, mesma resolução de `bin`, sem depender de eu ter feito push:

```bash
npx -y "git+file:///$ESPELHO" .                              # o checker, exit 1
npx -y "git+file:///$ESPELHO" novo padaria-do-ze padaria-do-ze.com.br
# rebar: subcomando "novo" → gerador (para auditar a pasta "novo", use ./novo)
```

`npm pack` **não** serve como prova aqui: ele recusa este pacote com "Invalid package, must
have name and version", porque o `package.json` não tem `version`. O instalador de git do
npm não exige `version` — foi por isso que o `npx github:` sempre funcionou apesar disso.

#### Execução 1 — `padaria-do-ze`, sem identidade de git na máquina

```
▸ 2/6  scaffold pelo shadcn (Next 16 · base-nova · @base-ui/react)
  npx resolvido: C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js
▸ 3/6  preset site: 13 arquivo(s) · domínio padaria-do-ze.com.br  + 17 do portão
▸ 4/6  modo 100755 … .githooks/commit-msg · .githooks/pre-commit
       Hooks instalados: core.hooksPath = .githooks
       primeiro commit: NÃO FEITO
▸ 5/6  12 de 12 · 4 não se aplica
  AVISOS: git sem user.email nesta máquina — o primeiro commit NÃO foi feito.
  régua: exit 0 — passou      gerador: exit 1
```

**Não é defeito do gerador, é a máquina** — e é a checagem funcionando:

```bash
git config --global -l
# fatal: unable to read config file 'C:/Users/leona/.gitconfig': No such file or directory
```

Esta máquina não tem `.gitconfig` global; a identidade do rebar mora no `.git/config` do
próprio repositório. O gerador **se recusa a inventar um autor**: avisa, não commita, e sai
1 mesmo com a régua verde. `coautoria-ia` e `identidade-git` viram N/A por não haver
commit, e a nota cai de 14 para 12 no denominador — 12 de 12, não 12 de 14.

#### Execução 2 — `linhak-motos`, pela segunda fonte de identidade

```bash
GIT_AUTHOR_NAME="…" GIT_AUTHOR_EMAIL="…" npx -y "git+file:///$ESPELHO" novo linhak-motos linhak.com.br
```

```
▸ 4/6  primeiro commit: feito
▸ 5/6  rebar-check · linhak-motos
  ✓ editorconfig ✓ dependabot ✓ ci ✓ ci-gateia ✓ testes ✓ typecheck ✓ formatter
  – env-example  ✓ licenca ✓ readme ✓ notice ✓ coautoria-ia ✓ identidade-git
  ✓ ui-falso     – schema-orfao ✓ telefone
  14 de 14 · 2 não se aplica
  régua: exit 0 — passou      gerador: exit 0 — projeto completo
```

Conferido também com o checker do checkout, fora do gerador:

```bash
node ferramental/rebar-check/index.mjs "$TMP/linhak-motos"    # 14 de 14 · exit 0
```

#### O projeto gerado passa no próprio portão

```bash
cd "$TMP/linhak-motos" && npm run verificar     # lint && typecheck && test && build
# ℹ tests 6 · pass 6 · fail 0
# ✓ Compiled successfully in 12.3s · Finished TypeScript in 2.8s
# ○  (Static)  prerendered as static content   — 5 rotas
# exit 0
```

#### O build estático e o `og:image`

```bash
cd "$TMP/padaria-do-ze" && npx next build       # exit 0
# ┌ ○ /  ├ ○ /_not-found  ├ ○ /manifest.webmanifest  ├ ○ /robots.txt  └ ○ /sitemap.xml
# ○  (Static)  prerendered as static content

grep -o '<meta property="og:[^>]*>' out/index.html
# og:title · og:description · og:url · og:site_name · og:locale
# og:image  content="https://padaria-do-ze.com.br/og.png"
# og:image:width 1200 · og:image:height 630 · og:image:alt · og:type
```

`out/index.html` tem 15.255 bytes; `out/og.png`, 5.720 — gerado só com `node:zlib`, sem
dependência. O `wa.me` sai **com destinatário**:
`https://wa.me/5500000000000?text=Ola!%20Vim%20pelo%20site…`

#### Conteúdo quebrado de propósito — 5 mutações, 5 builds exit 1

É a §12.3 do plano exercida: identidade do negócio é **conteúdo validado no build**, não
variável de ambiente. Uma mutação por vez em `conteudo/site.json`, `next build` em cada:

| mutação | exit | o que o build disse |
| --- | --- | --- |
| `barra-no-fim` | 1 | `"site.meta.urlBase": esperava texto no formato https://dominio.com.br (sem barra no fim)` |
| `telefone-pontuado` | 1 | `"site.identidade.whatsapp.e164": esperava texto no formato só dígitos, com DDI` |
| `apaga-alt` | 1 | `"site.meta.og.alt": esperava texto, veio nada (campo ausente)` |
| `campo-desconhecido` | 1 | `"site.meta": campo(s) que o esquema não conhece — "corDeFundo"` |
| `descricao-curta` | 1 | `"site.meta.descricao": esperava texto com ao menos 50 caractere(s)` |
| _restaurado_ | **0** | — |

`5 de 5 mutações reprovaram o build`. Com env var, cada uma dessas subiria calada — que é
exatamente o que aconteceu no PR `Navesz/Galegos#1`, e por que ele foi estacionado.

#### O que o gerador NÃO faz, de propósito

Criar o repositório remoto, ligar o ruleset e ligar o Pages. As três mexem na conta de
quem roda, e ele imprime as três no passo 6 em vez de fazê-las.

### 4.12 PROVADO · O MCP que se regenera — o objetivo nº 5, fechado

_Medido em 01/09/2026. Antes desta data o `mcp/` tinha 1.412 linhas no disco e **nunca
tinha rodado**: as dependências nunca foram instaladas, nenhum passo do `verificar` o
tocava e nenhuma regra o cobria. Ele servia PROSA do plano por seção._

O defeito que este módulo existe para não repetir, nas palavras do dono: _"no Herz e no
BMB Compras eu elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na
memória"_ — e _"o MCP não era reescrito quando as regras de projeto foram modificadas"_.

**O desenho, e é o da §7.2 do PLANO:** o MCP não é escrito à mão, é artefato GERADO;
o portão regenera em memória e reprova se o disco divergir; e o artefato é derivado da
fonte, nunca cópia dela.

| Peça                      | O que é                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `ferramental/rebar-check/index.mjs` | **A fonte.** 2.350 linhas, 22 regras, com o porquê medido de cada uma |
| `mcp/gerar.mjs`           | **O gerador.** 902 linhas, **zero dependência**                          |
| `mcp/regras.gerado.json`  | **O artefato.** 78 KB · 22 regras · 8 níveis · 11 passos · 52 provas     |
| `mcp/src/`                | **O servidor.** 937 linhas, 5 ferramentas. Lê o artefato, nunca a fonte  |

```bash
node mcp/gerar.mjs              # mcp/gerar: escrito … · 22 regras · 8 níveis · 11 passos · 52 provas
node mcp/gerar.mjs --verificar  # mcp/gerar --verificar: em dia · 22 regras · 4 fonte(s) conferida(s)
node mcp/src/prova-cliente.mjs  # handshake, tools/list, 7 chamadas de tool, e o servidor sem artefato
```

**O ciclo que define o objetivo nº 5, rodado de ponta a ponta.** Muda-se uma regra de
verdade — o título de `readme`, linha 1404 do `index.mjs` — e o portão acusa:

```
✗ mcp        4 erros  167 ms
    - regras.readme.titulo = tem README                    (disco, velho)
    + regras.readme.titulo = tem README na raiz do repositorio   (fonte, hoje)
```

`node mcp/gerar.mjs` — **um comando** — e o `verificar` volta a **APROVADO 11 de 11**.

**Zero dependência, conferido no pior caso.** O portão de frescor roda no `verificar` da
raiz e não pode exigir `mcp/node_modules`. Provado num clone em `tmpdir` com a pasta
apagada: `--verificar` respondeu `em dia` (exit 0) e, com a regra mutada, `DIVERGIU`
(exit 1) — nos dois casos sem uma única dependência instalada. O `git clone` também não
traz `mcp/node_modules`: o `node_modules/` do `.gitignore` já o cobre em qualquer nível.

**Custo medido do passo:** 175–213 ms em 5 rodadas (mediana 206 ms), contra 1,0 s do
prettier e os segundos de `provas` e `auto`. Ele é o 5º de 11, depois de `sintaxe` —
com o arquivo sem compilar, "o artefato divergiu" seria acusação falsa.

**O que foi consertado nesta rodada**, porque estava entregue e não funcionava:

1. **O ciclo não fechava em um comando.** O gerador escreve `JSON.stringify(…, 2)` e o
   prettier recolhe array curto para uma linha: depois de `node mcp/gerar.mjs` o passo
   `formato` ficava **vermelho**, e a dica do passo `mcp` mandava rodar só o gerador.
   Eram dois donos dos mesmos bytes. O artefato entrou no `.prettierignore` — é saída de
   máquina, e quem confere o conteúdo dele é o passo `mcp`, que compara FATO, não espaço
   em branco.
2. **`rebar --mcp` não existia.** Todo projeto gerado por `rebar novo` escreve um
   `.mcp.json` que roda `.rebar/mcp.mjs`, que chama `rebar --mcp` — e o parser respondia
   `opção desconhecida: --mcp`, saída 2. O ponteiro existia dos dois lados e o alvo não
   respondia. O despacho entrou no `index.mjs`, ao lado do subcomando `novo`, e entrega o
   stdio ao servidor com `stdio: 'inherit'`. Conferido de ponta a ponta: o `.mcp.json` de
   um projeto gerado sobe o servidor e responde `tools/call`.

**O objetivo nº 3 — "continuar impondo depois do dia 1" — tem agora as duas metades.** O
portão já ia junto no projeto gerado; o MCP passou a ir também, por ponteiro. O projeto
gerado **não** ganha MCP próprio, e a razão é a §7.2: ele tem zero regra própria, então um
MCP local serviria uma **cópia** das 22 regras do rebar — que é o defeito do Herz outra vez.

**O que fica parcial, e é dito aqui em vez de escondido:**

- **`porque` de cabeçalho em 5 de 22 regras.** As outras 17 têm o porquê extraído do corpo
  do `checar` ou do caso de prova (`0` regras ficaram sem nenhuma razão), mas a
  classificação é posicional, não semântica: comentário de implementação pura entra junto,
  rotulado `onde: "implementacao"`. A forma melhor é um campo `porque:` dentro de cada
  regra — zero parsing, conferido pelo prettier —, e custa 22 edições no `index.mjs`.
- **`npx --yes github:Navesz/rebar --mcp` não sobe o servidor** numa máquina sem checkout:
  o `npx` instala só as dependências da raiz, e `mcp/` é pacote separado. A falha é
  barulhenta e nomeia o conserto (`cd mcp && npm install`) e a alternativa sem MCP
  (`--json`). Fechar isso de vez pede um servidor de zero dependência — o cliente de prova
  já mostra que o protocolo cabe nisso, o servidor é que ainda usa o SDK.
- **`perfil.json` continua não existindo.** A §7.2 derivava o MCP dele; a fonte legível por
  máquina que existe hoje é o `index.mjs`, e é dele que o gerador deriva.

---

## 5. O que FALTA

### 5.1 Bloqueante para o rebar ser usável

_Remedido em 31/08/2026: as duas primeiras linhas saíram de "não existe"._

| Item                           | Estado                                               |
| ------------------------------ | ------------------------------------------------------ |
| O gerador — `rebar novo`       | **EXISTE e roda.** §4.11. Não é `npm create rebar`: é subcomando do mesmo `bin`, porque é o que o `npx` resolve |
| Preset `site`                  | **EXISTE e roda.** Next 16 SSG, conteúdo validado no build |
| Presets `app` / `api`          | Nenhum, e são **não-escopo** até o `site` rodar sem modificação em dois sites |
| MCP                            | **EXISTE, roda, e o portão o mantém em dia.** §4.12    |
| `perfil.esquema.json`          | Não existe. O pipeline painel→perfil→gerador é prosa   |

```bash
find . -name "*.schema.json" -not -path "*/node_modules/*"
# só os de dentro de provas/casos/schema-orfao — nenhum perfil.esquema.json
```

**Correção de um erro do ESTADO anterior:** ele dizia que o CI do próprio rebar "reprova a
si mesmo em 5 checagens". Não reprova. `npm run check` sai 11 de 11, 6 n/a, exit 0.

### 5.2 Os sete itens da §8.1 do PLANO — o que era para vir do alicerce

Estado verificado no disco em 30/08.

| Item da §8.1                                          | Estado real                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `verificar/verificar.mjs`                             | **PRESENTE.** 34.566 bytes, rastreado. Reescrito, não portado. 8 passos        |
| `segredo/varrer-segredo.mjs`                          | **PRESENTE.** 34.483 bytes, rastreado. Roda no `verificar` e no `pre-commit`   |
| `elos/verificar-elos.mjs`                             | **PRESENTE.** 2.191 bytes, rastreado. Execução limpa                           |
| `hooks/`                                              | **PRESENTE, e instalado.** 4 arquivos rastreados, `core.hooksPath` ativo       |
| `ci/verificar.yml` como template                      | **PRESENTE.** `.github/workflows/verificar.yml`. Nunca executou                |
| `contexto/ai.mjs`                                     | **AUSENTE.** `ferramental/contexto/` não existe                                |
| 15 presets de fronteira (web 7 + api 8) + 29 fixtures | **AUSENTE.** `ferramental/fronteiras/` não existe                              |

```bash
ls ferramental    # elos  hooks  rebar-check  segredo  verificar — só isso
```

**Sobram DOIS dos sete**, não três nem quatro: `contexto/ai.mjs` e os presets de fronteira.
O `perfil.esquema.json`, que o ESTADO anterior somava aqui, não é item da §8.1 — ele é
bloqueante da §5.1 acima. De fato não existe, mas contá-lo duas vezes inflava o buraco.

A fonte dos dois ausentes existe: `alicerce/ferramental/contexto/ai.mjs` e
`alicerce/ferramental/fronteiras/`.

### 5.3 As duas decisões 🔴 vermelhas — FECHADAS, e exercidas

_Atualizado em 31/08/2026. Estavam abertas em 30/08 e travavam o preset `site`; foram
fechadas nas §12.2 e §12.3 do PLANO e agora estão RODANDO, não só decididas._

**1 · Estratégia de renderização — fechada em Next 16 App Router com `output: "export"`.**
O argumento que decidiu continua valendo: SPA **não entrega `og:image`**, porque WhatsApp,
LinkedIn, Slack e Discord não executam JS. Exercido: o `out/index.html` do projeto gerado
traz `og:image` absoluto com `width`/`height`/`alt` e **sem uma linha de JS** — §4.11.
O preset `app` (Vite + TanStack Router) não é escopo agora.

**2 · Origem do conteúdo — fechada em `conteudo/*.json` validado no build.** A identidade
do negócio (telefone, CNPJ, endereço) é **conteúdo validado**, não variável de ambiente.
Exercido: 5 mutações no `conteudo/site.json`, 5 builds exit 1 — §4.11. O custo de errar
esta é conhecido e tem número: no PR `Navesz/Galegos#1`, com env var, o `wa.me` subia sem
destinatário e o cardápio parava de entregar pedido **em silêncio**.

### 5.4 Outras fronteiras abertas

**Autorização** — o painel só tem auth corporativa. Falta a distinção que a IA mais erra:
`if (!user) throw 401` não responde _"este usuário pode modificar **este** recurso"_.

**Isolamento de tenant** — fronteira aberta e **documentada em teste que passa de
propósito**: o custom GUC é `USERSET`, então a própria sessão troca o próprio contexto.
Quando o canal for fechado, o teste inverte.

**Tier 2 da revisão dos agentes**, em `docs/REVISAO-AGENTES.md`: TTL da tabela de
idempotência, expurgo do outbox, `statement_timeout`,
`idle_in_transaction_session_timeout`, tamanho do pool contra `max_connections`. Quantidade
exata: **não medida** nesta sessão.

---

## 6. Como rodar

Todos os comandos abaixo foram executados nesta sessão e funcionam.

```bash
# o checker contra qualquer repositório
node ferramental/rebar-check/index.mjs /caminho/do/repo      # texto
node ferramental/rebar-check/index.mjs --json /caminho/...   # JSON; aceita vários caminhos
node ferramental/rebar-check/index.mjs .                     # o próprio rebar
npm run check                                                # idêntico à linha acima

# o gerador — ESCREVE. Cria a pasta <nome> DENTRO DO CWD, então rode de onde
# você quer o projeto, nunca de dentro do rebar. Por isso NÃO existe script npm
# para ele: `npm run` roda sempre na raiz do pacote, e criaria rebar/<nome>.
cd /onde/o/projeto/vai/morar
npx github:Navesz/rebar novo <nome> [dominio]                       # o caminho do dono
node /caminho/do/rebar/novo/index.mjs <nome> [dominio]              # o mesmo, do checkout

# a sequência inteira
npm run verificar        # 8 passos · exit 0

# as provas do checker
npm run provar           # 50 casos · exit 0

# formato
npm run formato          # prettier --check .  → "All matched files use Prettier code style!"
npm run formatar         # prettier --write .  — ESCREVE nos arquivos

# elos
node ferramental/elos/verificar-elos.mjs      # 45 arquivos · exit 0

# domínio de privilégio (precisa do Postgres de pé)
cd dominios/privilegio-de-banco && npm test   # 16/16 · exit 0
```

**Sobre o exit code do checker, porque é fácil errar:** ele sai **1** sempre que alguma
regra determinística reprova, e isso vale igualmente para `--json`. Medido nesta sessão:
`. → exit 0`, `../prumo → exit 1`, `--json ../prumo → exit 1`, os 19 caminhos de uma vez →
exit 1. Quem consumir o `--json` num script precisa ler o stdout mesmo com exit diferente
de zero.

Dois scripts existem e **não foram executados nesta medição**, por escreverem estado:

- `npm run formatar` escreve nos arquivos. O `npm run formato` — mesmo binário, `--check` —
  passa, então o `--write` não teria o que mudar.
- `npm run instalar-hooks` altera `core.hooksPath`. O efeito dele já está aplicado.

---

## 7. Ambiente

### PostgreSQL 17.2 — de pé, conferido campo a campo

```bash
"C:/Users/leona/pg17/pgsql/bin/pg_isready.exe" -h 127.0.0.1 -p 55432
# 127.0.0.1:55432 - aceitando conexões · exit 0

"C:/Users/leona/pg17/pgsql/bin/psql.exe" \
  "postgresql://postgres:bootstrap_dev_only@127.0.0.1:55432/rebar_teste" \
  -tAc "select version(), current_database();"
# PostgreSQL 17.2 on x86_64-windows, compiled by msvc-19.41.34123, 64-bit|rebar_teste
```

Instalado sem Docker e sem admin.

```
binários  C:\Users\leona\pg17\pgsql\bin
cluster   C:\Users\leona\pg17\data
porta     127.0.0.1:55432
log       C:\Users\leona\pg17\pg.log
banco     rebar_teste

superusuário  postgres   / bootstrap_dev_only    ← autenticado nesta medição
db_owner      db_owner   / owner_dev_only        ← não testado isoladamente
runtime       app_login  / app_dev_only          ← não testado isoladamente
```

As duas últimas identidades são exercitadas pela suíte de 16 testes, que passa. Isso as
valida indiretamente, não diretamente.

Reiniciar — **comando não executado**, o servidor já estava no ar:

```bash
"C:/Users/leona/pg17/pgsql/bin/pg_ctl.exe" -D "C:/Users/leona/pg17/data" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "C:/Users/leona/pg17/pg.log" start
```

### Docker está quebrado nesta máquina, e continua quebrado

Cada restart falhava num socket diferente, sempre erro 123. **Dois diretórios foram
renomeados** em 26/08, e os dois renomes continuam no disco:

```bash
ls -d "$LOCALAPPDATA/Docker/"* "$LOCALAPPDATA/docker-secrets-engine"* | grep -E 'run|secrets'
# …/AppData/Local/Docker/run
# …/AppData/Local/Docker/run.quebrado-20260826
# …/AppData/Local/docker-secrets-engine.quebrado-20260826
# (sem o grep são 12 linhas: o Docker deixa lock, log e install-log na mesma pasta)
```

O Docker recriou um `Docker/run` novo ao lado do renomeado. Nada foi apagado — os
originais estão preservados sob o sufixo `.quebrado-20260826`.

**Não é bloqueante.** O Postgres nativo cobre tudo o que o projeto precisa. Este registro
existe para que a próxima sessão não gaste tempo redescobrindo o mesmo defeito nem apague
os diretórios preservados.

---

## 8. Método de trabalho

1. **Centralizar.** Um arquivo, no máximo três. Centralizar evita pivotar à toa.
2. **Documento vivo.** Decisão nova entra no arquivo, não fica na conversa.
3. **Revisão por múltiplos agentes**, procurando furo e o que combina com o quê.
4. **Verificar o que agente devolve.** _"Não adianta o agente retornar coisas falsas e você
   acreditar."_ — e procede: um revisor afirmou "50 vs 159 commits"; medido, era 61 vs 125.
   Esta reescrita seguiu a regra: partiu de uma medição feita por outro agente e **não** a
   aceitou como dada — placar, contagem de regras, casos de prova, `verificar`, hooks,
   remoto, Postgres e os trechos de código citados na §10 foram todos reexecutados aqui.
5. **Backup antes de mexer.** Existe em `rebar-backup-20260825/` — que é cópia solta de
   arquivos, **não** repositório git — e nos 13 commits.
6. **A matriz de invariantes vale se for gerada a partir do código, não escrita antes
   dele.** Domínio fechado = Claim + Assumptions + mecanismo + teste positivo + teste
   hostil + modo de falha + rollback, **com os testes existindo e passando**.

---

## 9. Critério de abandono

Do plano, §9.7. **Primeiro commit: 2026-08-25 23:35:43.** Hoje é 30/08 — **D+5**.

```bash
git log --reverse --format='%ad %s' --date=iso | head -1
# 2026-08-25 23:35:43 -0300 Importa o plano, a stack e as oito rodadas de revisao
```

| Marco | Vence      | Critério literal                                                                   | Se falhar                         |
| ----- | ---------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| D+7   | 01/09/2026 | `rebar-check` rodou contra ≥3 repositórios que não são o rebar                        | **Para**                          |
| D+30  | 24/09/2026 | ≥2 repositórios com `rebar-check` no CI **reprovando merge**, com link de execução    | Vira checklist e o repo é apagado |
| D+60  | 24/10/2026 | ≥1 checagem disparou e o dono **consertou o código em vez de desligar a checagem**    | A regra estava errada             |
| D+90  | 23/11/2026 | Checagens cresceram ≤50% **e** o nº de repositórios usando cresceu                    | Congela a lista                   |

**Parada dura:** dois repositórios novos iniciados sem o rebar, em sequência.

**Não-escopo:** nenhum preset `app` ou `api` antes de o `site` ter sido usado **sem
modificação** em dois sites.

### D+7 — CUMPRIDO, e o prazo ainda nem venceu

O checker rodou nesta sessão contra **18 repositórios que não são o rebar** — 19 menos ele
mesmo. Seis vezes o mínimo de 3, não quatro vezes como este arquivo dizia. O número que ele
publicava, 12, estava errado. A tabela da §4.8 é a saída.

### D+30 — 1 de 2. O primeiro repositório está gateado de verdade

Em 30/08/2026 o rebar saiu de ZERO para UM. As três exigências do critério, cumpridas
para o primeiro repositório e com link:

**(1) O `rebar-check` roda no CI.** `.github/workflows/verificar.yml`, matriz
`windows-latest` + `ubuntu-latest`, chamando `node ferramental/verificar/verificar.mjs`,
cujo último passo é o `rebar-check` apontado para o próprio repositório.

**(2) Existe execução, e ela é verde nos dois sistemas.**

```bash
gh run view 33341062882 --json conclusion,jobs
# success · windows-latest 57 s · ubuntu-latest 14 s
```
https://github.com/Navesz/rebar/actions/runs/33341062882

Foi a **primeira vez que qualquer coisa deste repositório rodou fora do Windows.** Eu
tinha registrado que esperava quebrar em Linux; não quebrou. O motivo provável são os dois
consertos do passo 1: o `.gitattributes` com `eol=lf` e o bit `+x` nos hooks, que eram
exatamente os dois defeitos que quebrariam lá.

**(3) O merge é reprovado de verdade, com PR plantado.** Apaguei o `.editorconfig` de
propósito num branch e abri PR:

```bash
gh pr view 3 --json mergeStateStatus,statusCheckRollup
# estado: BLOCKED
# verificar (windows-latest): FAILURE · verificar (ubuntu-latest): FAILURE
```
https://github.com/Navesz/rebar/pull/3 — fechado depois da prova.

E o push direto na `main` também é recusado:

```
! [remote rejected] main -> main (push declined due to repository rule violations)
```

O ruleset é https://github.com/Navesz/rebar/rules/21884527, com
`bypass_actors: []` e `current_user_can_bypass: "never"` — **nem o dono passa por cima.**
É o N4s da §9.3: o único nível que não mora em arquivo que o agente edita.

**Falta o segundo repositório.** O critério exige ≥2, e o placar é **1 de 19**.

A comparação que desmonta a vaidade do D+7: **o rebar mede 19 repositórios e impõe em 1 —
ele mesmo; o alicerce mede 2 e impõe nos 2.** Medir é ler; impor é barrar. O D+7 conta
leituras, e é por isso que ele é fácil.

```bash
for r in <os 18>; do [ -d "$r/ferramental" ] && echo "$r"; done
# alicerce · prumo
```

No `prumo` o ferramental do alicerce **gateia de verdade**:
`prumo/.github/workflows/ci.yml:113` roda `npm run verificar`, e `prumo/ferramental/` tem 8
diretórios — `contexto`, `controle`, `elos`, `fronteiras`, `hooks`, `portao`, `segredo`,
`verificar`. Ou seja, a premissa "o alicerce nunca encostou em projeto real" é **falsa**, e
ela sobrevive no cabeçalho de `ferramental/rebar-check/index.mjs` (linhas 4-5, ainda
dizem "o alicerce morreu porque a imposição nunca encostou num projeto"). Na
`docs/PLANO.md` §9.1 ela **já foi corrigida** em 30/08 — o comentário do código é o que
falta. Encostou, e no repositório de nota mais alta fora da ferramenta (85%). O que o
alicerce não fez foi **escalar**: 2 de 19. Esse é o diagnóstico defensável.

### D+60 — NÃO MENSURÁVEL AINDA

O mecanismo de disparo existe: os hooks estão instalados e barram commit de verdade. Mas os
13 commits do rebar não deixam rastro de uma checagem que tenha disparado e sido obedecida,
e o critério fala de repositório do dono em geral, não do rebar. Sem evidência no disco.

### D+90 — NÃO MENSURÁVEL, falta a linha de base

Hoje são 19 checagens; o teto de ≤50% seria 28. O segundo termo — "nº de repositórios
usando" — está em **1**. Medir 19 repositórios não é ser usado por 19 repositórios.

---

## 10. O que já foi tentado contra este repositório

Esta seção existe para duas pessoas: a próxima sessão, que não deve reabrir buraco já
fechado, e o próximo auditor, que deve começar de onde este parou.

Cada linha é um ataque que foi **reproduzido** e depois fechado. O conserto está no código,
com o comentário que registra a medição — os caminhos citados são onde ler, e todos foram
abertos e conferidos nesta sessão.

| #   | Ataque                                                                                                                                                                                                                                                                                                                                    | O que foi feito                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Forja de `--config`.** Seis passos `() => ({ codigo: 0 })` num config em `$TEMP` e `--config=` apontando para lá: saída byte-indistinguível de uma aprovação real, exit 0                                                                                                                                                                | O caminho do config e a raiz resolvida são **sempre impressos**, aprovado ou não; config que não é arquivo rastreado na árvore do git vira CONFIG EXTERNO e nunca sai 0; `--config=` vazio é exit 2. `ferramental/verificar/verificar.mjs:48-81`                                                 |
| 2   | **`skip-worktree`.** `git update-index --skip-worktree verificar.config.mjs` + reescrever o arquivo no disco ⇒ `git status`, `git diff` e `git diff HEAD` todos vazios, e APROVADO na tela                                                                                                                                                 | Roda `git ls-files -v`, o único comando que enxerga, e traduz cada letra anômala — inclusive a minúscula, que é `assume-unchanged`, o irmão silencioso. `verificar.config.mjs:63-67` e `verificar.mjs:239-254`                                                                                   |
| 3   | **Árvore suja saindo APROVADO.** 4 arquivos não commitados ⇒ APROVADO 6 de 6                                                                                                                                                                                                                                                              | Passo `higiene`, novo. "APROVADO" e "árvore limpa" são duas alegações independentes, e o portão só fazia uma. `verificar.config.mjs:341`                                                                                                                                                         |
| 4   | **Avisos mudos.** `extrairErros` só rodava quando o passo **não** passava, então a stdout de passo aprovado era descartada — inclusive o "⚠ N arquivo(s) escondidos por .rebarignore", que é o único canal que denuncia régua desligada                                                                                                    | Campo `avisar`: RegExp por passo, extraída e impressa **mesmo quando o passo passa**, em seção própria abaixo do placar. `verificar.config.mjs:417`                                                                                                                                              |
| 5   | **`caso.json` como bypass.** Um `caso.json` na raiz do repositório produz prefixo vazio, e `''.startsWith` casa com tudo: o repositório inteiro sumiria da avaliação com um arquivo de três bytes                                                                                                                                          | Marcador só vale sob `provas/casos/<caso>/`, nunca na raiz, e só com o schema mínimo. Marcador recusado vira **aviso nomeando o arquivo**. `index.mjs:241-262`                                                                                                                                   |
| 6   | **`.rebarignore` não rastreado.** Arquivo solto no disco — ou escondido atrás de `.git/info/exclude` — cegava o checker sem entrar em diff, em review ou no `git status`                                                                                                                                                                   | A lista é lida do **git**, não do disco. Não rastreado é ignorado por inteiro, e o fato vira aviso. `index.mjs:265-300`                                                                                                                                                                          |
| 7   | **`ehTeste` como terceiro bypass.** Arquivo de teste sai das regras de conteúdo; renomear uma pasta para `provas/` tirou o conteúdo dela de cinco regras **e** ainda satisfez `testes` — "2 de 8 + 2 avisos" virou "3 de 7 + 0 avisos", sem uma linha dizendo o que sumiu                                                                   | A exclusão é **contada e impressa** no placar, com amostra dos caminhos. `index.mjs:1016-1023` — a linha "2 arquivo(s) … por serem teste" do `npm run check` é essa contagem                                                                                                                     |
| 8   | **Segredo lendo o disco em vez do índice.** `--staged` pegava os NOMES do índice e o CONTEÚDO do disco: lia um arquivo e commitava outro. Não é só ataque — acontece sozinho quando se edita depois do `git add`                                                                                                                           | Em `--staged` o conteúdo vem do **blob do índice**. O disco só é lido no modo normal. `varrer-segredo.mjs:17-21`                                                                                                                                                                                 |
| 9   | **PLACEHOLDER desligando a linha inteira.** Medido: 8 de 9 credenciais **reais** passaram. O caso pior era `{ host: "localhost", token: "ghp_…" }`, linha que qualquer projeto escreve                                                                                                                                                     | O placeholder é testado contra o **trecho casado**, nunca contra a linha. Desligar a linha inteira só pelo escape hatch explícito `rebar-segredo-ok:`. `varrer-segredo.mjs:23-30`                                                                                                                |
| 10  | **Coautoria por enumeração.** A política era uma lista de 9 agentes de IA. Windsurf, ChatGPT, Cody, Codeium, Amazon Q e Tabnine entraram no histórico com trailer que o `git log --format=%(trailers)` reconhece: hook aprovando, exit 0 nos seis                                                                                          | Virou **allowlist de humanos** em `.rebar-coautores`, comparada por e-mail em caixa baixa, e o arquivo tem de estar rastreado. Enumerar agente é corrida que se perde toda semana                                                                                                                |
| 11  | **Contrabando abaixo da tesoura.** Um `Co-authored-by:` escrito **depois** da linha de comentário `>8` que o git corta: o parser de trailer perdia, e o commit entrava                                                                                                                                                                     | `checar-mensagem.mjs` **não corta na tesoura** — usa `git stripspace --strip-comments` e depois `git interpret-trailers --parse`, nessa ordem. Medido nos dois lados: acha o trailer escondido e não gera falso positivo com o diff do `commit -v`. `ferramental/hooks/checar-mensagem.mjs:26-49` |
| 12  | **As provas liam exit code.** O `index.mjs` colapsa `passou` e `na` no mesmo exit 0, então nenhum ramo "não se aplica" podia ser travado. Medido: das **70 mutações** aplicadas ao `index.mjs`, **30 sobreviveram** com a suíte 15 de 15 verde — entre elas o helper `na()` e o `catch` do `git()`, os dois consertos mais caros do arquivo | Cada lado do caso declara um **estado** (`passou`/`reprovou`/`na`) e o runner o lê do `--json`. `quebrou` nunca pode ser esperado: crash é defeito do instrumento. `provas/provar.mjs:74-95`                                                                                                     |

Três desses ataques têm o mesmo formato, e vale nomear o padrão: **portão aberto tem de ser
fato checado, não omissão.** `.rebarignore`, `caso.json` e `ehTeste` continuam existindo
como saída legítima — o que mudou é que usá-los deixa marca impressa no placar.

Uma classe inteira de falso positivo também morreu nesta sessão: **"defeito procurado
recursivamente, defesa procurada só na raiz"**. Está documentada em
`ferramental/rebar-check/index.mjs:320-330`, que termina com "Cinco achados, cinco falsos":
`prumo`, `ducado` e `LinhaK` acusados de "components/ui/ sem components.json" tendo os três
o arquivo rastreado, `openkartline` acusado de "sem prettier" com prettier declarado em
`apps/web/package.json`, e `LinhaK` acusado também em `typecheck`. É parte do motivo de o placar novo não ser comparável com o velho.
**Não existe placar antigo comparável para subtrair** — o número da §4.8 é o novo, e ponto.

---

## 11. Próximo passo

Feito nesta sessão, e não é pouco: o rebar passa na própria régua (11 de 11), o `verificar`
fechou 8 de 8, as provas foram de 15 para 47 casos com um formato que trava os ramos N/A,
os hooks foram instalados, e doze ataques foram fechados.

O que falta é o que transforma isso em imposição de verdade, e o primeiro item não é código:

**1 · Empurrar o repositório e ligar o branch protection.** O remoto existe e está vazio —
`git ls-remote origin` devolve zero refs. O relato da sessão diz que o push está travado
porque o token do `gh` não tem escopo `workflow` e o repositório tem
`.github/workflows/verificar.yml`; **não medi o escopo do token** — confira com
`gh auth status` antes de agir. Sem push não há execução, sem execução não há link, e sem
link o D+30 fica em zero. Depois do push, o ruleset no GitHub exigindo o check **por nome**:
enquanto ele não existir, um agente apaga o `.yml` e o PR fica verde. É o N4s da §9.3 — o
nível que só existe no servidor.

**2 · Instalar o `rebar-check` no CI de dois repositórios que não são o rebar.** É a
literalidade do D+30. Os dois candidatos óbvios são `prumo` (85%, já tem CI que gateia) e
`openkartline` (62%, idem). Vence em **24/09/2026**.

**3 · Fechar o domínio de isolamento de tenant**, que é onde está a única falha conhecida e
documentada em teste.

Os dois itens ausentes da §8.1 — `contexto/ai.mjs` e os presets de fronteira — e o gerador
ficam **depois** disso. Ordem travada: consumidor antes do gerador.
