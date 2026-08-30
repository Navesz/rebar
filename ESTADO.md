# rebar — estado do projeto

> **Leia este arquivo primeiro.** É o ponto de entrada para qualquer sessão nova.
> Atualizado: **30/08/2026** · repo: `C:\Users\leona\OneDrive\Documents\rebar`

---

## 1. O objetivo final

`rebar` é o **alicerce v2**. Repositório novo, não construído sobre o alicerce atual.

A dor que ele existe para resolver, nas palavras do dono:

> *"Todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador,
> esquecendo do shadcn."*

O diagnóstico já estava escrito pelo próprio alicerce: **"decisão que mora onde nenhuma
máquina lê"**. Das 120 decisões do painel dele, ~8 têm porta real.

### Os seis objetivos

1. **Fazer código errado não passar.** Erro que **barra**, não que vira aviso ignorado.
2. **`npm create rebar`** — projeto que nasce com a stack certa e o portão fechado.
3. **Continuar impondo depois do dia 1** — o gerador não sai de cena; fica como MCP e portão.
4. **Descer as regras de nível** — o que é pedido em prosa e caberia num lint, vira lint.
5. **Manter o MCP vivo** — regra mudou, MCP se regenera, e o portão reprova se estiver velho.
6. **Navegável por agente novo** sem ler tudo.

---

## 2. Os três princípios

Saíram de nove rodadas de revisão adversarial. Os dois últimos nasceram de **erros
cometidos no próprio documento**.

**1 · Descer de nível, com uma condição.**
> Se uma regra pode descer de prosa para enforcement, ela deve descer — **mas o enforcement
> precisa ser mais confiável do que a regra que substitui.**

**2 · Nada importante mora só em texto.**
> Qualquer regra importante demais para a IA esquecer é importante demais para existir
> apenas como texto.

Medido: nos seis repositórios reais, **os três sem CI são exatamente os três com lint
quebrado**. E o repo com mais documento de governança acumulou 35 erros de lint, porque
nada nunca executa o `check` que ele mesmo define.

**3 · Proveniência é de camada, não de fonte.**
> Afirmação verificável precisa de fonte primária **da camada responsável pela propriedade
> afirmada.** Não pule camada.

| Propriedade | Dono |
|---|---|
| MVCC, `SKIP LOCKED`, `RESET ROLE` | PostgreSQL |
| Sync por query, `onConnect` | node-postgres |
| Serialização, mapa de status | oRPC |
| SQL gerado | Kysely |

Formato obrigatório de citação em ADR: **`Claim` · `Owner` · `Evidence` · `Assumptions`**,
e cada linha de `Assumptions` vira asserção no fitness test.

---

## 3. Decisões travadas

| Decisão | Escolha |
|---|---|
| Natureza | Gera **e** fica vigiando |
| Alvo | Presets `site` / `app` / `api` |
| Dureza | Bloqueia commit **e** CI |
| Coautoria de IA | **Bloqueada** nos projetos novos. Commits do rebar não levam trailer |
| Banco | **Postgres.** SQL Server exige licença, e não há migração — o backend do herz nunca existiu |
| Contrato | **oRPC 1.15.0**, não ts-rest (ADR 0011 do prumo supersedeu) |
| Componentes | **shadcn sobre `@base-ui/react`**, style `base-nova`. **Não é Radix** |
| Interface | Aproveitar a do herz — a animação vem de `tw-animate-css` + data-attributes, sem `@keyframes` |
| Linter | oxlint rápido + ESLint pequeno para regras próprias (plugins do oxlint em alpha, sem type-aware customizado) |
| Ordem | **Consumidor antes do gerador** — checar o que existe antes de gerar o próximo |
| Postura do checker | **Só reporta.** Nunca escreve em repositório nenhum |

---

## 4. O que está FEITO

### 4.1 Domínio provado: privilégio de banco · **16/16 verdes**

`dominios/privilegio-de-banco/` — contra PostgreSQL 17.2 **real**, não mock.

Três identidades: `db_owner` (migrations) · `app` (NOLOGIN, DML) · `app_login`
(LOGIN, **NOINHERIT**, zero privilégio de aplicação).

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
prumo** — falharia **aberto**: conexão do pool rodando como superusuário para todo
request seguinte.

**Conserto medido:** `SET LOCAL ROLE app` como primeira instrução da transação, no
`UnitOfWork`. Cura conexão envenenada e reverte no COMMIT. A Stack já exige "uma
transação por caso de uso, aberta só no UnitOfWork" — não adiciona disciplina, move a
existente.

### 4.2 `rebar-check` · 19 checagens, zero dependência

`ferramental/rebar-check/index.mjs` — roda em qualquer repositório, **nunca escreve**.

14 determinísticas derrubam o exit code · 5 heurísticas só informam. A separação é
medida: a regra de cor literal ingênua deu **7 ocorrências e zero verdadeiros positivos**
no herz — cinco eram comentários documentando a própria regra.

Placar medido em **30/08**, com a **régua recalibrada**, nos 12 repositórios git da
máquina:

| Repo | Nota | Aplicáveis | N/A | Avisos |
|---|---|---|---|---|
| **rebar (ele mesmo)** | **100%** | 10/10 | 4 | — |
| prumo | 69% | 9/13 | 1 | 2 |
| ducado | 55% | 6/11 | 3 | 1 |
| openkartline | 54% | 7/13 | 1 | 2 |
| vectra-painel | 50% | 5/10 | 4 | — |
| decima-edicoes | 42% | 5/12 | 2 | 2 |
| VectraB-Lab | 33% | 2/6 | 8 | — |
| LinhaK | 33% | 3/9 | 5 | — |
| Galegos | 27% | 3/11 | 3 | 3 |
| alicerce | 20% | 2/10 | 4 | — |
| navesz.github.io | 20% | 2/10 | 4 | 2 |
| hug-brasil-propostas | **17%** | 2/12 | 2 | 2 |

Agregado: **55 de 127** checagens aplicáveis passam — 43,3%. Mediana 37,5%.

**Nenhum repositório que não seja a ferramenta passa em tudo.** O `rebar` fecha em
100%, e é o único. Entre os
repositórios que não são a ferramenta, o teto é 69% no `prumo` e o piso é 17% no
`hug-brasil-propostas`.

O `rebar` só chegou lá depois de um conserto que as próprias provas
provocaram: os casos de `ui-falso` e `schema-orfao` são, por construção, repositórios
defeituosos em miniatura, e rastreados dentro do rebar faziam o rebar reprovar em
`ui-falso`, `schema-orfao` e `typecheck` — **acusado pelas próprias provas.** Agora a
árvore marcada por um `caso.json` sai da avaliação, e a contagem do que saiu vai impressa
no placar. Só **três** repositórios têm CI que alcança a verificação que eles
mesmos declaram — `prumo`, `openkartline` e `decima-edicoes`. Dos outros nove, seis não têm
CI nenhum, dois têm CI e não têm script de lint/tipos/teste para ele alcançar, e um
(`ducado`) tem os scripts e o CI não passa neles.

**A linha do `rebar` andou muito nesta sessão** — 43% (3/7) às 13:38, 67%, 90%, e 100%
depois que o `formatter` foi resolvido. Remeça antes de citar o número.

> ⚠️ **A tabela anterior desta seção estava descalibrada; os números `x/14` foram apagados,
> não convertidos.** Ela saiu de uma régua em que `null` queria dizer duas coisas ao mesmo
> tempo — "passou" e "não havia o que checar". Consequência medida: uma pasta **vazia** com
> um `.git/` vazio tirava **8 de 14**, empatava com o `rebar` e tirava o dobro do `alicerce`.
> O nada não conforma. Três consertos entraram de uma vez: o N/A saiu do **denominador**
> (por isso a nota virou percentual e o denominador varia por repositório), o crash do git
> virou erro explícito em vez de aprovação silenciosa, e dois falsos positivos
> determinísticos caíram — teste nomeado em português (43 arquivos invisíveis no alicerce)
> e CI que agrega a verificação num comando só. Número velho e número novo **não são
> comparáveis**; não subtraia um do outro.

A forense continua valendo como fixture de conteúdo; o que mudou foi a escala, não os
achados individuais.

### 4.3 Documentos

| Arquivo | O quê |
|---|---|
| `docs/STACK.md` | **v1.2**, ~780 linhas, versionada com histórico de 0.1 a 1.2 |
| `docs/PLANO.md` | Painel de 120 decisões, forense dos seis sites, taxonomia N0–N7 |
| `docs/REVISAO-AGENTES.md` | Revisão por 6 agentes: 89 achados, 19 críticos, 34 bloqueantes |
| `docs/RESPOSTA-REVISAO*.md` | As 8 rodadas com o revisor externo |

### 4.4 Ambiente

**PostgreSQL 17.2 rodando**, instalado sem Docker e sem admin:

```
binários  C:\Users\leona\pg17\pgsql\bin
cluster   C:\Users\leona\pg17\data
porta     127.0.0.1:55432
log       C:\Users\leona\pg17\pg.log

superusuário  postgres / bootstrap_dev_only
db_owner      db_owner / owner_dev_only
runtime       app_login / app_dev_only
banco         rebar_teste
```

Reiniciar:
```bash
"C:/Users/leona/pg17/pgsql/bin/pg_ctl.exe" -D "C:/Users/leona/pg17/data" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "C:/Users/leona/pg17/pg.log" start
```

> ⚠️ **Docker está quebrado nesta máquina.** Cada restart falha num socket diferente,
> sempre erro 123. Renomeados para `.quebrado-20260826`: `AppData\Local\Docker\run` e
> `AppData\Local\docker-secrets-engine`. Os originais estão preservados. **Não é
> bloqueante** — o Postgres nativo cobre tudo.

---

## 5. O que FALTA

### Bloqueante para o rebar ser usável

| Item | Nota |
|---|---|
| `npm create rebar` | O gerador não existe |
| Presets `site` / `app` / `api` | Nenhum |
| MCP | Esqueleto em `mcp/src/index.mjs`, **nunca rodou** |
| CI do próprio rebar | Ele reprova a si mesmo em 5 checagens |
| `perfil.esquema.json` | Não existe — o pipeline painel→perfil→gerador é prosa |

### Os sete itens da §8.1 do PLANO — o que era para vir do alicerce "como está"

Este bloco não existia neste arquivo. Os sete itens não tinham sido adiados: tinham
**sumido do radar** — um grep por `8.1|portar|varrer-segredo|verificar.mjs|hooks/|elos`
neste arquivo devolvia zero linhas. Estado verificado no disco em **30/08 13:41:32**;
três deles estão sendo portados por outros agentes agora, então **remeça antes de citar**.

| Item da §8.1 | Estado real hoje |
|---|---|
| `verificar/verificar.mjs` | **Feito, e não portado — reescrito.** `ferramental/verificar/verificar.mjs` + `verificar.config.mjs`, 6 passos. Deliberadamente SEM as duas portas destrancadas do original: não existe campo `opcional` (lá, passo opcional que falha imprime APROVADO e sai 0) e `--passo=` imprime PARCIAL e sai 3, nunca 0 |
| `segredo/varrer-segredo.mjs` | **Portado.** Com `senha`, `postgres`, `docker` e `local` na lista de placeholder — sem afrouxar o padrão de detecção. Roda no `verificar` e no `pre-commit` |
| `elos/verificar-elos.mjs` | **Portado.** Roda no `verificar` |
| `contexto/ai.mjs` | **Nada.** `ferramental/contexto/` não existe. É o que mede o orçamento de contexto — a métrica que a §12.5 item 6 diz ser a certa |
| `hooks/` | **Portado e ampliado.** `pre-commit` (segredo em stage + coautoria) e `commit-msg` NOVO, que não existia no alicerce: o `rebar-check` lê `git log` e não enxerga o commit em curso, então ele impedia o trailer de FICAR, não de ENTRAR. Instale com `npm run instalar-hooks` — **não está instalado**, é decisão do dono |
| 15 presets de fronteira (web 7 + api 8) com as 29 fixtures | **Nada.** `ferramental/fronteiras/` não existe. Fonte conferida em `alicerce/ferramental/fronteiras/`: 7 regras em `web-camadas.cjs`, 8 em `api-camadas.cjs`, 29 arquivos de fixture em `provas/web/` e `provas/api/`. O número da §8.1 está certo |
| `ci/verificar.yml` como template | **Feito.** `.github/workflows/verificar.yml`, matriz windows-latest + ubuntu-latest, `fetch-depth: 0` (com clone raso as regras que leem `git log` enxergariam um commit só e aprovariam qualquer histórico) |

Sobram três dos sete: `contexto/ai.mjs`, os 15 presets de fronteira com as 29 fixtures, e
o `perfil.esquema.json`.

O que **existe** e não é da §8.1: `ferramental/rebar-check/provas/casos/` com **15 casos**
`aprovar`/`reprovar` cobrindo as 14 regras determinísticas, e `ferramental/hooks/commit-msg`.

**Decisão de 30/08 — o rebar adota o prettier.** É a única dependência do repositório, e a
fronteira é deliberada: `index.mjs` continua importando só built-ins, então
`npx github:Navesz/rebar` roda sem instalar nada. Zero dependência é propriedade do que
**confere**, não do que se confere. As duas alternativas foram descartadas com motivo:
aceitar o 90% deixaria o `verificar` vermelho para sempre, e portão que nunca fica verde é
portão que se aprende a ignorar; estreitar a regra para dispensar repositório sem
dependência seria abrir exceção para si mesmo na única régua que o projeto entrega.
Custo pago: o CI ganhou um `npm ci`, e o prettier expandiu o `index.mjs` de 567 para 741
linhas. Discutir isso é o que a regra existe para acabar.

### Decisões 🔴 em aberto

1. **Estratégia de renderização.** Vite + TanStack Router é SPA, e SPA **não entrega
   `og:image`** — WhatsApp, LinkedIn, Slack e Discord não executam JS. Bloqueante para o
   preset `site`. TanStack Start é candidato forte, **em Release Candidate** (verificado
   na doc oficial, não é GA).
2. **Origem do conteúdo** — hardcode · MD/MDX · CMS · banco. É literalmente o
   *"hardcoded"* da queixa original, e não existe nenhuma linha sobre isso no painel.
3. **Autorização** — o painel só tem auth corporativa. Falta a distinção que a IA mais
   erra: `if (!user) throw 401` não responde *"este usuário pode modificar **este**
   recurso"*.
4. **Isolamento de tenant** — fronteira aberta e **documentada em teste**: custom GUC é
   `USERSET`, então a própria sessão troca o próprio contexto. Há um teste que falha de
   propósito; quando o canal for fechado, ele inverte.

### Da revisão dos agentes, ainda aberto

~20 bloqueantes de Tier 2 em `docs/REVISAO-AGENTES.md`: TTL da tabela de idempotência,
expurgo do outbox, `statement_timeout`, `idle_in_transaction_session_timeout`, tamanho do
pool contra `max_connections`.

---

## 6. Como rodar

```bash
# domínio de privilégio (precisa do Postgres de pé)
cd dominios/privilegio-de-banco && npm test

# checker contra qualquer repositório
node ferramental/rebar-check/index.mjs /caminho/do/repo
node ferramental/rebar-check/index.mjs --json /caminho/do/repo    # para CI
node ferramental/rebar-check/index.mjs .                          # o próprio rebar
```

---

## 7. Método de trabalho — como o dono quer

1. **Centralizar.** Um arquivo, no máximo três. Centralizar evita pivotar à toa.
2. **Documento vivo.** Decisão nova entra no arquivo, não fica na conversa.
3. **Revisão por múltiplos agentes**, procurando furo e o que combina com o quê.
4. **Verificar o que agente devolve.** *"Não adianta o agente retornar coisas falsas e
   você acreditar."* — e procede: um revisor afirmou "50 vs 159 commits"; medido, era
   61 vs 125.
5. **Backup antes de mexer.** Existe em `rebar-backup-20260825/` e nos commits.
6. **A matriz de invariantes vale se for gerada a partir do código, não escrita antes
   dele.** Domínio fechado = Claim + Assumptions + mecanismo + teste positivo + teste
   hostil + modo de falha + rollback, **com os testes existindo e passando**.

---

## 8. Critério de abandono

Do plano, e o histórico do dono diz que precisa:

| Marco | Critério | Se falhar |
|---|---|---|
| **D+7** | `rebar-check` rodou contra ≥3 repositórios que não são o rebar | **Para** |
| D+30 | ≥2 repos com o checker no CI **reprovando merge**, com link de execução | Vira checklist e o repo é apagado |
| D+60 | ≥1 checagem disparou e o dono **consertou o código em vez de desligar a checagem** | A regra estava errada |
| D+90 | Checagens cresceram ≤50% **e** a adoção cresceu | Virou alicerce; congela a lista |

**Parada dura:** dois repositórios novos iniciados sem o rebar, em sequência.

**Não-escopo:** nenhum preset `app` ou `api` antes de o `site` ter sido usado **sem
modificação** em dois sites.

> **D+7 está CUMPRIDO** — o checker rodou contra **12** repositórios em 30/08,
> quatro vezes o mínimo exigido.

**D+30 é o marco que ainda não tem número, e a comparação honesta desmonta a vaidade do
D+7.** Medido: **o rebar mede 12 repositórios e não impõe em nenhum; o alicerce mede 2 e
impõe nos 2.** O `ferramental/` do alicerce está instalado em exatamente dois lugares —
o próprio alicerce e o `prumo` — e no `prumo` ele **gateia de verdade**:
`prumo/.github/workflows/ci.yml:113` roda `npm run verificar`, que é
`node ferramental/verificar/verificar.mjs`, e a linha 207 roda
`node ferramental/portao/provar-portao.mjs`. `prumo/ferramental/` tem 8 diretórios, 7 deles
com o mesmo nome dos do alicerce, e a linha 139 do próprio CI diz que os casos vieram do
alicerce upstream.

> ⚠️ **A premissa "o alicerce nunca encostou em projeto real" é falsa** e circulou como
> justificativa de desenho. Ela sobrevive no cabeçalho de `ferramental/rebar-check/index.mjs`
> e em `docs/PLANO.md` §9.1. Encostou, e no único repositório que o rebar mediu em 69%. O
> que o alicerce não fez foi **escalar** — 2 de 12. Esse é o diagnóstico defensável.

O preditor que orientou a ordem: dos sete repos do dono, **o alicerce é o único sem tela**.
Placar é a tela do rebar. A parte "e é o único morto" não se mede: ele está rodando no CI
do `prumo`.

---

## 9. Próximo passo sugerido

**Feito em 30/08:** o rebar passa no próprio checker, 10 de 10, e
`node ferramental/verificar/verificar.mjs` sai `APROVADO` em 6 de 6 passos.

O próximo é o que transforma isso em imposição de verdade, e nenhum dos dois é código:

1. **Instalar o hook** — `npm run instalar-hooks`. Está escrito e provado, e **não está
   instalado**: mudar `core.hooksPath` do repositório é decisão do dono, não do agente.
2. **Subir o repositório e ligar o branch protection.** O CI existe em arquivo; enquanto
   não houver ruleset no GitHub exigindo o check por nome, um agente apaga o `.yml` e o PR
   fica verde. É o **N4s** da §9.3 — o nível que só existe no servidor, e o único que
   resiste ao agente.

Só depois disso o D+30 (`≥2 repositórios com rebar-check no CI reprovando merge`) começa a
contar. Hoje o placar é **1 de 12** — o próprio rebar.

Depois: fechar o domínio de **isolamento de tenant**, que é onde está a única falha
conhecida e documentada.
