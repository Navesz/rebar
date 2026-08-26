# Stack v1.2

> **A versão Postgres.** Arquivo separado do [PLANO.md](./PLANO.md).
> **Estado:** revisada · 25/08/2026
>
> **Versionamento.** MAJOR sobe quando uma decisão fechada é revertida ou trocada;
> MINOR quando decisão nova entra ou um furo é fechado. Toda mudança entra no
> histórico abaixo — documento sem histórico não tem como provar que não derivou.
>
---

## Histórico

| Versão | O que mudou |
|---|---|
| **1.2** | **Idempotência:** `409 nunca replay` era correção exagerada — são dois estados, com **recheck** depois do lock. **Advisory lock** em namespace `(int4,int4)`, separado do lock de migration em `bigint`. **DoS:** três tetos, não um — a fila do pool também enche. **`version`** ganha trigger, senão depende de memória. **Desfecho** separa `commandStatus` de `effectStatus`. **TTL** com lápide de retenção longa |
| 1.1 | Revisão por seis agentes: 89 achados, 19 críticos. **Outbox** reenviava a cada tick (o `SELECT` não lia o lease) e TX 2 não validava posse. **Duplicate-in-flight** tinha três respostas simultâneas e o teste aprovava a arquitetura rejeitada. **`RESET ROLE`**: a citação elidia a oração que decide o caso, e faltavam dois vetores. **Dinheiro**: `numeric[]` e `binary:true`. **CSRF** do oRPC descrito errado |
| 1.0 | Primeira versão que sobreviveu à revisão adversarial. Oito rodadas, resumidas abaixo |
| 0.8 | **Pool:** espera limitada no HTTP não alcançava o bloqueio no índice único → `pg_try_advisory_xact_lock` fail-fast. **Replay:** envelope versionado era `unknown` disfarçado → desfecho estável separado do resultado tipado. **Extensões:** regra precisada para *trusted* + não-superuser |
| 0.7 | **Idempotência:** versão no escopo causava cobrança dupla no deploy → chave estável entre versões. `pgcrypto` removido. `SECURITY DEFINER` com `search_path`. `409` decidido |
| 0.6 | Contradição interna: `ALTER ROLE … SET role` invalidava o próprio teste hostil → removido. `PUBLIC` auditado. Privilégio efetivo via `pg_has_role` |
| 0.5 | **Três identidades** — `RESET ROLE` devolvia superusuário. `INHERIT FALSE` faz a fuga reduzir privilégio |
| 0.4 | `pipeline` não remove ordenação; o problema é ausência de barreira de aquisição. Princípio da camada dona |
| 0.3 | `onConnect` no lugar de `pool.on('connect')`. Invariante unificada idempotência + outbox |
| 0.2 | TanStack Start é RC, não GA. Linter duplo. Três classes de regra. `@expect-rule` |
| 0.1 | Pivot do `herz/planejamento/Stack.md` v4.3, SQL Server → Postgres |

**Origem.** Pivotada de `herz/planejamento/Stack.md` (788 linhas, v4.3), a melhor peça de arquitetura do acervo — escrita para **SQL Server em Windows Server**. Trocar o banco reabriu concorrência, migrations, tipos e assíncrono.

**Precedência.** Os 13 ADRs do `prumo` (24/08) resolvem parte disto, e melhor. Onde há ADR, **o ADR vence** — está aplicado, e o herz nunca chegou a construir o backend. Onde o ADR ficou atrás do `package.json`, **vence o código**.

---

## O critério único

Herdado do herz, e continua valendo:

> **Qual opção faz com que código gerado errado *pareça* errado?**

Refinado em 21/08: *a abstração deve reduzir o espaço de erro sem esconder invariante ou efeito importante.* Foi o que derrubou Prisma, NestJS e o pipeline de geração de contrato.

Segundo critério, subordinado: *isto resolve um problema que existe hoje, ou um que eu imagino ter depois?*

## Os três princípios

Saíram de seis rodadas de revisão adversarial. Os dois últimos nasceram de erros cometidos **neste documento**.

**1 · Descer de nível, com uma condição.**

> Se uma regra pode descer de prosa para enforcement, ela deve descer — **mas o enforcement precisa ser mais confiável do que a regra que substitui.**

A primeira metade sozinha produz CI idiota. A segunda sozinha produz paralisia. Juntas descrevem o único caminho que funciona.

**2 · Nada importante mora só em texto.**

> Qualquer regra que seja importante demais para a IA esquecer é importante demais para existir apenas como texto.

Não é intuição — é medição. Nos seis repositórios reais, os **três sem CI são exatamente os três com lint quebrado**. E o repositório com mais documento de governança — `AGENTS.md` com "Hard rules", `SECURITY.md`, `GOVERNANCE.md`, prettier e um script `check` encadeando tudo — acumulou **35 erros de lint**, porque nada nunca executa aquele `check`.

**3 · Proveniência é de camada, não de fonte.**

> Afirmação verificável precisa de fonte primária **da camada responsável pela propriedade afirmada.** Não pule camada.

| Propriedade | Quem é dono |
|---|---|
| MVCC, isolamento, `SKIP LOCKED` | PostgreSQL |
| Sync por query, error boundary, `onConnect` | node-postgres |
| Serialização, mapa de status | oRPC |
| SQL gerado | Kysely |
| Preview de link não executa JS | crawler / especificação OG |

Este princípio existe porque a revisão deste documento produziu uma conclusão plausível, apoiada em documentação oficial do PostgreSQL — e **errada**, porque a propriedade afirmada era do node-postgres, que implementa o protocolo por conta própria e escolheu Sync por query. A fonte era primária; era primária da abstração errada.

**Consequência prática:** num ADR, a citação nomeia **o componente**, não só a URL. Formato obrigatório:

```
Claim:        RESET ROLE não eleva privilégio
Owner:        PostgreSQL
Evidence:     sql-set-role · ddl-priv
Assumptions:  session_user = app_login
              app_login não tem SET até db_owner
              app_login não herda app  (INHERIT FALSE)
              PUBLIC não oferece caminho privilegiado
```

**Cada linha de `Assumptions` precisa ser individualmente testável, e vira asserção no fitness test.** As quatro acima viram `session_user`, `pg_has_role(…,'SET')`, `pg_has_role(…,'USAGE')` e a varredura de `PUBLIC`. **`Claim` e `Assumptions` juntos produzem uma obrigação de teste**: o Claim é a conclusão e não é testável sozinho; as Assumptions são testáveis mas não dizem para quê. Juntos viram especificação executável.

Existe porque, nestas seis rodadas, **a falha nunca esteve na afirmação — esteve na premissa que ninguém escreveu.** O `RESET ROLE` é o caso puro: *"SET ROLE restringe o current_user"* era verdade; *"e a identidade de sessão não é mais privilegiada"* nunca foi escrita nem checada.

---

## 1. O que muda por causa do banco — a tabela que você pediu

| Tema | SQL Server (herz) | Postgres | Impacto |
|---|---|---|---|
| **Licença** | Paga | Gratuita | **A razão da troca** |
| Driver | `MssqlDialect` + `tedious` | `PostgresDialect` + `pg` **^8.23.0** | Troca direta — ver §4.6 |
| **Concorrência otimista** | `rowversion` — coluna binária que o motor incrementa sozinho | **Não existe equivalente.** Ver §4.1 | **Reescrita** |
| Leitor não bloqueia escritor | `READ_COMMITTED_SNAPSHOT ON` | **MVCC é o padrão** | **Some.** Uma linha de config a menos |
| Instante | `datetime2(3)` UTC | `timestamptz` | Troca, com armadilha em §4.3 |
| Dinheiro | `decimal(19,4)` | `numeric` | Ver §4.4 — e o bug do driver **inverte de lado** |
| Schema | `dbo.` | `public.` ou schema nomeado | Cosmético |
| Índice filtrado | `filtered index` | `partial index` | Mesma coisa, sintaxe melhor |
| **Captura de fila** | `WITH (UPDLOCK, READPAST)` | **`FOR UPDATE SKIP LOCKED`** | **Simplifica muito.** §5.1 |
| Aviso de mudança | Só polling | **`LISTEN`/`NOTIFY`** | Novo — com ressalva em §5.2 |
| Segurança de linha | RLS existe, pouco usado | **RLS + role restrita** | **Ganho real.** §4.6 |
| Busca em português | Full-text pesado | `unaccent` + dicionário `portuguese` | Ganho |
| Deploy | Windows Server, IIS, ARR, WinSW | Container | Some a metade mais frágil do herz |

**O que se perde:** nada que o herz usasse. O backend nunca foi construído — não há migração, só decisão livre.

---

## 2. Frontend — herdado do herz, que é real e funciona

Estes números são o que está **instalado**, não o que o documento afirma.

| Papel | Escolha | Versão |
|---|---|---|
| Framework | React | 19.2 |
| Build | Vite | 8.2 |
| Linguagem | TypeScript, `strict` + `noUncheckedIndexedAccess` | 6.0 |
| Rotas | TanStack Router, **code-based**, search validado por Zod | 1.170 |
| Dados | TanStack Query | 5.101 |
| Tabela | TanStack Table | 8.21 |
| Estilo | Tailwind, CSS-first | 4.3 |
| Componentes | **shadcn/ui sobre `@base-ui/react`**, style `base-nova` | 1.6 |
| Ícones | Lucide, família única | 1.28 |
| Formulário | react-hook-form + `@hookform/resolvers` + Zod | 7.83 |
| Toast | sonner | 2.0 |
| Paleta ⌘K | cmdk | 1.1 |
| Tema | next-themes, `attribute="class"` | 0.4 |
| Fonte | `@fontsource-variable/geist` — **self-host, nunca CDN** | 5.3 |

> ⚠️ **Não é Radix.** O painel do alicerce diz "shadcn/ui + Radix"; o herz usa Base UI e Radix só entra transitivamente pelo `cmdk`. A realidade vence o documento.

**A animação vem de graça** — `tw-animate-css` + data-attributes do Base UI (`data-open`, `data-closed`, `data-starting-style`, `data-swiping`). Zero `@keyframes`, zero framer-motion.

**Corrigir ao portar:** `components.json` diz `baseColor: neutral` e o CSS é zinc — o próximo `shadcn add` reintroduz cinza puro. Fixar em `zinc`.

---

## 3. Contrato — oRPC, não ts-rest

> **Mudança em relação ao herz.** ADR 0011 do prumo, 24/08, supersede a linha de contrato.

`@orpc/contract` · `@orpc/server` · `@orpc/openapi` · `@orpc/client` · `@orpc/tanstack-query` — **1.15.0**.

Mantém tudo pelo que o ts-rest tinha sido escolhido:

- **Contract-first.** Um objeto em `packages/contract`; o servidor implementa com `implement(contract)` e o cliente do browser é construído do mesmo objeto. **Divergência é erro de compilação nas duas pontas.**
- **Semântica HTTP real.** `ORPCError` carrega `status`, o mapa padrão cobre 400/401/403/404/409/422/429/503, e `status` é sobrescrevível — é assim que um código fora do mapa padrão (402, por exemplo) fica possível.
- **OpenAPI gerado A PARTIR do contrato**, nunca o contrário.
- Adaptador oficial de Fastify e integração oficial com TanStack Query.
- `npm install` resolve sem peer conflict e sem override.

**Por que abandonar ts-rest:** no herz, `validateResponse: true` é **silenciosamente ignorado** quando se passa um `api` customizado — a validação teve de ser refeita à mão em `cliente.ts:16-30`. O herz nunca sentiu o resto do problema porque o backend nunca existiu.

### Primitivos compartilhados

| Primitivo | Forma |
|---|---|
| Erro | **Problem Details RFC 9457**, `type` estável e classificável sem ler mensagem |
| Idempotência | `commandId` UUID **gerado pelo cliente**, em toda mutação — ver §3.1 |
| Concorrência | `version` — ver §4.1 |
| Instante | ISO 8601 **com offset**, sempre |
| Paginação/filtro/ordenação | Um primitivo só, compartilhado |

**Zero dependência de Node no pacote de contrato** — senão o bundle do browser quebra.

### 3.1 Idempotência — `commandId` sozinho não é idempotência

Um campo trafegando não impede o backend de processar duas vezes. A invariante é de banco:

`UNIQUE (scope, commandId)` mais `requestHash`, `resultado` e `criadoEm` persistidos.

| Situação | Resultado |
|---|---|
| Mesmo `commandId`, mesmo hash | **Replay** do resultado guardado |
| Mesmo `commandId`, hash diferente | **Erro** — é outro comando com id reaproveitado |
| Dois concorrentes, o primeiro **em voo** | Um executa; o segundo recebe `409 IN_PROGRESS` e **não espera** |
| Segundo chega **depois do commit** | **Replay** — o registro concluído existe |

> **A invariante unificada.** Toda mutação idempotente que produza efeito externo persiste **estado de negócio, registro de idempotência e linha de outbox na mesma transação.**

```
comando chega
     ↓
já concluído?
 ┌───┴────┐
sim      não
 ↓        ↓
replay   BEGIN
         claim commandId
         altera domínio
         grava estado de negócio
         grava linha de outbox
         grava resultado da idempotência
         COMMIT
```

**No replay: zero alteração de domínio e zero linha nova de outbox.** Sem isso, a idempotência do banco existe e o efeito externo duplica assim mesmo — que é exatamente o que ela deveria impedir.

**Teste de integração obrigatório:** 500 requests concorrentes, mesmo `commandId`, mesmo payload →

```
1 mutação de negócio
1 linha de outbox
nenhuma execução duplicada
pico de conexões do banco ≤ limite declarado   ← sem esta, o teste aprova um DoS
nenhuma duplicata espera segurando recurso     ← a propriedade, não a contagem de status
pico de pool.waitingCount ≤ limite declarado
requests pendentes ao final = 0
```

> ⚠️ **Uma linha de outbox não é um efeito externo.** O outbox é **at-least-once por construção**: o worker envia, o destinatário recebe, o processo morre antes de marcar entregue, e no restart envia de novo.

| Camada | Garantia |
|---|---|
| Retry de API | **não** cria segunda linha de outbox |
| Retry do outbox | **pode** reenviar a mesma linha |
| Consumidor | **deve** deduplicar por `outboxId` |

Só com cooperação do destinatário o efeito externo se aproxima de exactly-once. Onde ele não coopera, isso vira decisão consciente e escrita — nunca suposição.

### Duplicate-in-flight — decisão, não subproduto do teste

`A` está executando; `B` chega com o mesmo `commandId`. Duas semânticas válidas: **esperar e replicar**, ou responder `409`/`202 em andamento` e deixar o cliente tentar de novo.

~~**Candidata rejeitada: esperar e replicar.**~~ Parecia API mais simples para o agente e para o frontend.
**Foi descartada** pelo motivo do quadro abaixo: a espera consome conexão do pool antes de qualquer timeout
de HTTP valer.

**Escolhido: fail-fast.** O segundo request **não espera** — devolve a conexão.

A ordem importa, e são três passos, não um:

```
1. registro concluído existe?           → sim  → REPLAY
2. pg_try_advisory_xact_lock(…)         → false → 409 IN_PROGRESS, devolve a conexão
3. adquiriu o lock                      → RECHECK — outro pode ter commitado entre 1 e 2
                                        → só executa se ainda não existir
```

> ⚠️ **O recheck do passo 3 não é opcional.** Sem ele, dois requests que passam pelo passo 1 antes do commit
> de A executam os dois — o lock serializa, não impede.
>
> E **o critério de aceite não conta status.** Num teste de 500 concorrentes, escalonamento faz alguns
> chegarem depois do commit e receberem replay legitimamente. A propriedade é *nenhuma duplicata espera
> segurando recurso*, nunca *499 recebem 409*.

> ⚠️ **A espera precisa de teto.** 500 requests com o mesmo `commandId`, o primeiro travando 25 s, todos segurando conexão HTTP e do pool: a idempotência vira vetor de esgotamento de recurso. Numa stack para agentes isso é pior, porque um laço errado gera duplicata em volume.

> ⚠️ **Espera limitada no HTTP não resolve.** Como registro de idempotência, mutação e outbox vão na mesma
> transação, o segundo `INSERT` do mesmo `commandId` **bloqueia no índice único** esperando a primeira transação
> terminar. A conexão já foi consumida; timeout de HTTP não devolve conexão que o Postgres está segurando.
> Com 500 duplicatas: 1 trabalhando, **499 conexões do pool paradas.**

**A invariante:** duplicate-in-flight **nunca espera indefinidamente — nem no PostgreSQL, nem no pool, nem na
borda HTTP.** Limitar só o banco deixa 490 requests na fila do pool: com `max: 10`, dez pegam client e o resto
vai para a `pending queue` do `pg-pool`. São três tetos, e os três precisam existir:

```
orçamento de concorrência HTTP
        ↓
teto da fila da aplicação
        ↓
pool max + connectionTimeoutMillis     ← sem o timeout, a fila não tem timer
        ↓
pg_try_advisory_xact_lock             ← só este protege o banco
```

```
A  →  pg_try_advisory_xact_lock(NS_IDEMPOTENCIA, hash32(scope, commandId))  →  true   →  executa
B  →  mesma chave                                         →  false  →  devolve a conexão
                                                              →  409 · Retry-After
```

Doc: *"either obtain the lock immediately and return `true`, or **return `false` without waiting**"*.

Três premissas que precisam estar escritas, porque cada uma falha em silêncio:

1. **Variante `_xact_`, obrigatoriamente.** A de sessão vazaria entre requests na conexão reaproveitada do pool.
   E a propriedade que sustenta o desenho é mais forte que "mesmo instante": em `CommitTransaction()` a ordem é
   `RecordTransactionCommit()` → `ProcArrayEndTransaction()` → `ResourceOwnerRelease(RESOURCE_RELEASE_LOCKS)`.
   **O estado de commit é publicado antes da liberação dos locks de transação** — logo, quando B adquire o lock
   que A soltou, A já saiu do proc array. *(Camada dona: PostgreSQL, `xact.c`.)*
2. **O lock vem antes do `INSERT`**, chaveado no mesmo escopo do índice único. Fora de ordem, B ainda bloqueia.
3. **Forma de dois `int4`, nunca de um `bigint`.** O PostgreSQL mantém **dois espaços de lock que não se
   sobrepõem**: `(bigint)` e `(int4, int4)`. As migrations do prumo já usam o primeiro —
   `pg_advisory_lock(8_140_772_301)` em `migrate.ts:43,53,58,81`, com o comentário *"Any other process using
   this same key would be a bug"*. Se a idempotência hashear para `bigint`, um comando pode colidir com o lock
   de migration e travar um deploy. Usar `pg_try_advisory_xact_lock(NS_IDEMPOTENCIA, hash32(…))` transforma
   improbabilidade em **impossibilidade estrutural entre classes de lock**.
4. **Colisão dentro do namespace é aceitável.** Dois comandos podem hashear igual; o custo é um `409` espúrio.
   **A correção continua no índice único** — o lock é só o caminho rápido. Quem não souber disso vai
   "consertar" a colisão removendo o lock, e o furo do pool volta. Registrado aqui como decisão — um teste que decide arquitetura sem o documento perceber é a classe de coisa que esta Stack existe para impedir.

### 3.2 O hash — canonicalização definida pelo contrato

`{"a":1,"b":2}` e `{"b":2,"a":1}` são o mesmo pedido e produzem hashes de texto diferentes. Mas a correção não é ordenar chaves na mão:

```
contract parse
  ↓
normalização semântica  ← NFC apenas onde o contrato declarar
  ↓
projeção JSON-safe
  ↓
RFC 8785 (JCS)
  ↓
hash
```

> ⚠️ **O RFC 8785 não normaliza Unicode** — ele preserva as strings. `é` como `U+00E9` e `e` + acento combinante são visualmente idênticos, byte-distintos, e geram hashes diferentes. NFC vai **antes** do JCS, e **não em tudo**: nome de arquivo, chave criptográfica e identificador externo podem depender dos bytes exatos. O contrato marca quais campos têm semântica de texto humano.

Duas razões para cada etapa:

1. **Depois do parse, não antes.** Quem decide se `{"quantidade":1}` e `{"quantidade":1,"campoIgnorado":"x"}` são o mesmo comando é o **schema**, não o hash. Se o contrato faz `strip`, os dois são idênticos.
2. **Projeção JSON-safe antes do JCS.** O Zod devolve objeto JavaScript, que carrega `undefined`, `Date`, `bigint`, `NaN` e `Infinity` — nada disso existe no modelo JSON sobre o qual o RFC 8785 opera.

**E o contrato declara explicitamente o que entra na identidade do comando.** `correlationId`, `clientTimestamp` e metadado de trace são válidos no request e **não** tornam o comando diferente. Hash sobre o payload inteiro faz dois retries com trace distinto virarem comandos distintos, e a idempotência deixa de existir.

Logo: `idempotencyPayload(input)` como **projeção explícita**, versionada junto do contrato e testada. Nunca o payload inteiro, nunca canonicalização caseira.

> **A idempotência precisa sobreviver a deploys.** Se uma mudança de versão pode converter um retry em nova
> execução, a chave não está identificando o **comando** — está identificando a **implementação que o processou**.

`UNIQUE (scope, commandId)` **estável entre versões**. A versão é **atributo do registro**, nunca parte da chave.

| Situação | Comportamento |
|---|---|
| Mesma versão · mesmo hash | **Replay** |
| Mesma versão · hash diferente | **Erro** — key reutilizada |
| **Versão diferente** | **Nunca executa.** Replay histórico, ou `version_mismatch` explícito |

Quem quer mesmo uma operação nova em `v2` **gera um `commandId` novo**.

> ⚠️ **O caso que quase passou.** Versão no escopo *parece* certo e cria cobrança dupla:
> `charge/v1/ABC` executa às 10:00, a resposta se perde, sai o deploy, o retry às 10:05 vira `charge/v2/ABC`,
> não encontra registro e **cobra de novo** — no exato momento em que respostas mais se perdem.
>
> Só funciona se `operationVersion` for **campo do cliente**, imútavel e carregado em todo retry, **declarado no
> contrato**. Nunca inferido da versão do servidor em execução.

### TTL — parte do contrato, não faxina

`UNIQUE (scope, commandId)` para sempre faz a tabela crescer sem limite. E o conserto ingênuo cria o pior bug
possível:

```
DELETE FROM comandos WHERE criado_em < now() - interval '30 days';
        ↓
retry antigo chega  →  não encontra o commandId  →  EXECUTA DE NOVO
```

Duas retenções, não uma:

| O quê | Retenção |
|---|---|
| **Resultado detalhado** (payload, hash, resposta) | TTL curto — é o que pesa |
| **Lápide**: `scope` · `commandId` · `commandStatus` · `completedAt` | Muito longa, ou permanente em operação sensível |

Apagar o payload é faxina. Apagar a lápide é **reabrir a janela de execução dupla**, e o TTL da lápide tem de ser
maior que qualquer retry que o cliente possa emitir.

### O replay cross-version — desfecho estável, não resultado tipado

> **`version` como discriminador só funciona se o contrato contiver os schemas que ele pode selecionar.**
> Sem isso, é `result: unknown` com nome bonito — um buraco de tipo exatamente na idempotência.

Duas coisas separadas:

| | Estável entre versões? | Conteúdo |
|---|---|---|
| **Desfecho idempotente** | **Sim** | `commandId` · `commandStatus` · `effectStatus` · `outboxId` · `operationVersion` · `resourceId?` · `completedAt` |
| **Resultado da operação** | Não — tipado por versão | O objeto de resposta daquela versão |

- **Mesma versão** → desfecho estável **mais** o resultado original tipado.
- **Cross-version** → **só o desfecho estável.** Basta para dizer *"já executou, não execute de novo"*. Quem
  precisar do estado atual **busca o recurso** na forma corrente — nunca há tradução de forma histórica.

> ⚠️ **`commandStatus` não é `effectStatus`.** A transação de negócio commita **antes** de o efeito externo ser
> entregue — essa é a premissa inteira do outbox. Um desfecho que diga só `status: completed` faz o cliente ler
> *"a cobrança saiu"* quando o que concluiu foi o commit local, e o webhook pode estar na fila morta.
>
> `commandStatus: committed` · `effectStatus: pending | delivered | dead` · `outboxId`. O `resourceId` continua
> útil onde existe, mas **não é base universal do contrato**.

**Por que isso importa.** Um `commandId` sobrevive a deploy; a normalização não. Se `v1` tem `quantity` default `1` e `v2` tem `10`, o mesmo payload bruto produz hashes diferentes — e numa janela de idempotência longa isso vira falso conflito ou replay indevido. Persistido junto: `operation`, `idempotencySchemaVersion`, `requestHash`. Comparação de hash só vale **dentro da mesma versão**; versão diferente é tratada explicitamente, nunca comparada às cegas.

---

## 4. Banco — PostgreSQL 17

> ADR 0005 do prumo. **`pgcrypto` sai** — a doc dele chama o próprio `gen_random_uuid()` de
> *"Obsolete, this function internally calls the core function of the same name"*. Uma extensão a menos
> é um conjunto inteiro de funções fora da superfície de ACL. `citext` para e-mail continua.
> Kysely **^0.29.5** + `pg` **^8.23.0** — o ADR 0005 diz "0.28 / 8.13" e ficou atrás do
> `package.json`; vence o código. **Um pool, uma API de transação, um `UnitOfWork`** como
> único lugar onde transação abre.
>
> **Não existe caminho SQLite.** Nem "depois", nem "para teste", nem "para modo
> single-user". SQLite não tem lock de linha para pular, não tem `LISTEN`/`NOTIFY`,
> não tem RLS, não tem operador `jsonb` nem índice parcial sobre expressão. Um modo
> SQLite seria uma segunda implementação do desenho de concorrência — e o desenho de
> concorrência é o produto.

### 4.1 Concorrência otimista — a reescrita de verdade

O `rowversion` do SQL Server é uma coluna binária de 8 bytes que **o motor incrementa sozinho** em todo `UPDATE`. Postgres não tem isso.

Três candidatos, e só um presta:

| Opção | Veredito |
|---|---|
| `xmin` (coluna de sistema) | **Não.** É o id da transação; sofre wraparound e muda em `VACUUM FULL`. Usar como token de concorrência é bug esperando data |
| `updated_at timestamptz` | **Não.** Duas escritas no mesmo microssegundo colidem em silêncio |
| **Coluna `version bigint` explícita** | **Sim.** Incrementada no próprio `UPDATE` condicional |

```sql
UPDATE pedido
   SET estado = $1, version = version + 1
 WHERE id = $2 AND version = $3
RETURNING version;
```

Zero linha afetada = conflito = **`409`, nunca retry automático**. Essa parte é herdada intacta do herz e continua certa.

> ⚠️ **O incremento não pode depender de memória.** O `SET version = version + 1` protege *aquele* UPDATE. Um
> agente escreve `UPDATE pedido SET estado = 'cancelado' WHERE id = $1` e a proteção inteira morre **sem erro**
> — exatamente o que o primeiro princípio proíbe.
>
> Por isso o incremento vira **trigger `BEFORE UPDATE`**: `NEW.version := OLD.version + 1`. O
> `WHERE version = $token` continua sendo a barreira otimista, mas incrementar deixa de ser lembrança e passa a
> ser propriedade da tabela. Regra determinística: **tabela com coluna `version` sem o trigger reprova.**

Exposto no contrato como valor **opaco e branded** — o cliente devolve o que recebeu, nunca constrói nem compara.

### 4.2 O que some

`READ_COMMITTED_SNAPSHOT ON` era metade do sintoma de lentidão do sistema antigo do herz. **No Postgres MVCC é o padrão**: leitor nunca bloqueia escritor. Uma decisão a menos, sem contrapartida.

### 4.3 Tempo

`timestamptz` sempre — **nunca `timestamp`**. O Postgres guarda em UTC internamente e converte na exibição conforme o `TimeZone` da sessão.

- `SET TimeZone = 'UTC'` no boot, verificado por teste.
- Fuso de **exibição** é decisão de interface, não de banco.
- Relógio injetável no domínio; `Date.now()` proibido fora de `relogio.ts`.

### 4.4 Dinheiro — e o bug do driver inverte de lado

No herz havia uma armadilha real: **o `tedious` devolve `decimal` como `number` do JavaScript por padrão**, e a precisão que o SQL Server guardou se perde na fronteira do driver, em silêncio.

**O `pg` faz o contrário: devolve `numeric` como string por padrão.** É o comportamento seguro, e é ganho líquido.

**Mas o ganho vale só para o escalar, e só no protocolo texto.** Quatro armadilhas, todas com teste:

1. `pg` devolve **`bigint` (`int8`) como string**. Esperar `number` quebra.
2. `pg` devolve `float8` como `number` — nunca float no caminho do dinheiro.
3. **`numeric[]` volta como `number[]`.** O OID 1231 tem parser registrado, e é `parseFloatArray` — cada
   elemento passa por `parseFloat`. Um `array_agg(valor)` perde precisão **em silêncio**. Agregue como
   `text[]` ou `jsonb` de string.
4. **`binary: true` no Pool reverte o escalar.** O OID 1700 tem parser binário que termina em
   `Math.round(result * scale) / scale`. A flag é proibida no caminho do dinheiro, e isso vai em teste.

> Teste de fronteira que só cobre `SELECT valor` aprova o driver e libera o `array_agg`. O teste afirma
> `typeof` sobre uma **linha real**, com agregado.

**Regra:** nada de float em nenhum ponto do caminho do dinheiro — nem no domínio, nem em payload `jsonb`, nem em gráfico.

> ⬜ **A decidir:** unidade de armazenamento. O painel do alicerce diz *"inteiro em centavos"*; o herz usa *string decimal*; o ADR 0003 do prumo escolhe **inteiro em nano-USD**, porque em precificação de API há valores de US$ 0,0005 que truncam para zero em centavos. Para site e app genéricos, centavos basta. **O preset decide, e a decisão vira campo do perfil.**

### 4.5 Migrations

- **Kysely + `kysely-ctl`.** Módulo TS exportando `up`/`down`, com SQL explícito dentro.
- Nome `YYYYMMDDHHMM_descricao.ts` — numeração frouxa quebra na décima.
- **Rodam no boot, sob advisory lock** (ADR 0005) — duas instâncias subindo juntas não corrompem.
- **Migration existente nunca é editada.** Sempre nova.
- `kysely-codegen` roda contra banco **reconstruído pelas migrations em CI**, nunca contra produção. Produção é *comparada* com o git, jamais usada para redefini-lo.

### Reversibilidade — e por que `down` sem perda é ficção

Exigir que **toda** migration reverta sem perda obriga o agente a fabricar uma sensação de reversibilidade. `DROP COLUMN cpf` não reverte. A política real:

| Tipo | Regra |
|---|---|
| Reversível | **Testa o `down`** — subir, descer, subir com linha semeada, afirmar zero perda |
| Destrutiva | **Forward-only**, com expand/contract |

### Duas coisas diferentes que costumam virar sinônimo

**Forward-only é estratégia de migration. Expand/contract é estratégia de compatibilidade entre versões.** O advisory lock impede duas migrations simultâneas; ele **não** resolve `N` e `N+1` coexistindo durante rolling deploy.

```
Migration A — EXPAND
  adiciona estrutura nova, compatível com a versão antiga
        ↓
  App N e N+1 coexistem
        ↓
  backfill
        ↓
  App N desaparece
        ↓
Migration B — CONTRACT
  remove estrutura antiga
```

- **Teste de migration com dado existente** — o próprio alicerce chama de *"a verificação mais esquecida do catálogo"*.

### 4.6 Privilégio — o ganho que o SQL Server não dava de graça

> ADR 0013 do prumo, e é a parte mais forte do desenho.

### Três identidades, não duas — e o porquê

> **A regra:** o runtime nunca autentica com credencial de privilégio superior a `app`.
> **`RESET ROLE` deve reduzir privilégio, ou no pior caso mantê-lo — jamais elevá-lo.**

`SET ROLE` reduz o `current_user`. **Não apaga a identidade que abriu a sessão.** E a documentação do PostgreSQL é explícita nos dois pontos que fecham o caso:

> *"`RESET ROLE` sets the current user identifier to the **connection-time setting** specified by the
> command-line options, `ALTER ROLE`, or `ALTER DATABASE`, if any such settings exist. **Otherwise**,
> `RESET ROLE` sets the current user identifier to the current session user identifier."*
>
> ⚠️ **A primeira oração decide o caso, e vinha elidida.** Toda a arquitetura depende de **não existir**
> connection-time setting de `role`. São três vetores, e só um passa por `ALTER ROLE`:
>
> | Vetor | Onde mora |
> |---|---|
> | `ALTER ROLE app_login SET role = app` | SQL — já proibido abaixo |
> | `ALTER DATABASE <db> SET role = app` | SQL — **não estava coberto** |
> | `options=-c role=app` na connection string, ou `PGOPTIONS` | **configuração de deploy, nenhum SQL** |
>
> O terceiro é o perigoso: é o que alguém acrescenta para "resolver" um erro de permissão sem tocar em SQL,
> e o teste hostil continua **verde**.
> *"These forms can be executed by **any user**."*

`RESET ROLE` **não é privilegiado**. Qualquer código com SQL cru emite aquilo — e um agente tentando resolver um erro de permissão escreve exatamente isso.

**O defeito medido no `prumo`, hoje:** `DATABASE_URL=postgres://prumo:…`, e `POSTGRES_USER: prumo` é o **superusuário do cluster**. Os dois pools — migration e aplicação — usam a mesma string. Logo `session_user = prumo` (superuser) e `current_user = prumo_app`. Um `RESET ROLE` devolve superusuário, com RLS contornada e DDL disponível. O teste afirma só `current_user`.

| Identidade | Configuração | Papel |
|---|---|---|
| `db_owner` | dono do schema | migrations, **nunca** usado pelo runtime |
| `app` | `NOLOGIN` · `NOSUPERUSER` · `NOBYPASSRLS` · `NOCREATEDB` · `NOCREATEROLE` | DML. Sem DDL |
| `app_login` | `LOGIN` · **`NOINHERIT`** · zero privilégio **de aplicação** | só serve para autenticar |

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;  -- PostgreSQL 16+
```

> ⚠️ **Não usar `ALTER ROLE app_login SET role = app`.** Parece reforço e é o contrário: o `RESET ROLE` passaria a cair em `app`, que **tem** o DML — e o teste hostil abaixo deixaria de fazer sentido. As duas arquiteturas são válidas isoladamente e **não se misturam**. Escolhida a que falha fechado.

**`INHERIT FALSE` é a peça que faz funcionar.** Com `INHERIT TRUE`, o `app_login` teria os privilégios de `app` automaticamente e o `RESET ROLE` o deixaria com o DML. Com `INHERIT FALSE`, ele não tem nada até fazer `SET ROLE` explícito:

```
estado normal     session_user = app_login    current_user = app
RESET ROLE    →   current_user = app_login    →  fail closed
```

A escapatória **reduz** privilégio. Melhor que tentar impedir `RESET ROLE`, porque não depende de impedir nada.

### `PUBLIC` — o privilégio que ninguém concedeu

`app_login` **nunca teve zero privilégio**. A doc do PostgreSQL (`ddl-priv`):

> *"`CONNECT` and `TEMPORARY` privileges for databases; `EXECUTE` privilege for **functions and procedures**; and `USAGE` privilege for languages and data types."*

O caminho de escalada é `SECURITY DEFINER`: função criada pelo owner, `EXECUTE` para `PUBLIC` por padrão, **executa com os privilégios do dono**. Um `app_login` sem DML a chama.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE TEMP ON DATABASE <db> FROM PUBLIC;   -- se não usar tabela temporária
```

Duas armadilhas práticas:

- **`ALTER DEFAULT PRIVILEGES` só afeta o futuro.** Função que já existe precisa de `REVOKE` explícito. A doc recomenda o revoke **na mesma transação que cria o objeto**, "para que não haja janela".
- **As extensões quebram no dia 1.** `citext` cria funções com `EXECUTE` para `PUBLIC`; revogar em bloco tira `citext_eq`, `citext_cmp` e os operadores de comparação — e a igualdade case-insensitive de e-mail para de funcionar. *(`gen_random_uuid()` **não** serve de exemplo: é função core em `pg_catalog`, não criada por `db_owner`, logo imune ao `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner`.)* O revoke vem junto de `GRANT EXECUTE` explícito para `app` na lista curta do que ela usa — o que é bom, vira lista versionada, mas se não for previsto o primeiro deploy quebra e alguém reverte o endurecimento inteiro por pressa.

### Extensões — `ALTER DEFAULT PRIVILEGES` não alcança

Doc do `CREATE EXTENSION`:

> *"the extension object itself will be owned by the calling user, but **the contained objects will be owned
> by the bootstrap superuser** (unless the extension's script explicitly assigns them to the calling user)."*

Vale para **extensão *trusted* instalada por role *não-superuser*** — não para toda extensão. Normalmente quem
roda `CREATE EXTENSION` vira dono. Mas `citext` **é trusted** (*"can be installed by non-superusers who have
`CREATE` privilege"*), então o caso nos atinge.

A auditoria é obrigatória nas **duas** configurações, por motivos opostos:

| Quem instala | Dono dos objetos | Problema |
|---|---|---|
| Superusuário (o compose de hoje) | o próprio superusuário | ACL de objeto de superusuário, com `PUBLIC EXECUTE` |
| `db_owner` não-superuser (alvo) | **bootstrap superuser** | `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` não alcança |

Logo: **enumerar ACL depois de `CREATE EXTENSION` e depois de todo upgrade**, comparando com whitelist.
Fitness test, não linha de migration.

### `SECURITY DEFINER` — regra determinística

Revogar `EXECUTE` não basta. Quatro condições, todas verificáveis por catálogo, classe **determinística**
(nasce `error`):

```
search_path seguro declarado, com pg_temp por último
PUBLIC sem EXECUTE
owner explícito
grant em whitelist
```

### O teste hostil — catálogo **e** execução

Checar `current_user` prova que a configuração foi aplicada. Só o teste hostil prova que **a fuga não funciona**.

```sql
-- catálogo: capacidade efetiva, não atributo
pg_has_role('app_login', 'db_owner', 'SET')                   → false
pg_has_role('app_login', 'app',      'USAGE')                 → false  -- INHERIT FALSE
pg_has_role('app_login', 'app',      'SET')                   → true
has_table_privilege('app_login', 'public.pedido', 'SELECT')   → false
session_user = app_login · não superuser · não BYPASSRLS · não CREATEDB · não CREATEROLE
current_setting('role', true)  →  nulo ou vazio     ← senão o RESET cai em app

-- comportamento: a fuga não funciona
RESET ROLE  → SELECT protegido → PERMISSION DENIED
SET ROLE db_owner              → PERMISSION DENIED
```

### Privilégios da role `app`

Recebe `SELECT/INSERT/UPDATE/DELETE` nas tabelas e `USAGE, SELECT` nas sequences, mais `ALTER DEFAULT PRIVILEGES` para herdar nas tabelas futuras. **Nenhum DDL.**

### A barreira de aquisição — `onConnect`, nunca `pool.on('connect')`

```ts
new Pool({
  onConnect: async (client) => {
    await client.query(`SET ROLE ${role}`)
    await client.query(`SET TIME ZONE 'UTC'`)
  },
})
```

> **A segurança não depende de ordenação, de query queue, de pipelining nem da propagação de erro entre comandos.** `onConnect` constitui uma **barreira de aquisição**: o client só se torna adquirível depois de a inicialização privilegiada concluir **com sucesso**; se ela falha, a conexão é destruída e o `acquire` rejeita.

Confirmado em `pg-pool@3.14.0:288-301` — `_promiseTry(() => onConnect(client)).then(ok → _afterConnect, err → filtra do pool, client.end(), rejeita o acquire)`.

**Por que `pool.on('connect')` não serve**, mesmo emitindo `error` na falha: o client **já foi entregue**. Três coisas que não sustentam a fronteira:

| Suposição | Realidade |
|---|---|
| "A fila serializa, então `SET ROLE` roda primeiro" | Roda — mas `Client.queryQueue` está **depreciado com remoção marcada no `pg@9.0`**, e disparar `client.query()` com outra em execução também |
| "Com `pipeline: true` o erro aborta as seguintes" | **Falso para este driver.** O `pg` manda **Sync por query** (`lib/query.js:198-201`), então cada uma tem error boundary próprio: `SET ROLE` falha, `SELECT segredo` executa |
| "Ordem basta" | Ordem nunca foi o problema. O problema é **ausência de barreira**: nada impede o uso antes de o resultado da inicialização ser validado |

> ⚠️ **Shim de tipo, temporário.** O `@types/pg` 8.23.1 declara `onConnect?: ((client: ClientBase) => void)` — **sem `Promise`** — enquanto a doc do node-postgres declara `(client: Client) => void | Promise<void>`. Funciona em runtime porque o `pg-pool` embrulha em `_promiseTry`, mas o tipo não expressa o contrato. Wrapper tipado local, marcado como shim, removido quando o `@types/pg` corrigir.

**Versão:** `pg ^8.23.0`. O `onConnect` entrou no **8.20**; o `8.19` depreciou a fila interna. A sequência do próprio projeto é *"não façam mais isso"* → *"façam assim"*.

### Separação de pools

Migrations rodam como owner, num **pool separado e curto**, fechado antes de o pool da aplicação nascer. A separação é fronteira de segurança, não arrumação.

Teste afirma `current_user`, `rolsuper`, `rolbypassrls` e `current_setting('TimeZone')` diretamente, antes de a aplicação ser considerada saudável.

### 4.7 Tipos e invariantes

- Quantidade discreta: `integer`.
- Invariante no banco: `CHECK`, `FK`, `UNIQUE` — *"código é uma porta; banco é a última"*.
- **Toda FK indexada.** No sistema antigo do herz não havia um único índice além dos de `UNIQUE`, e era isso que tornava o dashboard quadrático.
- Índice parcial e composto conforme o modelo.

### 4.8 Português — decisão que o painel não tem

- **Collation.** `ORDER BY nome` com acento em pt-BR sem collation ICU correta ordena errado, em silêncio. Declarar no `CREATE DATABASE` e verificar no boot.
- **Busca:** `unaccent` + dicionário `portuguese` para full-text.
- Encoding `UTF8`, verificado no boot junto com a collation.

---

## 5. Assíncrono

### 5.1 Outbox — e a simplificação que o Postgres dá

Regra herdada e inegociável: **nenhum I/O externo dentro de transação.** Efeito externo vira linha na outbox, no mesmo commit; entrega vem depois.

A captura da fila, que no SQL Server exigia `WITH (UPDLOCK, READPAST)`:

```sql
-- TX 1: captura. O predicado PRECISA ler o lease.
SELECT id, payload
  FROM outbox
 WHERE entregue_em IS NULL
   AND tentar_apos <= now()
   AND (lease_until IS NULL OR lease_until <= now())   -- sem isto, reenvio a cada tick
   FOR UPDATE SKIP LOCKED
 LIMIT $1;

UPDATE outbox
   SET lease_until = clock_timestamp() + $2, lease_by = $3
 WHERE id = ANY($4);
COMMIT;
```

`FOR UPDATE SKIP LOCKED` é nativo, legível, e resolve captura atômica sem hint proprietário. **A parte mais frágil do desenho do herz vira SQL padrão.**

### As três fases, e por que o diagrama é obrigatório

Mostrar o `SELECT ... FOR UPDATE SKIP LOCKED` e depois "falar de entrega" convida exatamente o erro que a regra nº 1 proíbe: um agente lê aquilo e escreve `BEGIN → pegar com lock → chamar API → marcar entregue → COMMIT`, segurando transação durante I/O externo.

```
TX 1
  claim dos jobs
  SET lease_until
COMMIT

        ↓  SEM TRANSAÇÃO

  HTTP · e-mail · webhook

        ↓

TX 2
  UPDATE outbox SET entregue_em = now()
   WHERE id = $1 AND lease_by = $2 AND lease_until > now()
COMMIT
```

**claim → commit → I/O → acknowledge.** O diagrama fica no ADR nessa forma quase visual, porque é difícil um
agente inventar outra coisa olhando para ele.

> ⚠️ **Três coisas que o desenho ingênuo erra, e as três são silenciosas.**
>
> **1 · O lease precisa estar no predicado.** Depois do COMMIT de TX 1 o lock de `FOR UPDATE` morre, e
> `SKIP LOCKED` só pula linha travada por transação **aberta**. Sem `AND (lease_until IS NULL OR
> lease_until <= now())`, a linha volta a satisfazer o predicado e sai de novo **a cada tick do poller**
> enquanto o I/O está em voo. Isso não é o at-least-once declarado — é N envios por segundo por worker.
>
> **2 · TX 2 valida posse.** Se o lease expirou durante o I/O, dois workers escrevem por cima um do outro —
> e um `500` tardio de W2 pode mandar para a fila morta uma mensagem que W1 **entregou**. Zero linhas
> afetadas significa *"perdi o lease: não escrevo, não incremento tentativa, apenas logo"*.
>
> **3 · `now()` não avança dentro da transação.** É `transaction_timestamp()`. Numa captura em lote de 10
> com chamadas de 5 s, o décimo item recebe lease já vencido. Usar `clock_timestamp()` ao gravar, ou um
> item por transação.
>
> **Consequência de teste:** o lease é medido pelo relógio do **banco**. O teste de expiração semeia
> `lease_until` no passado — nunca manipula o relógio da aplicação. Sem essa frase, o regime determinístico
> do §7 aprova um mecanismo que nunca foi exercitado.

**O outbox não preserva ordem.** Com `SKIP LOCKED` e N workers, `ORDER BY criado_em` ordena a *captura*,
nunca a *entrega*. Se alguma mensagem depende de ordem, o consumidor precisa de número de sequência por
chave de agregado — dedupe não reordena.

- Lease com prazo, backoff exponencial, fila morta após N tentativas.
- **Idempotência do consumidor é obrigatória** — reprocessamento acontece.

### 5.2 `LISTEN`/`NOTIFY` — com ressalva

Novo no Postgres, e tentador. Mas:

> **`NOTIFY` é aviso, nunca entrega.** Não é durável: se ninguém está escutando, a mensagem some. Payload limitado a 8 kB.

Uso correto: **acordar o poller da outbox** para reduzir latência. O poller continua existindo e continua sendo a garantia. Quem trocar polling por `NOTIFY` perde evento no primeiro restart.

SSE para o browser continua sendo **sinal de invalidação, não replay de evento** — igual ao herz.

---

## 6. Backend

Fastify. Camadas com direção de import imposta por `dependency-cruiser` no CI:

| Camada | Regra |
|---|---|
| `packages/contract` | oRPC + Zod. **Zero dependência de Node** |
| `domain/` | TS puro. Nenhum import de Fastify, Kysely ou contrato |
| `app/` | Casos de uso. Recebe `UnitOfWork`; toda escrita recebe `trx` |
| `http/` | Rotas: parse → caso de uso → resposta |
| `db/` | Kysely, migrations, adaptador do `UnitOfWork` |

- **Uma transação por caso de uso**, aberta só no `UnitOfWork`.
- **Retry só de falha transitória**, do caso de uso inteiro. Conflito de versão **não** é transitório.
- Config validada no boot: **o processo não sobe com env inválida.**
- Log estruturado com id de correlação; **dado pessoal mascarado na saída**.

---

## 7. Verificação

Comando único `verificar`, com **contagem de passos no cabeçalho** — `APROVADO 12/12`, para que rodar um passo só não pareça aprovação total.

| Passo | Pega |
|---|---|
| `tsc --noEmit` | Divergência de forma |
| Formatação | Ruído de revisão. **Nada de correção** |
| Lint + fronteiras | Camada cruzada, ciclo, órfão |
| Unitário de domínio | Regra de negócio errada |
| **Contrato, nos dois sentidos** | Handler que divergiu do schema |
| **Integração com Postgres real** | SQL, transação, isolamento, índice. *Mock de banco testa o mock* |
| **Migration com dado existente** | A que mais se esquece |
| Caminho de erro | 409, 422, 503, timeout |
| Segredo + CVE | Credencial commitada |
| E2E, 3 a 7 fluxos | A costura |

**Determinismo:** relógio fake, seed fixo, sem rede em unitário, cada teste cria e destrói o próprio dado, esperar por condição e nunca por duração, fuso fixado.

**CI em matriz Windows + Linux.** O defeito do `npx` sobreviveu meses no alicerce porque o CI só rodava Linux.

---

## 8. Deploy

Container. Duas services: a aplicação e `postgres:17-alpine`, dois volumes.

**Some do herz:** IIS, ARR, WinSW, e o buffering de proxy que quebrava SSE — a parte mais frágil e menos portável do desenho anterior.

---

## 9. Decisões fechadas na revisão

### 9.1 Linter — dois, de propósito

| Ferramenta | Papel |
|---|---|
| **oxlint** | Lint geral rápido |
| **ESLint pequeno** | Só as regras de política / arquiteturais próprias |
| **`tsc`** | Autoridade de type checking |

Motivo: os JS plugins do oxlint estão em **alpha**, não seguem semver, e **regras customizadas não recebem type-awareness**. Como quase toda regra arquitetural nossa é própria, não dá para depender disso ainda.

**Mas a regra de escolha não é "regra arquitetural = ESLint".** É: **use o mecanismo mais barato que consiga provar a propriedade.** `domain/` não importa `db/`, `Date.now()` proibido e `@ts-nocheck` são grafo de import ou AST simples — não precisam de tipo. Quando a API de plugin do oxlint amadurecer, o segundo linter sai.

### 9.2 Classes de regra

| Classe | Entrada | Exemplos |
|---|---|---|
| **Determinística** | nasce `error`, depois das fixtures | `domain/` importa `db/` · `@ts-nocheck` · migration antiga editada · `process.env` fora de `config/` |
| **Heurística** | nasce `warn` + contador | cor literal · raio de busca |
| **Informacional** | permanece métrica | telemetria de token · cobertura |

Duas armadilhas registradas:

1. **Warning também treina o agente.** Quarenta avisos diários viram ruído, e ruído ensina a ignorar a saída inteira. Warning é dívida de atenção, não neutro.
2. **Detecção perfeita ≠ especificação perfeita.** `http/` não acessa `db/` é matemática — até alguém precisar de import só-de-tipo de `db/tipos`, que é legítimo. Por isso: regra determinística nasce `error`, **mas o conjunto de fixtures precisa incluir o caso-limite legítimo em `aprovar/`**, não só a violação em `reprovar/`.

### 9.3 Fitness tests da arquitetura

`aprovar/` prova que a regra **não** pega caso legítimo. `reprovar/` prova que ela pega o erro. E cada fixture negativa declara, em marcador estruturado, qual regra espera disparar:

```ts
// @expect-rule sem-io-externo-no-caso-de-uso
// @expect-rule sem-ciclo
```

O harness valida quatro coisas: a regra existe no registro · cada regra declarada disparou **naquele arquivo** · nenhuma regra não declarada disparou ali · **fixture em `reprovar/` sem marcador é erro**.

Sem a terceira, uma fixture fica vermelha pelo motivo errado indefinidamente. Sem a quarta, um arquivo novo entra na pasta e não prova nada.

### 9.4 TypeScript

`strict` · `noUncheckedIndexedAccess` · **`exactOptionalPropertyTypes`**.

O último importa especialmente aqui: em PATCH com Zod e banco, a diferença entre `{ name: undefined }` e `{}` é exatamente onde nasce o bug.

### 9.5 Infraestrutura fixada

`postgres:17-alpine` é **tag móvel** e contradiz a filosofia de determinismo do resto. Digest fixado, atualização consciente. Mesma regra para a imagem Node.

---

## 10. O que ainda está aberto

| Decisão | Nota |
|---|---|
| ⬜🔴 **Estratégia de renderização** | Vite + TanStack Router é **SPA**, e SPA não entrega `og:image` — WhatsApp, LinkedIn, Slack e Discord não executam JS. Para o preset `site` isso é bloqueante. **TanStack Start é candidato forte: em Release Candidate, com API declarada estável e feature-complete pela própria equipe.** Escolhível — mas o estágio vai dito em voz alta, não vendido como GA |
| ⬜🔴 **Origem do conteúdo** | hardcode · MD/MDX no repo · CMS · banco. É literalmente o *"hardcoded"* da queixa original |
| ⬜🔴 **Autorização** | O painel só tem auth **corporativa**. Falta o modelo acima disso, e a distinção que a IA mais erra: `if (!user) throw 401` não responde *"este usuário pode modificar **este** recurso"*. Autorização vira primitivo do `app/`, não invenção de cada rota |
| ⬜🔴 **Contexto de tenant em RLS** | Se RLS for usada para multi-tenancy, o contexto precisa ser **transaction-local** — senão vaza por connection pooling |
| ⬜ CSRF | Nasce junto com a decisão de autenticação, nunca isolada. O oRPC traz `SimpleCsrfProtectionHandlerPlugin` + `SimpleCsrfProtectionLinkPlugin`: conferência de **header customizado** (`x-csrf-token`, valor constante `"orpc"` por padrão), aplicada a **toda** procedure — não só GET, e **sem relação com `SameSite`**. A garantia vem do preflight CORS. Não substitui token por sessão |
| ⬜ Unidade de dinheiro | Centavos, decimal ou nano. Ver §4.4 |
| ⬜ Nível WCAG | O painel diz "declarado" e nunca nomeia A/AA/AAA |
| ⬜ Nomes das cinco famílias de cor | Hoje são de PCP |

### Deploy — a seção mais imatura, reconhecidamente

Container e duas services bastam para desenvolvimento. Para produção falta decidir: backup e **restore testado** · health e readiness · graceful shutdown e drain do pool · observabilidade · disco cheio · retenção de log · lag do outbox · falha de migration · upgrade do Postgres · rotação de segredo.

Não precisa virar Kubernetes. Mas **restore testado é tão importante quanto migration testada** — o software pode estar 100% correto e o volume se perder.
