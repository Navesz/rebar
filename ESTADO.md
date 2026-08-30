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

### 4.2 `rebar-check` · 20 checagens, zero dependência

`ferramental/rebar-check/index.mjs` — roda em qualquer repositório, **nunca escreve**.

14 determinísticas derrubam o exit code · 6 heurísticas só informam. A separação é
medida: a regra de cor literal ingênua deu **7 ocorrências e zero verdadeiros positivos**
no herz — cinco eram comentários documentando a própria regra.

Placar medido em 30/08, os 12 repositórios git da máquina:

| Repo | Nota | |
|---|---|---|
| prumo | **9/14** | 2 avisos |
| ducado | **9/14** | 1 aviso |
| **rebar (ele mesmo)** | **8/14** | — |
| vectra-painel | 8/14 | — |
| openkartline | 8/14 | 2 avisos |
| VectraB-Lab | 8/14 | — |
| decima-edicoes | 6/14 | 2 avisos |
| LinhaK | 6/14 | — |
| Galegos | 5/14 | 3 avisos |
| navesz.github.io | 5/14 | 2 avisos |
| alicerce | **4/14** | 11 de 11 commits com coautoria de IA |
| hug-brasil-propostas | **3/14** | 2 avisos |

Média 6,6. **Nenhum repo passa em tudo, e o pior nota é o `alicerce`** — o repositório
que existe para impor. Nota mais alta em `prumo` e `ducado`, que são os únicos com CI que
de fato roda lint, tipos e teste.

Validado contra a forense, que virou a fixture: reproduz os números que seis agentes
mediram independentemente.

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

O preditor que orientou a ordem: dos sete repos do dono, **o alicerce é o único sem tela
e é o único morto**. Placar é a tela do rebar.

---

## 9. Próximo passo sugerido

**Fazer o rebar passar no próprio checker.** Ele dá **8/14** em si mesmo — falta
`.editorconfig`, dependabot, CI, `ci-gateia`, `.env.example` e LICENSE.

É o menor trabalho com o maior significado — a ferramenta que reprova os outros
reprovando a si mesma é exatamente o padrão que o projeto existe para acabar. E ao
consertar, o CI do rebar nasce rodando o próprio checker, que é o primeiro caso real de
"a regra virou porta".

Depois: fechar o domínio de **isolamento de tenant**, que é onde está a única falha
conhecida e documentada.
