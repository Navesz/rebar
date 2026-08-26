# Consolidação da revisão — `docs/STACK.md` v1.0

**Revisor-chefe · 26/08/2026 · seis lentes: verificação factual, concorrência, segurança, coerência interna, produção/deploy, frontend.**
Documento lido na íntegra (757 linhas). Evidência de terceiros re-conferida por amostragem no código instalado em `C:/Users/leona/OneDrive/Documents/prumo/node_modules` e nos dois repositórios de referência; os itens re-conferidos estão marcados **[reverificado]**.

---

## 1. VEREDITO

**Não. Faltam 34 itens bloqueantes** — 15 em que o texto, como está, instrui a construir algo defeituoso, e 19 decisões ausentes cuja adiação fecha porta (schema, deploy ou contrato).

O documento é forte onde foi atacado e vazio no que fica adjacente. As três coisas que ele mais celebra — a invariante unificada do §3.1, as três identidades do §4.6, o outbox de três fases do §5.1 — são exatamente onde a lacuna dói mais, porque cada uma está a um passo de virar código. Concretamente: **o SQL de captura publicado no §5.1 não lê a coluna de lease que o diagrama logo abaixo manda escrever**, e essa combinação, copiada literalmente, reenvia a mesma mensagem a cada tick de polling. **O gate de saúde da linha 564 omite `session_user`** — o defeito exato que o §4.6 inteiro existe para diagnosticar, reproduzido na única asserção que roda em produção. **A linha 225 declara em negrito uma decisão que as linhas 229-234 demolem**, e a linha 225 nunca foi reescrita.

O que aguenta a auditoria, e vale registrar antes das más notícias: os 14 números de versão do §2 conferem contra o lockfile do herz; `pg` 8.23.0 · `pg-pool` 3.14.0 · `@types/pg` 8.23.1 · Kysely 0.29.5 · oRPC 1.15.0 estão instalados como afirmado **[reverificado]**; as citações literais do PostgreSQL (`ddl-priv`, `sql-createextension`, `citext`, `pg_try_advisory_xact_lock`) são fiéis; as três citações do node-postgres (`pg-pool@3.14.0:288-301`, `lib/query.js:198-201`, remoção no `pg@9.0`) conferem linha a linha; o mapa de status do oRPC cobre os sete códigos citados **[reverificado]**; `GRANT … WITH INHERIT FALSE, SET TRUE, ADMIN FALSE` é sintaxe válida; e `pg_has_role(…,'SET')` é transitivo, então o encadeamento de `SET ROLE` está mesmo fechado. Os dois avisos do §2 (não é Radix; `components.json` diz `neutral` e o CSS é zinc) conferem.

A falha estrutural é uma só, e é a mais desconfortável possível: **a linha 44 diz que os dois últimos princípios nasceram de erros cometidos neste documento — e o documento comete a mesma classe de erro mais três vezes.** Uma elipse na citação do `RESET ROLE` apaga justamente a oração que abre a exceção (§4.6:433). A tabela de proveniência dos princípios atribui *"Preview de link não executa JS"* a *"crawler / especificação OG"* (linha 68), e nenhuma das quatro fontes nomeadas afirma isso — a camada dona é o framework. A linha 748 atribui ao oRPC uma propriedade de cookie (`SameSite`) que o oRPC não tem.

---

## 2. BLOQUEANTES

### Tier 1 — o texto, como está, instrui a construir algo defeituoso (15)

---

**1 · §5.1 — O SELECT de captura do outbox não lê `lease_until`. O lease é escrito e nunca consultado.** `crítico`

*Problema.* O predicado publicado é `WHERE entregue_em IS NULL AND tentar_apos <= now()`. O diagrama logo abaixo manda TX 1 fazer `SET lease_until` e COMMIT. Depois do COMMIT o lock de linha do `FOR UPDATE` morre, e a linha volta a satisfazer o predicado inalterada — `SKIP LOCKED` só pula linha travada por transação **aberta**, e não há nenhuma. Poller de 1 s, dois workers, POST de 5 s: a mesma mensagem sai ~10 vezes. Isso não é o at-least-once que o §3.1 declara e limita; é N envios por segundo por worker enquanto o I/O estiver em voo. Segundo defeito na mesma query: com `SKIP LOCKED` e N workers o `ORDER BY criado_em` não produz ordem de entrega, e a tabela de garantias da linha 217 exige do consumidor apenas dedupe — dedupe não é reordenação.

*Evidência.* STACK.md:589-595 (o SQL) contra STACK.md:604-619 (o diagrama). Grep no arquivo inteiro: `lease_until` aparece **exatamente uma vez**, na linha 607, nunca num predicado **[reverificado]**. Dono: PostgreSQL, `sql-select`, The Locking Clause — *"With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped."*

*Correção.* Publicar o predicado do desenho de três fases: `AND (lease_until IS NULL OR lease_until <= now())`, e em TX 1 gravar `lease_until` **e** `lease_by`. Deixar escrito que o SQL do §5.1 é inválido sozinho — o documento mostra as duas queries juntas ou nenhuma. Declarar em voz alta que o outbox **não preserva ordem** e acrescentar à tabela de garantias a terceira obrigação do consumidor (número de sequência por chave de agregado), ou trocar `SKIP LOCKED` global por partição por chave.

---

**2 · §5.1 — TX 2 é incondicional: não valida posse do lease, e dois workers escrevem por cima um do outro.** `crítico`

*Problema.* O diagrama descreve TX 2 como "marca entregue / COMMIT", sem condição. Com lease expirando durante I/O em voo — situação que o ADR 0008 do prumo documenta como rotineira, não excepcional — W1 volta 200 em t=45 e marca entregue; W2 volta 500 em t=62 e reagenda a mesma linha; se `tentativas` cruzar N nesse incremento, uma mensagem **entregue** vai para a fila morta e dispara alerta. Não existe coluna de posse no documento (`lease_by` não é mencionado), então W1 não tem como descobrir que perdeu o lease. Agravante de relógio: `now()` é `transaction_timestamp()` e não muda durante a transação, então numa captura em lote o lease de todos os itens começa a contar do início da TX 1 — com lote de 10 e chamadas sequenciais de 5 s, o item 10 recebe lease negativo.

*Evidência.* STACK.md:616-618 (TX 2 sem condição); STACK.md:623 é a única linha sobre lease no arquivo. PostgreSQL, `functions-datetime`: *"now() is a traditional PostgreSQL equivalent to transaction_timestamp()"* e *"their values do not change during the transaction."* Contexto: `prumo/adr/0008-task-lease-per-type.md`.

*Correção.* `UPDATE outbox SET entregue_em = now() WHERE id = $1 AND lease_by = $2 AND lease_until > now()`, com 0 linhas afetadas tratado como "perdi o lease: não escrevo, não incremento, apenas logo" — idem no caminho de falha. `clock_timestamp()` ao gravar o lease em captura em lote, ou um item por transação. E escrever a consequência de teste: como o lease é medido pelo relógio do **banco**, o teste de expiração semeia `lease_until` no passado — nunca manipula o relógio da aplicação. Sem essa frase, o regime determinístico do §7 aprova um mecanismo que nunca foi exercitado.

---

**3 · §3.1 — Duplicate-in-flight tem três respostas simultâneas no documento, e o teste obrigatório aprova a arquitetura rejeitada.** `crítico`

*Problema.* A linha 225 declara em negrito **"Escolhido: esperar e replicar — com espera limitada"**. Quatro linhas adiante o documento demole essa escolha (499 conexões paradas) e adota o oposto. A frase "Escolhido" nunca é reescrita nem marcada como candidata rejeitada, então continua sendo a única decisão explicitamente rotulada como decisão na seção. A tabela da linha 179 descreve o comportamento rejeitado, e o critério de aceitação da linha 208 aceita **"replay ou 409"** — ou seja, uma implementação que bloqueia no índice único e replica **passa no teste**, que é exatamente o vetor de DoS que a seção existe para eliminar.

*Evidência.* STACK.md:179, :208, :225, :229-234, :237-239.

*Correção.* Reescrever a linha 225 como candidata rejeitada (o documento já usa esse formato em "O caso que quase passou", linha 293); trocar a linha 179 para "Um executa; o segundo recebe 409 e não espera"; endurecer a linha 208 para "duplicatas excedentes: 409, nunca replay".

---

**4 · §4.6 — A premissa que decide o caso do `RESET ROLE` está escondida atrás de uma elipse, e nunca virou asserção.** `crítico`

*Problema.* O bloco `Assumptions` das linhas 78-81 lista quatro premissas, e a linha 84 exige que cada uma vire asserção. Falta a que decide o caso: que não exista `role` em connection-time. A citação da linha 433 é apresentada como fechando o assunto, e a elipse elide a oração principal. O documento **sabe disso** — a linha 450 proíbe `ALTER ROLE app_login SET role = app` exatamente por esse motivo — e ainda assim nem a premissa nem a asserção existem. Restam dois vetores com a mesma assinatura de falha (fail-open silencioso) e nenhum passa por `ALTER ROLE`: `ALTER DATABASE <db> SET role = app`, e `options=-c role=app` na connection string (ou `PGOPTIONS` no ambiente). O segundo é config de deploy — o tipo de coisa que alguém acrescenta para "resolver" um erro de permissão sem tocar em SQL. Com qualquer um deles o teste hostil das linhas 516-527 continua verde e o `RESET ROLE` cai em `app`, com o DML inteiro.

*Evidência.* STACK.md:433 cita *"`RESET ROLE` sets the current user identifier to … the current **session user** identifier."* A doc do PostgreSQL 17 (`sql-set-role`) diz: *"RESET ROLE sets the current user identifier to the connection-time setting specified by the command-line options, ALTER ROLE, or ALTER DATABASE, if any such settings exist. Otherwise, RESET ROLE sets the current user identifier to the current session user identifier."* A elipse apaga a primeira frase inteira. STACK.md:78-81, :84, :450, :516-527.

*Correção.* Reproduzir a citação sem elipse. Acrescentar a quinta Assumption e as três asserções que ela produz: `pg_db_role_setting` vazio para o par (role, database); `current_setting('role', true)` nulo logo após o connect e após `RESET ROLE`; connection string sem `options=`. O teste comportamental (`RESET ROLE` → `SELECT` protegido → PERMISSION DENIED) pega os três de uma vez, mas o modelo de ameaça escrito precisa nomeá-los — é o próprio princípio 3.

---

**5 · §4.6 — O gate de saúde do boot omite `session_user`: o defeito exato que a seção diagnostica.** `crítico`

*Problema.* A seção inteira existe porque o teste do prumo afirmava só `current_user` e por isso não viu que `session_user` era superusuário. A linha 514 repete a lição em voz alta. E a linha 564 — a asserção que decide se a aplicação está saudável, o único gate que roda em produção — lista `current_user`, `rolsuper`, `rolbypassrls` e `TimeZone`, e **não lista `session_user`**. Pior: não diz de qual role `rolsuper`/`rolbypassrls` são lidos. Se forem do `current_user` (= `app`), o gate passa mesmo com `app_login` superusuário — que é o cenário do prumo, palavra por palavra.

*Evidência.* STACK.md:438, :514, :522 (o teste hostil, correto, inclui `session_user`), :564 (o gate, que não inclui). Confirmado que o defeito descrito é real: `prumo/docker-compose.yml:52` `POSTGRES_USER: prumo`. Grep por `session_user` em `prumo/apps` e `prumo/packages`: **zero ocorrências** **[reverificado]**.

*Correção.* `SELECT session_user, current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user` — os atributos negativos lidos de `session_user`, não de `current_user`.

---

**6 · §10/§4.6 — O contexto de tenant do RLS é um GUC `PGC_USERSET`: a role restrita reescreve o próprio contexto sem privilégio.** `crítico`

*Problema.* O documento tem uma linha sobre contexto de tenant (747) e ela exige apenas que seja transaction-local, tratando connection pooling como o único modo de falha. Transaction-local é necessário e não é suficiente. Uma política keyed em `current_setting('app.user_id')` é avaliada contra um parâmetro que a própria sessão restrita pode escrever: parâmetro customizado de duas partes nasce como placeholder com contexto `PGC_USERSET`, sem checagem de privilégio. Um `set_config('app.user_id', <outro uuid>, true)` — por injeção, por caso de uso que não passou pelo `UnitOfWork`, ou por descuido — troca o tenant e o RLS entrega as linhas de outro, sem erro. Na implementação de referência existe ainda um **interruptor literal de bypass como predicado de política**. As sete asserções do teste hostil continuam verdes o tempo todo, porque nenhuma olha para o GUC.

*Evidência.* PostgreSQL, `src/backend/utils/misc/guc.c` REL_17_STABLE, `add_placeholder_variable`: `gen->context = PGC_USERSET`. Doc `runtime-config-custom`: *"PostgreSQL will accept a setting for any two-part parameter name"*, sem cláusula de privilégio. Referência: `prumo/apps/server/src/db/migrations/20260824_0001_base.ts:159-173` cria `CREATE POLICY users_bootstrap ON users USING (current_setting('app.bypass_rls', true) = 'on')`; `prumo/apps/server/src/db/unit-of-work.ts:45` escreve `set_config('app.bypass_rls','on',true)` **[reverificado]**. STACK.md:747 é a única menção no documento inteiro.

*Correção.* Elevar o GUC de tenant a canal privilegiado, escrito em exatamente um lugar: (a) regra determinística de lint que reprova `set_config('app.` e `SET LOCAL app.` fora do `UnitOfWork`; (b) proibir bypass como predicado de política — o caminho de bootstrap usa outra role ou outra conexão, nunca um flag que a sessão restrita liga sozinha; (c) o teste hostil ganha o caso de execução que falta: dentro do escopo do tenant A, executar `set_config('app.user_id', <uuid de B>)` e afirmar zero linhas ou erro.

---

**7 · §4.6 — O teste hostil é uma whitelist de duas arestas de role; as 15 roles predefinidas passam por baixo dele.** `crítico`

*Problema.* O bloco enumera duas arestas (`app_login`→`db_owner`, `app_login`→`app`) e cinco atributos negativos. Privilégio no PostgreSQL 16+ é grafo, e as roles predefinidas não aparecem em nenhuma das duas verificações: nenhuma é superusuária, nenhuma tem BYPASSRLS, nenhuma é `db_owner` ou `app`. `GRANT pg_read_all_data TO app` deixa as sete asserções verdes e dá leitura de toda tabela, view e sequence do banco — incluindo a outbox e o registro de idempotência, que o documento nunca põe sob RLS. `GRANT pg_execute_server_program TO app` deixa as sete verdes e dá `COPY … FROM PROGRAM`. Esse é o movimento do agente apressado: bate em "permission denied for table X" e concede a role predefinida que resolve, porque ela "parece segura" pelos cinco atributos que o próprio documento ensinou a medir.

*Evidência.* PostgreSQL, `predefined-roles`: `pg_read_all_data` — *"Read all data (tables, views, sequences), as if having SELECT rights on those objects… This role does not have the role attribute BYPASSRLS set."* `pg_execute_server_program` — *"Allow executing programs on the database server as the user the database runs as with COPY…"* Contraste com STACK.md:518-522.

*Correção.* Trocar whitelist de arestas por asserção sobre o conjunto: `SELECT roleid::regrole::text, member::regrole::text FROM pg_auth_members WHERE member IN ('app_login'::regrole,'app'::regrole)` tem de ser exatamente o par declarado, mais uma asserção de que nem `app` nem `app_login` pertencem, direta ou indiretamente, a qualquer role cujo nome comece com `pg_`. Registrar a Assumption que faltou escrever: *"app e app_login não pertencem a nenhuma role predefinida do sistema"*. **No mesmo fitness test, acrescentar a asserção de conjunto de extensões** — `SELECT extname FROM pg_extension ORDER BY 1` igual à lista declarada (`plpgsql`, `citext`, `unaccent`): a auditoria da linha 497 verifica a ACL do que existe e não detecta que passou a existir, e um `CREATE EXTENSION plpython3u`/`dblink`/`file_fdw` numa migration reintroduz DDL ou acesso a arquivo sem mexer em nenhum atributo de role.

---

**8 · §4.6/§7 — `GRANT` em tabela nova é automático, RLS em tabela nova é manual: assimetria fail-open.** `crítico`

*Problema.* A linha 531 usa `ALTER DEFAULT PRIVILEGES` para que tabelas futuras herdem DML. Não existe equivalente para RLS: `ENABLE`, `FORCE` e a política são por tabela, manuais, em cada migration. Uma tabela criada na migration N+5 nasce legível e gravável por `app` e sem política nenhuma — o privilégio chega sozinho, a proteção não. Nada no §7 pega isso: `tsc` não vê política, `dependency-cruiser` não vê política. A direção oposta (RLS ligada sem política) falha barulhenta e é sempre encontrada; a direção perigosa falha em silêncio. O documento também não trata view: view sobre tabela com RLS aplica as políticas do **dono da view**, e o dono é `db_owner`.

*Evidência.* PostgreSQL, `ddl-rowsecurity`; `sql-createview`, Notes: *"If any of the underlying base relations has row-level security enabled, then by default, the row-level security policies of the view owner are applied… unless the view has security_invoker set to true."* Prova empírica da assimetria: `prumo/…/20260824_0001_base.ts:131-132` faz loop manual de ENABLE+FORCE; `20260825_0002_app_role.ts` usa `ALTER DEFAULT PRIVILEGES` para os GRANTs. O incidente do lado fail-closed está documentado no próprio repo: `20260825_0004_bootstrap_commands.ts`, docstring — *"The bootstrap policy migration 0001 forgot… Nothing caught it."*

*Correção.* Fitness test de catálogo, classe determinística, junto do teste hostil: (a) toda tabela com coluna de tenant precisa de `relrowsecurity AND relforcerowsecurity` em `pg_class` e ao menos uma linha em `pg_policy`; (b) toda view cujas relações base tenham RLS precisa de `security_invoker=true`; (c) a lista de tabelas isentas é literal e versionada no teste, nunca um comentário na migration.

---

**9 · §4.5 — Kysely 0.29.5 roda TODAS as migrations pendentes numa única transação, e o `lock_timeout` que ele configura não vale dentro dela.** `crítico`

*Problema.* O documento resolve migration no boot em uma linha e não diz o que a ferramenta prescrita faz. Kysely adquire o advisory lock **fora** da transação e roda todas as migrations pendentes **dentro** de uma só. O `lock_timeout = 3600000` é configurado com `set_config(..., true)` — `is_local = true`, portanto vale apenas na transação implícita do próprio statement de lock; quando a transação de migration abre, o valor já voltou ao default do servidor, que é **0**. Consequência em rolling deploy: um `ALTER TABLE` que precisa de ACCESS EXCLUSIVE espera indefinidamente atrás de um relatório em curso e, obtido o lock, **retém ACCESS EXCLUSIVE durante todo o backfill que roda na mesma transação**. ACCESS EXCLUSIVE conflita com todos os modos: a instância N, que está servindo tráfego, não consegue nem um `SELECT` na tabela. Uma migration "compatível com a versão antiga" produz indisponibilidade total da tabela.

*Evidência.* `kysely/dist/migration/migrator.js:442-445` — `if (adapter.supportsTransactionalDdl && !disableTransactions) { … .execute((db) => runWithLock(db, (db) => db.transaction().execute((trx) => run(trx)))) }`; `kysely/dist/dialect/postgres/postgres-adapter.js:4-5,20-22` — `LOCK_ID = BigInt('3853314791062309107')`, `LOCK_TIMEOUT_MILLISECONDS = 60*60*1000`, `select set_config('lock_timeout', '3600000', true)` **[reverificado]**. PostgreSQL, `functions-admin`: *"If is_local is true, the new value will only apply during the current transaction."* `runtime-config-client`, `lock_timeout`: *"A value of zero (the default) disables the timeout."* Grep em STACK.md: `lock_timeout` = **0 ocorrências** **[reverificado]**.

*Correção.* Escrever no §4.5 que (a) o agrupamento numa transação é propriedade da ferramenta, não escolha do projeto; (b) toda migration que emite DDL começa com `SET LOCAL lock_timeout = '3s'` e `SET LOCAL statement_timeout`, sendo a falha por timeout o comportamento desejado; (c) backfill **não** vai na mesma transação de DDL — vira migration separada, em lotes; (d) se a política for uma transação por migration, passar `disableTransactions` e assumir a migration parcialmente aplicada. Isso é regra que desce de prosa para enforcement pelo princípio 1: fixture `reprovar/` com `@expect-rule` para DDL sem `SET LOCAL lock_timeout`.

---

**10 · §4.4 — A premissa central do §4.4 é falsa em três pontos: `numeric[]`, `jsonb` e o protocolo binário.** `alto`

*Problema.* O §4.4 apoia a seção inteira em *"o `pg` devolve `numeric` como string por padrão. É o comportamento seguro, e é ganho líquido"*, e lista **duas** armadilhas remanescentes. Faltam três, todas silenciosas, todas da mesma camada. (1) `numeric[]` (OID 1231) **tem** parser registrado e é `parseFloatArray` — cada elemento passa por `parseFloat`. Um `array_agg(valor)` devolve `number[]` com perda de precisão, sem aviso, e a regra "nada de float" não pega porque ninguém escreveu um float. (2) `jsonb` (OID 3802) passa por `JSON.parse`: número em `jsonb` é `numeric`, exato do lado do PostgreSQL, e vira double IEEE754 na fronteira do driver. Isso ataca a invariante mais forte do documento — o `resultado` da idempotência é uma coluna `jsonb`, então **o replay devolve um valor diferente do original acima de 2⁵³**. (3) No protocolo binário o escalar também vira `number`, e `binary` é opção suportada do `Pool`.

*Evidência.* `pg-types/lib/textParsers.js:189` → `register(1231, parseFloatArray); // _numeric`; `:203` → `register(3802, JSON.parse.bind(JSON)); // jsonb`; o OID 1700 **não aparece** em `textParsers.js` (por isso o escalar volta string — a parte que o documento acertou) e aparece em `binaryParsers.js:241` → `register(1700, parseNumeric)` **[reverificado]**. Coluna real: `prumo/…/20260824_0001_base.ts:115` `result jsonb NOT NULL`. Reproduzido: `JSON.parse('{"v":1234567890123456789}').v` → `1234567890123456800`.

*Correção.* Corrigir o texto: o `pg` devolve `numeric` **escalar** como string, no protocolo **texto**. Acrescentar três itens à lista: `numeric[]` volta como `number[]`; `binary: true` reverte o escalar; valor monetário e id de 64 bits dentro de `jsonb` são **string**, nunca número JSON. Trocar "nada de float" por regra verificável: proibir `numeric[]`/`float4`/`float8` no caminho do dinheiro por catálogo, ou registrar `setTypeParser(1231, …)` devolvendo `string[]`. E fechar o teste de fronteira com um caso que grava resultado de idempotência com valor perto de 2⁵³, faz replay e afirma igualdade byte a byte — sem isso o §3.1 declara uma invariante que o driver quebra em silêncio.

---

**11 · §3.1/§4.1/§6 — O 409 carrega três contratos incompatíveis, e o documento manda o cliente obedecer aos dois opostos.** `alto`

*Problema.* O documento emite 409 em três situações que exigem comportamentos opostos: duplicate-in-flight (o cliente **deve** retentar, senão o comando se perde), hash diferente com mesmo `commandId` (retentar é inútil e mascara bug), e conflito de versão otimista (o documento diz, em negrito, "nunca retry automático"). As linhas 239 e 355 se contradizem diretamente. Nenhum dos três recebe `type` distinto, apesar de o §3 exigir erro "classificável sem ler mensagem". Um cliente gerado implementa uma política só: se escolher "nunca retry", perde todo comando que caiu em duplicate-in-flight; se escolher "retry com Retry-After", passa a repetir automaticamente conflitos de concorrência. Agravante de camada: o mapa do oRPC tem `PRECONDITION_FAILED` → 412 e `TOO_MANY_REQUESTS` → 429, ambos não usados; e o `Retry-After` do RFC 9110 é definido para 503, 3xx e 429 — em 409 é semanticamente indefinido e nenhum proxy genérico o honra. Nota lateral: `Retry-After` também **não viaja no `ORPCError`** (o `toJSON` serializa `defined`, `code`, `status`, `message`, `data`), e o "202 em andamento" oferecido na linha 223 não é expressável como `ORPCError`, porque o construtor exige `status < 200 || status >= 400`.

*Evidência.* STACK.md:239, :288, :355, :651, :671. `@orpc/client/dist/shared/client.CZlviB0y.mjs:54` `CONFLICT: { status: 409 }`, `:58` `PRECONDITION_FAILED`, `:74` `TOO_MANY_REQUESTS`, `:123` validação de status, `:133` `toJSON`, `:173` `isORPCErrorStatus` **[reverificado]**. Canal de header existente: `@orpc/server/dist/plugins/index.mjs:331` exporta `ResponseHeadersPlugin` **[reverificado]**.

*Correção.* Um status por semântica: duplicate-in-flight → 429 ou 503 com `Retry-After`; conflito otimista → 412 `PRECONDITION_FAILED`; reuso de chave com hash diferente → 409 `CONFLICT`, sozinho e não retentável. Dois `type` RFC 9457 fixados no contrato. Anotar que o `Retry-After` sai via `ResponseHeadersPlugin`, não pelo erro, e que o teste de caminho de erro afirma os dois separadamente. Desdobrar a linha 670 do §7 em dois casos.

---

**12 · §10 — O plugin de CSRF do oRPC não é o que a linha 748 descreve. Três erros numa frase.** `alto`

*Problema.* A linha diz *"O oRPC tem plugin para GET com `SameSite=Lax`, que não cobre `SameSite=None`"*. O plugin real é `SimpleCsrfProtectionHandlerPlugin` e (a) **não filtra método nenhum** — registra `rootInterceptor` e `clientInterceptor` que valem para toda procedure; (b) **não tem relação com `SameSite`** — é conferência de header customizado, cuja proteção vem do preflight CORS, não de atributo de cookie; (c) o valor padrão é a string constante `"orpc"`, não um token secreto. Quem implementar CSRF a partir dessa linha acredita que a defesa é propriedade de cookie e que mutações POST estão fora do escopo — as duas ao contrário. E o §10 lista a dependência errada: a variável que força `SameSite=None` não é a escolha de autenticação, é a **topologia de origem**, que é a linha 744.

*Evidência.* `@orpc/server/dist/plugins/index.mjs:289-320` — `class SimpleCsrfProtectionHandlerPlugin`, `this.headerName = options.headerName ?? "x-csrf-token"`, `this.headerValue = options.headerValue ?? "orpc"`, erro `new ORPCError("CSRF_TOKEN_MISMATCH", { status: 403 })`; **zero ocorrência de `SameSite`/`sameSite` no arquivo** **[reverificado]**. A dependência real está escrita na referência: `prumo/apps/server/src/http/session-cookie.ts:5-11` — *"Host-only is possible because the SPA is served by this same Fastify process… Putting the front end on another host would force SameSite=None, which is strictly worse for no gain."*

*Correção.* Reescrever: *"O oRPC traz `SimpleCsrfProtectionHandlerPlugin` (+ `SimpleCsrfProtectionLinkPlugin` no cliente) — conferência de header customizado (`x-csrf-token`, valor constante por padrão), aplicada a toda procedure. A garantia vem do preflight CORS, não de `SameSite`. A política de `SameSite` do cookie é decisão da camada de autenticação e do navegador."* Fundir com a linha 744, ou escrever que 748 depende de 744, e registrar que **manter origem única é decisão de segurança**, não de conveniência de deploy. Bônus: `CSRF_TOKEN_MISMATCH` não está no `COMMON_ORPC_ERROR_DEFS` e por isso passa `status: 403` explícito — é a prova viva do claim do §3.

---

**13 · §10 — A prova do único 🔴 bloqueante viola o princípio 3, e a tabela de proveniência do próprio documento carrega a atribuição errada.** `crítico`

*Problema.* O §10 declara SPA bloqueante para o preset `site` e a tabela da linha 68 atribui *"Preview de link não executa JS"* a *"crawler / especificação OG"*. A especificação OG não é dona dessa propriedade, e nenhuma das quatro plataformas nomeadas publica a afirmação. Duas consequências. Primeira: nenhuma premissa é testável, e a decisão de arquitetura mais cara do documento não tem obrigação de teste. Segunda: o documento funde `og:image` com SEO, e a metade SEO está errada — Googlebot renderiza JS. Tratados como um só, paga-se SSR completo quando o que falta pode ser só meta no documento inicial. E a saída indicada não resolve: no **SPA mode** do TanStack Start o prerender emite um shell único (`/_shell.html`), ou seja, meta idêntico para toda URL — exatamente o defeito que se queria consertar. O que resolve é prerender com `crawlLinks`, ou SSR.

*Evidência.* Lidas e sem menção a JavaScript: `ogp.me`; `developers.facebook.com/docs/sharing/webmasters/web-crawlers/`; `api.slack.com/robots` (*"It fetches as little of the page as it can… looking for oEmbed and Twitter Card / Open Graph tags"*); `linkedin.com/help/linkedin/answer/a521928`. Contra: Google Search Central, *javascript-seo-basics* — *"Once Google's resources allow, a headless Chromium renders the page and executes the JavaScript."* A camada dona diz o que falta: doc do TanStack Start, SPA mode — *"Robots, crawlers and link unfurlers may have a harder time indexing your application unless they are configured to execute JS."*

*Correção.* Reescrever no formato obrigatório: Claim = "preview de link não vê meta injetado no cliente"; Owner = TanStack Start (o que é emitido) + cada crawler (o que é consumido); Assumptions testáveis — o HTML do build não contém `og:image` por rota; `curl -A facebookexternalhit/1.1 <url>` não retorna a tag; o Post Inspector do LinkedIn não a encontra. Separar preview (bloqueante) de indexação (não bloqueante). E listar três saídas por custo **antes** de trocar de framework: (a) meta no origin — o Fastify do §6 injeta `og:*` por rota no documento, custo ~zero; (b) prerender no build com `crawlLinks`; (c) meta no edge. Registrar que serviço de OG image (`@vercel/og`, satori) é **ortogonal** — gera a imagem, não entrega a tag; sem essa frase é a saída que o agente escolhe primeiro. Registrar também o pareamento de versões: `@tanstack/react-start` está em 1.168.49 e o router que o herz pina, em 1.170.18 — Start e Router sobem juntos.

---

**14 · §4/§9.5 — `shadcn add` no scaffold: a premissa da pergunta é falsa, e a decisão contradiz o §9.5.** `crítico`

*Problema.* Duas falhas empilhadas. (a) A pergunta do §4 é formulada como "o `shadcn add` escreve em `src/components/ui`, que o preset de fronteiras exclui". Um item de registro pode escrever no CSS, no `package.json`, em arquivos de ambiente e em caminho arbitrário do projeto, e puxar dependências de registro por URL ou repositório GitHub. A tensão real não é "código não analisado num diretório"; é um comando que escreve em qualquer lugar do repositório com conteúdo baixado de servidor remoto no momento do scaffold. (b) O §9.5 fixa digest de imagem porque tag móvel *"contradiz a filosofia de determinismo do resto"*. `shadcn add` é uma tag móvel sem digest: registro vivo, sem lock, sem hash, sem versão por item. Dois scaffolds do mesmo preset em datas diferentes produzem `ui/` diferentes. Agravante: a exclusão do `dependency-cruiser` está em `options.exclude`, que remove os módulos do cruzeiro inteiro — `sem-ciclo` e `sem-orfao` nunca olham para `ui/`, e a regra `componente-nao-busca-dado` usa um lookahead `(?!/ui/)` que **nunca pode disparar**.

*Evidência.* Especificação `registry-item.json`: `cssVars`, `css`, `dependencies`, `envVars` (*"Adds environment variables to .env.local or .env"*), `registryDependencies` (*"bare names, namespaced items, GitHub repos, URLs, or local files"*), `files[].target` com `~` para a raiz. CLI instalado `shadcn@4.19.0`: `dist/index.js:42,47,52` traz `target:"src/routes/index.tsx"`; `dist/chunk-CDOZT3OO.js:132` escreve o arquivo de env. `herz/apps/web/components.json:24` `"registries": {}` — campo aberto. `herz/apps/web/.dependency-cruiser.cjs:41` lookahead morto e `:76` `exclude: { path: '(\\.test\\.ts$|^src/components/ui/)' }` **[reverificado]**. `shadcn ^4.16.0` está em `dependencies`, não em `devDependencies` **[reverificado]**.

*Correção.* (1) `shadcn add` roda **uma vez**, no scaffold, e a saída é vendorizada e commitada, com manifesto `ui/.registro.json` (URL do registro, data, SHA-256 por arquivo) recomputado por um passo do `verificar`. (2) `registries` travado no registro oficial; item por URL ou GitHub proibido por política, verificável lendo `components.json`. (3) `--dry-run` obrigatório antes de qualquer `add`, com o diff de `index.css`, `package.json` e `.env*` revisado como mudança de arquitetura. (4) Tirar `^src/components/ui/` de `options.exclude` e isentar por regra, mantendo `sem-ciclo` e criando `ui-nao-conhece-o-app`, com o par `aprovar/`/`reprovar/` que o §9.3 exige. (5) Mover `shadcn` para `devDependencies`.

---

**15 · §4.6 — O snippet de `onConnect` interpola o nome do role em SQL; o código que ele deveria refletir não faz isso.** `medio · custa uma linha`

*Problema.* O bloco de exemplo é `await client.query(`SET ROLE ${role}`)` — concatenação crua de identificador em SQL, no único código executável da seção mais forte do documento, executado com a identidade privilegiada da conexão, antes da barreira. O código real do prumo faz o oposto e explica por quê num comentário. Num documento cuja tese é "código gerado errado deve *parecer* errado", esse é o artefato mais copiável da seção e ensina o padrão que o repositório já rejeitou. `SET ROLE` não aceita parâmetro bindado, então não há rede de proteção posterior.

*Evidência.* STACK.md:535-542. Contra `prumo/apps/server/src/db/connection.ts:79` — `client.query(`SET ROLE ${quoteIdentifier(role)}`)`, função em `:93` **[reverificado]**, com o comentário: *"The role name is ours, not user input — but building SQL by concatenation is a habit, and habits leak into places where the value is not ours."* O próprio `pg` exporta o utilitário (`pg/lib/client.js:608 escapeIdentifier`).

*Correção.* `await client.query(`SET ROLE ${pg.escapeIdentifier(role)}`)`, com a justificativa de uma linha ao lado.

---

### Tier 2 — decisão ausente cuja adiação fecha porta (19)

---

**16 · §3.1/§8 — O "limite declarado" de conexões não existe, e a fila de espera do pool é ilimitada e sem prazo.** `crítico`

*Problema.* A linha 207 exige "pico de conexões do banco ≤ limite declarado" e observa que sem essa asserção "o teste aprova um DoS". O documento **nunca declara** tamanho de pool, número de instâncias ou `max_connections`: um teste que compara com número inexistente sempre passa. E a asserção mede a métrica errada: em `pg-pool` 3.14.0, quando o pool está cheio e `connectionTimeoutMillis` não está configurado, o pedido é empurrado num array `_pendingQueue` **sem timer e sem cap**. Com 500 duplicatas: 10 executando, 490 promises que nunca resolvem nem rejeitam, cada uma segurando um socket HTTP. O pico de conexões do banco foi 10 e o teste passa — o DoS acontece inteiro acima da linha que a asserção mede. Agravante: o §4.5 exige que N e N+1 coexistam durante rolling deploy, dobrando a demanda na janela exata em que ninguém está olhando; com os defaults (pool 10, `max_connections` típico 100, 3 reservadas) cabe hoje e não cabe com oito instâncias — e a falha não é degradação, é `FATAL: sorry, too many clients already` no boot, que o healthcheck de liveness não vê.

*Evidência.* `pg-pool/index.js:206-208` — `if (!this.options.connectionTimeoutMillis) { this._pendingQueue.push(new PendingItem(response.callback)); return result }`, sem timer; `:89` `max = … || 10`; nenhuma ocorrência de `maxWaitingClients` **[reverificado]**. A mitigação já existe na referência e não no documento: `prumo/…/connection.ts:60,64,65` — `max: options.max ?? 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000` **[reverificado]**. Grep em STACK.md: `connectionTimeout` = 0 ocorrências **[reverificado]**.

*Correção.* Escrever a fórmula e o número: `(instâncias_max_durante_rolling × pool_app) + (instâncias × pool_migration_no_boot) + workers + folga ≤ max_connections − superuser_reserved_connections`. Fixar `max_connections` explicitamente no compose e `max` explicitamente no código. `connectionTimeoutMillis` **obrigatório e diferente de zero**, mais teto explícito de fila em nível de aplicação que devolve 503 antes de chamar `pool.connect()`. E corrigir a asserção do teste: além do pico de conexões, "nenhum request excedeu o orçamento de latência declarado", "`pool.waitingCount` máximo ≤ limite" e "nenhuma promise de acquire ficou pendente ao fim do teste".

---

**17 · §4.6 — Os três timeouts de servidor não são declarados, todos têm default 0, e `SET` em `onConnect` é revogável por `RESET ALL`.** `crítico`

*Problema.* O documento dedica uma seção a provar que `onConnect` é barreira de **aquisição** confiável, e não tem uma linha sobre o lado da **liberação** — que é onde o desenho fica exposto, porque agora depende de a transação realmente terminar: o `pg_try_advisory_xact_lock` só é liberado no fim da transação, os locks de linha do outbox idem, e o índice único bloqueia enquanto a transação do primeiro escritor viver. `statement_timeout`, `lock_timeout` e `idle_in_transaction_session_timeout` são todos 0 por default, nas duas camadas, e nenhum é mencionado. `pg-pool` não emite ROLLBACK ao devolver um cliente, e o driver do Kysely sempre libera sem erro: um ROLLBACK que falha devolve o cliente ao pool **com a transação aberta**, e todo retry do mesmo `commandId` recebe 409 fail-fast para sempre, sem alerta. Segundo ponto, aplicando o raciocínio do próprio §4.6 onde ele não foi aplicado: se os timeouts forem postos com `SET` dentro do `onConnect`, qualquer SQL cru emitindo `RESET ALL` os apaga — e o documento já assume esse modelo de ameaça. O mesmo vale para o `SET TIME ZONE 'UTC'`.

*Evidência.* PostgreSQL, `runtime-config-client`: os três com *"A value of zero (the default) disables the timeout."* `sql-reset`: *"The default value is defined as the value that the parameter would have had, if no SET had ever been issued… The actual source of this value might be… per-database or per-user default settings."* `pg/lib/defaults.js:65,69,73` — `statement_timeout: false`, `lock_timeout: false`, `idle_in_transaction_session_timeout: false`. `pg-pool/index.js:384-400` `_release` sem nenhuma limpeza de estado; grep por `ROLLBACK` no arquivo: 0. Grep em STACK.md: os três = **0 ocorrências** **[reverificado]**.

*Correção.* Declarar os quatro números e **o mecanismo que os aplica**. Como `RESET ALL` volta ao default de role, o mecanismo que falha fechado é `ALTER ROLE app_login SET statement_timeout = …` — não `SET` em `onConnect`. Valores distintos para o pool de migration (statement longo, lock curto). Vira asserção no teste hostil, ao lado de `pg_has_role`: emitir `RESET ALL` e reafirmar `current_setting('statement_timeout')` e `current_setting('TimeZone')`. Escrever a simetria em voz alta: `onConnect` é a barreira de aquisição, `idle_in_transaction_session_timeout` é a de liberação.

---

**18 · §4.5/§8 — Migration no boot elimina o rollback de deploy, e a palavra "rollback" não aparece no documento.** `crítico`

*Problema.* Grep no STACK.md inteiro por `rollback`: **zero** **[reverificado]**. O PLANO.md marca *"Deploy: como sobe e como volta — Rollback testado"* como bloqueante vermelho. Pior que a ausência é a contradição silenciosa: Kysely valida, antes de migrar, que toda migration já executada no banco existe na lista da imagem, e lança `corrupted migrations` se não existir. O movimento padrão de recuperação — voltar para a imagem R1 — faz o pod morrer no boot em crash loop, e a única saída passa a ser roll-forward escrito sob pressão ou DELETE manual na tabela de migrations em produção. O mesmo guarda dispara em canary: um pod de R1 que reinicie por qualquer motivo depois de R2 ter migrado não volta.

*Evidência.* `kysely/dist/migration/migrator.js:449-455` (`#ensureNoMissingMigrations` chamado incondicionalmente por `#getState`), `:500` `throw new Error('corrupted migrations: previously executed migration … is missing')` **[reverificado]**. Referência: `prumo/apps/server/src/main.ts:47` `await migrateToLatest(createDb(adminPool))` antes de qualquer servidor subir **[reverificado]**. STACK.md:389, :390, :755.

*Correção.* Escolher explicitamente entre duas políticas e escrever a que ganhar: (a) migration continua no boot e **o rollback de aplicação deixa de ser caminho de recuperação** — o que precisa estar no runbook, com roll-forward como único caminho e um teste que prove que a imagem N−1 sobe contra o schema N (ou seja, expand/contract vira obrigatório para toda migration); ou (b) migration sai do boot e vira passo de deploy separado, com a aplicação apenas verificando o schema no boot. Em qualquer caso, a regra de uma linha que falta: **a versão de app só pode voltar até o último EXPAND; passado o CONTRACT, a volta é migration nova para frente.** Consequência: CONTRACT nunca sai no mesmo deploy que o EXPAND, e o intervalo entre os dois é a janela de rollback declarada.

---

**19 · §4.5/§4.6/§8 — Migration no boot obriga o runtime a carregar credencial de `db_owner`, que a regra da linha 429 proíbe.** `crítico`

*Problema.* A linha 429 é categórica: *"o runtime nunca autentica com credencial de privilégio superior a `app`."* Mas as migrations rodam no boot, como owner, num pool dentro do mesmo processo, e o §8 declara **duas** services apenas. Logo o container da aplicação carrega a credencial de `db_owner` no ambiente durante toda a sua vida, e no boot abre uma sessão cujo `session_user` é `db_owner`. Fechar o pool não remove a credencial nem o caminho de código que a usa. É a mesma forma do defeito medido no prumo, só que com duas strings — o `session_user` privilegiado continua alcançável de dentro do runtime, e o gate de saúde só roda depois.

*Evidência.* STACK.md:429, :389, :562, :682. `prumo/adr/0005:22` — *"Migrations run at boot under an advisory lock."*

*Correção.* Ou a migration vira passo de deploy separado (init container / job / `docker compose run --rm app migrate`), com a credencial de owner fora do ambiente da aplicação — e o §8 ganha uma terceira unidade; ou a regra da linha 429 é reescrita para "depois do boot", assumindo por escrito que a credencial de owner vive no processo. Do jeito que está, as duas afirmações não podem ser verdadeiras juntas e o documento não escolhe.

---

**20 · §8 — Readiness que responde 200 fixo e graceful shutdown na ordem invertida.** `crítico`

*Problema.* O §8 lista "health e readiness" e "graceful shutdown e drain do pool" como pendências e não diz a única coisa que importa em cada um. Readiness degradada precisa responder código HTTP **não-2xx**: na referência a rota checa o banco de verdade e devolve **HTTP 200** com `{status:'degraded'}` no corpo — orquestrador e balanceador leem o status, não o corpo, então a instância continua recebendo tráfego com o banco fora; e o healthcheck do container aponta para a rota de liveness, que nunca toca o banco, então **nada consome o sinal de readiness**. No shutdown, dois defeitos: `pool.end()` marca `ending = true` e a partir daí `_pulseQueue()` retorna cedo e nunca mais drena `_pendingQueue` — todo pedido que já esperava fica pendurado para sempre, sem erro (isso é abandono, não drain); e a referência drena o pool **antes** de fechar o HTTP, sem `app.close()`, chamando `process.exit(0)` — requisições em voo perdem o banco debaixo delas.

*Evidência.* `prumo/packages/contract/src/index.ts:41-47` e `apps/server/src/http/router.ts:85` `status: 'degraded'` sem `ORPCError` **[reverificado]**; `prumo/docker-compose.yml:35-46` healthcheck em `/saude/vivo`. `prumo/apps/server/src/main.ts:97-100` — `await pool.end(); process.exit(0)`, **sem `app.close`** em `apps/server/src` **[reverificado]**. `pg-pool/index.js:488-499` e `:133-145` (o `return` antecede a lógica que consome `_pendingQueue`). PLANO.md:355 já nomeia o antipadrão: *"saúde que responde 200 fixo mente"*.

*Correção.* Duas linhas de decisão: liveness = o processo está vivo, nunca toca dependência, é o que o container reinicia; readiness = 200/503, checa banco, é o que o balanceador consulta. E a sequência de shutdown como diagrama, no estilo do §5.1: SIGTERM → readiness passa a 503 → espera o intervalo de scrape → `app.close()` → `pool.end()` → exit, com `terminationGracePeriod` maior que o `keepAliveTimeout` do Fastify (72 s no default) ou o keepAlive baixado de propósito.

---

**21 · §8 — Backup e restore: o item que o próprio documento chama de mais importante é o único sem nenhuma decisão, e a prova de referência é falsa.** `crítico`

*Problema.* O documento diz *"restore testado é tão importante quanto migration testada"* e não decide nada: nem o que se copia (`pg_dump` lógico × snapshot de volume × WAL archiving/PITR), nem onde vai, nem frequência, nem RPO/RTO, nem quem prova. E as três opções têm consequências diferentes para o resto do documento — só o dump lógico sobrevive ao upgrade de major, e PITR muda o cálculo de disco. Escolher depois de já haver dado real fecha portas. Na referência, o comando declarado aponta para um arquivo inexistente: "existe backup" é falso e nada acusa.

*Evidência.* STACK.md:755, :757. `prumo/package.json:41` `"backup": "node scripts/backup.mjs"`; `prumo/scripts/` contém apenas `coletar.mjs`.

*Correção.* Antes do primeiro byte de dado real: método (`pg_dump` lógico é o default seguro para "duas services"), destino fora do host, frequência, RPO e RTO em números, e o teste de restore como passo do `verificar` — restaurar num banco vazio e rodar a suíte de integração contra ele, ao lado de "Migration com dado existente".

---

**22 · §4.1/§5.1/§6 — O nível de isolamento nunca é declarado, e sob REPEATABLE READ o 409 vira 40001 auto-retriável e o `SKIP LOCKED` aborta.** `alto`

*Problema.* O documento é sobre concorrência e não diz uma vez qual nível o `UnitOfWork` abre. Sob READ COMMITTED o `UPDATE … WHERE id=$2 AND version=$3` reavalia o WHERE, devolve 0 linhas e vira 409, como o §4.1 quer. Sob REPEATABLE READ o mesmo statement é abortado com SQLSTATE 40001 — o erro canônico de falha transitória, que toda biblioteca de retry retenta. O §6 manda "retry só de falha transitória, do caso de uso inteiro", e sob RR o conflito de versão **chega vestido de falha transitória**: o caso de uso é retentado, relê a linha em version=8, e se o `version` do WHERE vier da leitura fresca em vez do token do cliente, o UPDATE passa e sobrescreve a escrita do concorrente. Segundo efeito: sob RR o `SELECT … FOR UPDATE SKIP LOCKED` não pula — aborta com 40001 quando alcança linha atualizada depois do snapshot, ou seja, o worker de outbox morre sob contenção, que é justamente quando ele precisa funcionar.

*Evidência.* Grep em STACK.md: `isolation` 0, `SERIALIZABLE` 0, `REPEATABLE` 0, `READ COMMITTED` 0 **[reverificado]**. PostgreSQL, `transaction-iso`, Repeatable Read: *"…the repeatable read transaction will be rolled back with the message ERROR: could not serialize access due to concurrent update"*; Read Committed: *"The search condition of the command (the WHERE clause) is re-evaluated…"*. A ferramenta permite escolher: `kysely/dist/dialect/postgres/postgres-driver.js:42-53` monta `start transaction isolation level …` quando `settings.isolationLevel` é passado — é parâmetro explícito, não default herdado.

*Correção.* Declarar **READ COMMITTED** como nível do `UnitOfWork`, em texto e como asserção (`SHOW transaction_isolation` dentro de uma transação do UnitOfWork), com a justificativa exata. Onde algum caso de uso precisar de RR ou SERIALIZABLE, a escolha é local, escrita, e vem com a regra de que 40001 nunca é retentado por caso de uso que use token de versão do cliente. E acrescentar a asserção que falta no §6: a política de retry classifica por SQLSTATE, e a lista de retentáveis é fechada e versionada.

---

**23 · §3.1 — Três donos disputam o mesmo espaço de chave `bigint` de advisory lock, e a premissa 3 é falsa para duas dessas colisões.** `alto`

*Problema.* A premissa 3 diz que colisão de hash custa "um 409 espúrio". Verdade entre dois comandos. Falso para colisão com lock que **não** é de comando, e existem dois no mesmo espaço de 64 bits: a chave hand-rolled de migration `8140772301` e a chave interna do Kysely `3853314791062309107`. Comando bloqueando deploy: uma mutação com hash colidente segura o xact lock, a réplica nova cai no `pg_advisory_lock` bloqueante sem `lock_timeout` e pendura no boot. Deploy bloqueando comandos: uma migration de 4 minutos faz toda mutação com hash colidente receber 409 por 4 minutos seguidos, e o cliente esgota o orçamento de retry — não é 409 espúrio, é comando permanentemente perdido. A probabilidade é ~2⁻⁶⁴ e não é o ponto: o ponto é que o **raciocínio registrado como decisão está errado**, e a correção é gratuita.

*Evidência.* PostgreSQL, `functions-admin`: *"…identified either by a single 64-bit key value or two 32-bit key values (note that these two key spaces do not overlap)."* `kysely/dist/dialect/postgres/postgres-adapter.js:4` `LOCK_ID = BigInt('3853314791062309107')` **[reverificado]**; `prumo/apps/server/src/db/migrate.ts:43` `ADVISORY_LOCK_KEY = 8_140_772_301n` **[reverificado]**, com o comentário *"Arbitrary but fixed. Any other process using this same key would be a bug"* — que é exatamente a suposição que precisa virar regra. STACK.md:237, :249-251.

*Correção.* Particionar por construção: aplicação usa a forma de **dois int4** — `pg_try_advisory_xact_lock(NAMESPACE_IDEMPOTENCIA, hash32(scope, commandId))` — e migrations ficam sozinhas na forma `bigint`. Reescrever a premissa 3: *"colisão entre comandos custa um 409 espúrio; colisão com lock de infraestrutura custa um deploy pendurado ou um comando perdido, e por isso os espaços são disjuntos."*

---

**24 · §3.1/§3.2 — O registro de idempotência não tem retenção, TTL nem regra de purga, e a purga que alguém vai adicionar reintroduz execução dupla em silêncio.** `alto`

*Problema.* Grep: `TTL` 0, `expira` 0, `purg` 0, `retenc` 0 **[reverificado]**; a única menção é "numa janela de idempotência longa" (linha 317), e a janela nunca é definida. Sem purga a tabela cresce para sempre e o índice único que **é** a correção do desenho vira o objeto mais quente e inchado do banco — e o `resultado` persistido não é uma chave, é cópia integral do corpo de toda resposta bem-sucedida. Com purga — e alguém vai adicionar uma, porque a ausência obriga — o purge job vira o caminho de execução dupla: registro apagado às 03:00, retry do agente às 03:00:10 não encontra nada, adquire o lock sem disputa, insere, executa e **cobra de novo**. É literalmente o mesmo desfecho do "caso que quase passou" da v0.7, pela porta ao lado. O TTL não é parâmetro de manutenção: é cláusula de contrato, porque apagar uma linha converte um replay em nova execução — e se o valor não estiver no contrato desde o dia 1, não existe momento seguro de escolhê-lo depois.

*Evidência.* STACK.md:173, :181, :293-295, :317. Prova de que o problema é real na referência: `prumo/…/20260824_0001_base.ts:110-122` cria `processed_commands` com `result jsonb NOT NULL` e índice em `created_at` — o índice que uma purga usaria — e não existe rotina de purga no repositório.

*Correção.* (a) Retenção declarada por `scope`, o número justificado pela janela máxima de retry do cliente mais lento, e essa janela vira campo declarado no contrato, como `operationVersion`. (b) A purga nunca apaga registro cuja linha de outbox associada ainda não foi entregue ou já morreu (ver #26). (c) Expirada a janela, o comportamento é **explícito**, não "executa de novo por não encontrar": ou tombstone (`commandId` + `status` + `completedAt`, `resultado` apagado — preserva o desfecho estável a custo baixo indefinidamente), ou recusa nomeada para comando mais velho que a janela. (d) Particionar por `criado_em` para que o expurgo seja `DROP PARTITION`, não `DELETE` em massa. (e) O teste do §3.1 ganha um caso: mesmo `commandId` reenviado após o TTL executa de novo, e isso é correto e documentado.

---

**25 · §3.2 — A palavra "versão" nomeia duas coisas diferentes, e o registro de idempotência tem três listas de campos que não se cruzam.** `alto`

*Problema.* A tabela decide por "mesma versão / versão diferente" e o documento define versão como `operationVersion` (campo do cliente, imutável). Três parágrafos depois persiste `idempotencySchemaVersion` e diz que "comparação de hash só vale dentro da mesma versão" — e essa segunda versão é do **servidor**. As duas regras usam a mesma palavra e discordam no caso que o documento usa como exemplo. Sequência: cliente envia os mesmos bytes com o mesmo `operationVersion: 1`; durante rolling deploy o retry cai num pod N+1 cujo schema mudou o default; a projeção muda, o hash muda; `operationVersion` bate → "mesma versão" → hashes diferentes → **"Erro — key reutilizada"**. O cliente enviou duas vezes exatamente a mesma coisa e foi acusado de reusar a chave, deterministicamente. E o registro é descrito três vezes com conjuntos de campos disjuntos, com dois nomes para o escopo (`scope` na chave e no lock, `operation` no persistido) e duas convenções de nome (`criadoEm` × `completedAt`).

*Evidência.* STACK.md:173, :283, :285-289, :297-298, :309, :317, :237. O fator que torna o exemplo inevitável: STACK.md:270 — *"Se o contrato faz `strip`, os dois são idênticos"*, e `strip` é o default de objeto no Zod.

*Correção.* Uma definição de tabela única, com todas as colunas, num lugar só, dizendo se `scope` e `operation` são a mesma coisa. Separar as duas versões em **duas colunas independentes** na tabela de decisão, com os quatro quadrantes decididos: o quadrante que hoje quebra — mesmo `operationVersion`, `idempotencySchemaVersion` diferente — tem de ser **replay do desfecho estável**, nunca erro de key reutilizada. E tirar a consequência operacional: como o guarda de hash não atravessa versões de schema, ele não é a defesa contra reuso de `commandId` durante deploy; a defesa nessa janela é o `operationVersion` do cliente, e por isso ele é obrigatório no contrato.

---

**26 · §3.1/§3.2/§5.1 — O `status` do desfecho estável afirma "concluído" para um efeito externo que pode ter morrido, e nada liga o registro de idempotência à linha de outbox.** `alto`

*Problema.* O `resultado` e o `status` são escritos **antes** de o efeito externo existir, por construção. O desfecho estável exposto no replay é `commandId · status · operationVersion · resourceId · completedAt`, e o documento diz que basta para dizer "já executou". Já executou **o quê**? Se o webhook falhou N vezes e a linha foi para a fila morta, o replay devolve `status: concluído, resourceId: chg_123` e o cliente conclui que a cobrança foi processada — não foi, e a única evidência está numa linha morta que o registro não referencia. O outbox não tem `commandId`, o registro não tem `outboxId`, e as duas metades da "invariante unificada" se encontram no INSERT e nunca mais: não há caminho de reconciliação, nem no documento nem possível a partir do schema descrito. E a tabela de garantias diz que o consumidor deve deduplicar por `outboxId` — a identidade que atravessa a fronteira — que não está no desfecho estável que o cliente recebe.

*Evidência.* STACK.md:181, :190-197, :217, :309, :590-595, :607, :623.

*Correção.* Separar dois estados que hoje são um: `commandStatus` (a transação de negócio comitou — sempre concluído no replay) e `effectStatus` (`pendente`/`entregue`/`morto`), os dois no desfecho estável. Adicionar `commandId` na linha de outbox e `outboxId` no registro. Definir a reconciliação: quando uma linha vai para a fila morta, o `effectStatus` do comando vira `morto` na mesma transação. Sem os três, "invariante unificada" descreve um INSERT, não uma invariante.

---

**27 · §4.1 — "Zero linha afetada = conflito" é falso: linha inexistente ou invisível por RLS produz o mesmo zero.** `alto`

*Problema.* O `UPDATE … WHERE id=$2 AND version=$3` devolve zero em pelo menos quatro casos: version desatualizada (conflito real), id inexistente, linha apagada, e linha existente mas invisível pela política de RLS que o documento adota como "a segunda porta". Um cliente legítimo que passa um id apagado recebe 409 ("seu estado está velho, releia") em vez de 404, entra em laço de releitura que nunca converge — num cliente-agente, laço infinito. E se alguma rota implementar o caminho óbvio de reler a linha para produzir 404, o oráculo aparece na hora: id de outro tenant → 404; id próprio desatualizado → 409, e a diferença responde "este id existe em algum tenant?". O documento não diz qual dos dois caminhos seguir, e os dois estão errados de formas diferentes.

*Evidência.* STACK.md:349-355; a RLS é premissa declarada em STACK.md:104 e :747. `prumo/adr/0005` — *"Row-level security as the second door behind user_id in every repository WHERE."*

*Correção.* Distinguir as causas numa transação só, sem segunda ida ao banco: `WITH alvo AS (SELECT version FROM pedido WHERE id = $2) UPDATE … RETURNING …`, com três desfechos — `alvo` vazio → **404** (a linha não existe *para este chamador*, que é a única pergunta que o servidor tem direito de responder, e sob RLS 404 fecha o oráculo por construção); `alvo` presente e 0 linhas → 412/conflito real; 1 linha → 200. Escrever que sob RLS "não existe" e "não é seu" **devem** ser indistinguíveis na resposta, e que essa é a razão de 404 e não de 403.

---

**28 · §4.1 — Nada garante o incremento de `version`: a disciplina que o `rowversion` dava de graça virou prosa.** `alto`

*Problema.* O documento escolhe a coluna `version bigint` e diz que ela é "incrementada no próprio `UPDATE` condicional". Isso descreve **aquele** UPDATE. Não descreve nenhum outro caminho de escrita, e não há CHECK, trigger, lint ou fitness test que force qualquer outro a incrementar. Modo de falha padrão de projeto que gera código: um caso de uso novo faz `UPDATE pedido SET estado='cancelado' WHERE id=$1` sem tocar em `version` (não precisava, é transição de administrador); o cliente com token version=7 casa, sobrescreve o cancelamento e recebe 200. Nenhum 409 apareceu. Sob `rowversion` isso era impossível. O ADR 0005 do prumo lista essa perda em "What we give up"; o STACK.md, que herda o ADR, apaga a consequência e apresenta a coluna como equivalente. E o princípio 1 decide o caso — um trigger é estritamente mais confiável do que a disciplina que substitui, e nem foi considerado entre os três candidatos.

*Evidência.* STACK.md:340-355 (nenhuma menção a trigger no arquivo inteiro). `prumo/adr/0005-postgres-over-sql-server.md`, "What we give up" — *"`generation.version` is an explicit integer column instead, which means every writer must remember to bump it — a discipline the database used to provide for free."* Princípio violado: STACK.md:47-49.

*Correção.* Adicionar o quarto candidato e escolhê-lo: coluna `version bigint` **mais** trigger `BEFORE UPDATE` por tabela versionada que faz `NEW.version := OLD.version + 1` incondicionalmente. O `UPDATE … WHERE version = $3` continua igual (a barreira é o WHERE, não o incremento). Se o trigger for recusado, o enforcement desce para outro lugar mensurável — fitness test que varre as migrations e reprova tabela com coluna `version` sem trigger, mais lint que reprove `UPDATE` literal nessas tabelas fora do repositório designado. O que não pode ficar é a frase em prosa.

---

**29 · §4.5/§3.1 — O advisory lock de migration da implementação de referência é de sessão, roda em conexão não fixada e espera sem prazo.** `alto`

*Problema.* A premissa 1 do §3.1 diz, em negrito, que a variante `_xact_` é obrigatória e que "a de sessão vazaria entre requests na conexão reaproveitada". A referência de migration no boot faz o contrário e sem a proteção que tornaria isso seguro: `pg_try_advisory_lock`, `pg_advisory_lock` e `pg_advisory_unlock` como três statements avulsos contra o objeto `Kysely`, não contra uma conexão fixada. Advisory lock de sessão pertence à sessão: se o unlock cair em conexão diferente, retorna false com WARNING e o lock permanece — e o código descarta o retorno. O caso irrecuperável independe de sorte de pool: SIGKILL entre o lock e o `finally` deixa o lock retido até o backend morrer, o que com socket meio aberto é o keepalive do TCP. E quando o `try` falha, o código cai num `pg_advisory_lock` bloqueante **sem `lock_timeout`**: uma instância com migration travada faz toda instância nova pendurar no boot indefinidamente, sem log e sem erro. O documento também não diz o que acontece quando a migration falha.

*Evidência.* `prumo/apps/server/src/db/migrate.ts:53,58,81` — três `.execute(db)` contra `db: Kysely<Database>`, nenhum dentro de `db.connection()` **[reverificado]**. Contraste que mostra que fixar é o requisito: o próprio Kysely fixa (`migrator.js:443-447`, `this.#props.db.connection().execute(...)`) **[reverificado]**. `prumo/apps/server/src/main.ts:44` `max: 2` **[reverificado]**. PostgreSQL, `functions-admin`: locks *"can be taken at session level (so that they are held until released or the session ends)…"*; `pg_advisory_unlock`: *"If the lock was not held, false is returned, and in addition, an SQL warning will be reported by the server."*

*Correção.* Estender a premissa 1 para valer no boot e dizer como: ou o lock de migration vira `pg_advisory_xact_lock` numa transação que envolve a migration inteira, ou as três chamadas ficam dentro de um único `db.connection().execute(...)` com o retorno do unlock **verificado**. `lock_timeout` na espera bloqueante, com o processo saindo com código de erro em vez de pendurar. E registrar que o lock hand-rolled é redundante com o interno do Kysely — hoje é só superfície de erro.

---

**30 · §4.7/§4.6 — FK e UNIQUE atravessam RLS: decisão de schema, não de runtime.** `alto`

*Problema.* O §4.7 manda pôr invariante no banco com CHECK, FK e UNIQUE, e o §4.6 põe RLS por cima. As duas coisas não compõem como o documento supõe, e a doc do PostgreSQL diz isso em uma frase. Primeira consequência: uma FK de linha do tenant A para linha do tenant B **tem sucesso**, porque a busca da linha pai ignora a política — o RLS esconde a linha do SELECT e permite referenciá-la. Segunda: um UNIQUE em tabela com RLS é namespace **global** entre tenants, então um 23505 é oráculo de existência. Nada disso é retrofitável barato depois de a primeira migration existir.

*Evidência.* PostgreSQL, `ddl-rowsecurity`, literal: *"Referential integrity checks, such as unique or primary key constraints and foreign key references, always bypass row security to ensure that data integrity is maintained."* Exigência do dono: `rebar/docs/PLANO.md:383` — *"nunca revele se o e-mail existe"* vira teste de caminho de erro.

*Correção.* Acrescentar ao §4.7: sob RLS, FK entre tabelas com tenant é **composta** e carrega a coluna de tenant nas duas pontas (com UNIQUE correspondente no pai), nunca FK simples pelo id; e todo UNIQUE em tabela com RLS ou é globalmente único **por decisão escrita**, ou é composto com a coluna de tenant. O caso do e-mail vira a fixture que o PLANO já pediu.

---

**31 · §4.8/§8 — O §4.8 manda declarar a collation no `CREATE DATABASE`, e o deploy do §8 não tem `CREATE DATABASE`.** `alto · irreversível`

*Problema.* O §4.8 decide declarar a collation ICU no `CREATE DATABASE` e verificar no boot, e faz o mesmo com o encoding. O §8 entrega `postgres:17-alpine` com `POSTGRES_DB`, e nessa configuração o banco é criado pelo entrypoint da imagem no primeiro boot — não existe `CREATE DATABASE` sob controle do projeto. `initdb` só roda com o diretório de dados vazio, e o provedor de locale de um banco não muda depois. A verificação de boot que o §4.8 pede detecta o problema no único momento em que ele já não tem conserto barato: em desenvolvimento é destruir o volume; em qualquer ambiente com dado é uma migração inteira.

*Evidência.* Docker Hub `_/postgres`: `POSTGRES_DB` *"can be used to define a different name for the default database that is created when the image is first started"*; a inicialização *"will only run if you start the container with a data directory that is empty"*; `POSTGRES_INITDB_ARGS` *"can be used to send arguments to `postgres initdb`"*. `prumo/docker-compose.yml:48-54` define `postgres:17-alpine`, `POSTGRES_DB`, e **nenhum** `POSTGRES_INITDB_ARGS`.

*Correção.* Trocar "declarar no `CREATE DATABASE`" por `POSTGRES_INITDB_ARGS: "--locale-provider=icu --icu-locale=pt-BR --encoding=UTF8"` no compose, e mover a verificação para **antes da primeira migration**, com mensagem que diga explicitamente "o volume precisa ser recriado". Nota que reforça o §9.5: trocar de imagem base é trocar de libc.

---

**32 · §4.3/§4.1 — O driver trunca `timestamptz` de microssegundo para milissegundo, e o §4.3 não menciona.** `alto`

*Problema.* O §4.3 trata tempo inteiramente como propriedade do PostgreSQL. Nenhuma palavra sobre a fronteira do driver, que é onde a perda acontece: `timestamptz` vira `Date` do JavaScript, resolução de milissegundo; o PostgreSQL guarda microssegundo. `12:00:00.123456+00` chega como `.123`, sem erro. É a mesma classe de defeito que o §4.4 documenta para dinheiro no `tedious`, só que para tempo e sem o parágrafo correspondente. **Agrava o §4.1**: lá, `updated_at timestamptz` é rejeitado como token porque "duas escritas no mesmo microssegundo colidem em silêncio"; através deste driver a janela é de um **milissegundo**, mil vezes maior do que o argumento supõe. Detalhe adjacente: `register(1114, parseDate)` monta `timestamp without time zone` com `new Date(year, month, …)`, ou seja, no fuso local do processo Node.

*Evidência.* `pg-types/lib/textParsers.js:176` → `register(1184, parseDate)`; `:175` → `register(1114, parseDate)` **[reverificado]**. `postgres-date@1.0.7/index.js:33` — `ms = ms ? 1000 * parseFloat(ms) : 0`, `:38` `new Date(Date.UTC(…, ms))`; `MakeTime` aplica `ToIntegerOrInfinity`, então `123.456` vira `123` **[reverificado]**.

*Correção.* Bloco de fronteira de driver no §4.3: onde a precisão importa (janela de idempotência, ordenação de outbox, `completedAt`), ler como texto (`::text` ou `setTypeParser(1184, s => s)`) e nunca supor que o instante que voltou é o que o banco guardou. E corrigir o argumento do §4.1 — o número certo torna o argumento **mais** forte.

---

**33 · §6 — A configuração de segurança HTTP que o prumo já tem em código não está no documento, contra a própria regra de precedência da linha 28.** `alto`

*Problema.* A linha 28 estabelece que onde o ADR ficou atrás do `package.json`, vence o código. Pelo próprio critério, a configuração do Fastify do prumo é a fonte, e ela já decidiu cabeçalhos, rate limit, limite de corpo, redação de log e topologia de cookie. O §6 tem cinco linhas de camada e quatro bullets e não reproduz nada disso; o §10 não lista essas decisões nem como abertas. O resultado prático é regressão: um agente que faz scaffold a partir do §6 constrói um Fastify sem helmet, sem rate limit e com o `bodyLimit` padrão. E o §3.1 agrava: o documento desenha explicitamente para 500 requests concorrentes e responde com 409 rápido **na camada de banco**, sem nunca pôr teto na borda.

*Evidência.* Grep em STACK.md: `helmet` 0, `CSP` 0, `CORS` 0, `rate` 0, `cookie` 0, `ssl`/`TLS`/`sslmode` 0 **[reverificado]**. Já em código: `prumo/apps/server/src/http/server.ts:40` `bodyLimit: 2*1024*1024`, `:43` `register(helmet, …)`, `:50-58` `register(rateLimit, { max: 300, timeWindow: '1 minute' })` com nota escrita de que o store em memória quebra ao dividir o processo, `:34-37` `redact`; `apps/server/package.json:15-16` declara `@fastify/helmet` e `@fastify/rate-limit`; `http/session-cookie.ts:29-35` httpOnly/sameSite lax/secure/host-only. Inventário do dono: `PLANO.md:273-275`.

*Correção.* Uma tabela de borda no §6 com o mesmo peso das camadas: helmet com CSP declarada, rate limit com o store nomeado e a ressalva de multiprocesso, `bodyLimit` numérico, política de upload. Nenhum desses é "aberto" — todos já estão decididos no repositório que o documento diz que vence.

---

**34 · §2/§3 — Zod é citado quatro vezes e nunca versionado, e as duas pontas estão em majors diferentes.** `alto`

*Problema.* O §2 promete os números do que está instalado e lista 14 pacotes; Zod não está entre eles, apesar de ser nomeado no §2 (search do router), no §3 (contrato), no §3 (react-hook-form + resolvers) e no §3.2 (a projeção JSON-safe). É a única dependência que atravessa contrato, servidor e browser, e é a única sem versão — e as duas pontas que o documento funde estão em majors diferentes. Ao portar o frontend do herz para cima do `packages/contract` do prumo, o app fica com Zod 3 e Zod 4 no mesmo bundle: `z.infer` não cruza, `zodResolver` precisa saber de qual instância veio o schema, e o erro aparece como incompatibilidade de tipo em lugares sem relação aparente com Zod. O oRPC não protege disso — `@orpc/contract` é agnóstico via Standard Schema e não declara peer de zod nenhum.

*Evidência.* herz `apps/web/package.json` → `"zod": "^3.25.76"` **[reverificado]**; prumo `packages/contract/package.json:24` e `apps/server/package.json:26` → `^4.4.3`, instalado **4.4.3** **[reverificado]**. `@orpc/contract/package.json`: sem peer de zod; zod só em devDependencies.

*Correção.* Acrescentar a linha à tabela do §2 e decidir explicitamente: Zod 4 no repositório inteiro (contrato e servidor do prumo já estão lá), com o frontend do herz migrado na porta — ou 3.25.x usando o subpath `zod/v4` como ponte. O que não pode é continuar implícito.

---

## 3. CORREÇÕES DE FATO

| O que o documento diz | O que é verdade | Confirmado em |
|---|---|---|
| §10:748 — *"O oRPC tem plugin para GET com `SameSite=Lax`, que não cobre `SameSite=None`"* | O plugin é `SimpleCsrfProtectionHandlerPlugin`; vale para **toda** procedure (não só GET); é conferência de header (`x-csrf-token`, valor constante `"orpc"`); **zero relação com `SameSite`**, que é atributo de cookie | `@orpc/server/dist/plugins/index.mjs:289-320`; grep `SameSite` no arquivo = 0 **[reverificado]** |
| §68 (tabela de proveniência) — *"Preview de link não executa JS · crawler / especificação OG"* | A camada dona é o **framework** (o que é emitido). Nenhuma das quatro fontes nomeadas afirma isso; a doc do TanStack Start afirma | `ogp.me`; `developers.facebook.com/…/web-crawlers/`; `api.slack.com/robots`; `linkedin.com/help/…/a521928`; TanStack Start, SPA mode |
| §10:744 — *"SPA não entrega `og:image` — WhatsApp, LinkedIn, Slack e Discord não executam JS"* (implicando SEO junto) | Googlebot **renderiza JS**: *"a headless Chromium renders the page and executes the JavaScript."* Indexação e unfurl são dois problemas com donos e custos diferentes | Google Search Central, *javascript-seo-basics* |
| §10:744 — TanStack Start como saída | Em **SPA mode** o Start prerenderiza só a raiz e salva um `/_shell.html` único: meta idêntico para toda URL. O que resolve é prerender com `crawlLinks` ou SSR | doc TanStack Start, SPA mode e static-prerendering |
| §4.4:375 — *"o `pg` devolve `numeric` como string por padrão"* apresentado como propriedade do driver | Vale para o **escalar** e só no **protocolo texto**. `numeric[]` (1231) → `parseFloat`; `jsonb` (3802) → `JSON.parse`; `numeric` binário (1700) → `Math.round(result*scale)/scale` | `pg-types/lib/textParsers.js:189,203`; ausência de 1700 em textParsers; `binaryParsers.js:241` **[reverificado]** |
| §4.3 — tempo tratado só como propriedade do PostgreSQL; §4.1:345 — *"mesmo microssegundo"* | `timestamptz` → `Date` de **milissegundo**. A janela de colisão do argumento do §4.1 é mil vezes maior do que ele supõe | `textParsers.js:176`; `postgres-date@1.0.7/index.js:33,38` **[reverificado]** |
| §4.6:433 — citação do `RESET ROLE` com elipse | A elipse elide a oração principal: *"RESET ROLE sets the current user identifier to the connection-time setting specified by the command-line options, ALTER ROLE, or ALTER DATABASE, if any such settings exist."* | PostgreSQL 17, `sql-set-role` |
| §4.6:438 — *"O teste afirma só `current_user`"* | O teste afirma **três** coisas (`current_user`, `rolsuper`, `rolbypassrls`). A observação correta e mais forte é outra: as três estão escopadas por `WHERE rolname = current_user`, e `session_user` não é inspecionado em lugar nenhum do repositório | `prumo/apps/server/tests/database.test.ts:184-194`; grep `session_user` em `prumo/apps`+`packages` = 0 **[reverificado]** |
| §4.6:477 — *"Revogar em bloco tira `gen_random_uuid()` da aplicação"* | Com `pgcrypto` removido (decidido no §4:323), `gen_random_uuid()` é função core em `pg_catalog`, não criada por `db_owner`, portanto fora do alcance de `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner`. O deploy descrito não quebra; o risco real é `citext` | PostgreSQL, `functions-uuid`, `pgcrypto`, `sql-alterdefaultprivileges` |
| §5.2:630 — *"Payload limitado a 8 kB"* | 8000 bytes, não 8192 — *"In the default configuration it must be shorter than 8000 bytes."* | PostgreSQL, `sql-notify` |
| §5.1:589-595 — `FOR UPDATE SKIP LOCKED LIMIT $1` | Aceito, mas **não é a ordem do synopsis**: a cláusula de bloqueio vem depois de LIMIT/OFFSET/FETCH. É sintaxe legada não documentada, num bloco escrito para ser copiado | PostgreSQL, `sql-select`, synopsis; jOOQ issue #15826 |
| §3.1:239 — 409 · `Retry-After` | `ORPCError` não transporta header: `toJSON` serializa `defined`, `code`, `status`, `message`, `data`. O header sai via `ResponseHeadersPlugin`. E o *"202 em andamento"* da linha 223 não é expressável como `ORPCError` (`isORPCErrorStatus`: `status < 200 \|\| status >= 400`) | `@orpc/client/…/client.CZlviB0y.mjs:123,133,173`; `@orpc/server/…/plugins/index.mjs:331` **[reverificado]** |
| §4.4:378 — *"`pg` também devolve `bigint` (`int8`) como string. Esperar `number` quebra"* | Verdade como default do driver; **falso como descrição do repositório**: o prumo já registra `setTypeParser(INT8, BigInt)`. O override é global ao processo (`pg.types` é singleton de módulo) e vale para os dois pools e para os testes | `textParsers.js:167`; `prumo/…/connection.ts:32` **[reverificado]**; `pg-types/index.js:11-14,33-39` |
| §2:125 — *"Componentes · shadcn/ui sobre `@base-ui/react` · 1.6"* | 1.6 é o `@base-ui/react`; todas as outras linhas versionam o pacote nomeado primeiro. O CLI `shadcn` está em 4.16.0 (herz) e 4.19.0 (prumo) | herz `apps/web/package.json`; `prumo/node_modules/shadcn/package.json` **[reverificado]** |
| §2:114 — *"Estes números são o que está instalado"* | Não diz **onde**. Contra o herz, os 14 batem; contra o prumo, quatro já divergem (`@base-ui/react` 1.7, lucide 1.34, react-query 5.102, shadcn 4.19) e a tabela descreve um app que o prumo não tem. Faltam ainda seis dependências reais: `recharts`, `react-error-boundary`, `date-fns`, `class-variance-authority`, `tailwind-merge`, `clsx`, mais `zod` e `@ts-rest/core` (revogado no §3 e ainda instalado) | herz `pcp-herz/apps/web/package.json` **[reverificado]**; prumo `node_modules` |
| §2 — *"33 componentes shadcn stock sobre `@base-ui/react`"* | 23 dos 33 importam `@base-ui/react`; 3 embrulham outra biblioteca (`chart`→recharts, `command`→cmdk, `sonner`→sonner); 7 não têm primitivo | contagem em `herz/apps/web/src/components/ui/` **[reverificado]** |
| §2:135 — *"a animação vem de graça — zero `@keyframes`, zero framer-motion"* | Correto no essencial. Ressalva: as 12 ocorrências de `animate-spin` são **Tailwind core**, não `tw-animate-css`; e `prefers-reduced-motion` tem zero ocorrências no app inteiro | grep em `herz/apps/web/src` |
| §7:659 — `APROVADO 12/12` | A tabela abaixo tem **10** linhas. Numa seção cuja tese é que o denominador precisa ser verdadeiro, o exemplo tem denominador errado | STACK.md:662-672 **[reverificado]** |
| Histórico:16 — *"Oito rodadas"* · §44 e §86 — *"seis rodadas"* | Existem oito arquivos de rodada em `rebar/docs` (`RESPOSTA-REVISAO.md` + `-2..-8`). E a linha 44 diz que os dois últimos princípios nasceram de erros deste documento, mas o princípio 2 é justificado como medição sobre seis repositórios | `ls rebar/docs` **[reverificado]** |
| §4:326 — Kysely `^0.29.5` + `pg` `^8.23.0`, ADR 0005 diz "0.28/8.13" | **Correto.** Instalados: kysely 0.29.5, pg 8.23.0, pg-pool 3.14.0, @types/pg 8.23.1, @orpc/* 1.15.0 | `node_modules` do prumo **[reverificado]** |
| §3:150 — mapa de status do oRPC cobre 400/401/403/404/409/422/429/503 | **Correto** | `client.CZlviB0y.mjs:25-102` **[reverificado]** |
| §4.6:447 — `GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE` | **Sintaxe válida** (PostgreSQL 16+); a doc traz `GRANT island TO joe WITH INHERIT TRUE, SET FALSE;` | PostgreSQL, `role-membership` |
| §4.6:518-520 — as três asserções de `pg_has_role` | **Corretas**, e `MEMBER` cobre pertencimento indireto, o que fecha o `SET ROLE` encadeado | PostgreSQL, `functions-info` §9.27.2; `role-membership` |

---

## 4. CONTRADIÇÕES INTERNAS

Ordenadas por custo. Cada uma vale mais que qualquer achado externo, porque nenhuma delas precisa de fonte de fora para ser resolvida — e todas passaram por oito rodadas de revisão sem serem vistas.

| # | Contradição | Seção A | Seção B |
|---|---|---|---|
| 1 | **Duplicate-in-flight:** "Escolhido: esperar e replicar" × "duplicate-in-flight nunca espera ocupando transação ou conexão do pool". A tabela e o critério de aceitação seguem a versão rejeitada | §3.1:225 (+ :179, :208) | §3.1:229-234, :237-239 |
| 2 | **409:** "409 · Retry-After" (retente) × "409, nunca retry automático" (não retente) × §6 "conflito de versão não é transitório" | §3.1:239 | §4.1:355, §6:651 |
| 3 | **`pgcrypto`:** "`pgcrypto` sai" × "`pgcrypto` e `citext` criam funções com EXECUTE para PUBLIC… tira `gen_random_uuid()` da aplicação" — o exemplo que justifica o endurecimento usa um objeto que a decisão do §4 já removeu | §4:323-325 | §4.6:477 |
| 4 | **Credencial de owner no runtime:** "o runtime nunca autentica com credencial de privilégio superior a `app`" × migrations no boot, em pool dentro do mesmo processo, com duas services apenas | §4.6:429 | §4.5:389, §4.6:562, §8:682 |
| 5 | **RLS:** classificada como "**Ganho real**" com ponteiro para §4.6 × listada como 🔴 aberta e condicional ("Se RLS for usada…"). E o §4.6 não contém nenhum desenho de RLS | §1:104 | §10:747, §4.6 inteiro |
| 6 | **O gate de saúde:** "Checar `current_user` prova que a configuração foi aplicada. Só o teste hostil prova que a fuga não funciona" × o gate de boot checa `current_user` e não checa `session_user` | §4.6:514, :522 | §4.6:564 |
| 7 | **Atributos de role:** a tabela declara `NOSUPERUSER · NOBYPASSRLS · NOCREATEDB · NOCREATEROLE` em `app` (que é `NOLOGIN`) × o teste hostil afirma esses quatro em `app_login`, a única role que autentica. A tabela vira migration, o teste vira CI | §4.6:443-444 | §4.6:522 |
| 8 | **"Versão":** a tabela de decisão discrimina por `operationVersion` (campo do cliente) × "comparação de hash só vale dentro da mesma versão", onde a versão é `idempotencySchemaVersion` (do servidor). Saídas opostas para a mesma entrada | §3.2:285-289, :297-298 | §3.2:317 |
| 9 | **Determinismo:** digest de imagem fixado porque tag móvel "contradiz a filosofia de determinismo do resto" × `shadcn add` no scaffold, que é tag móvel sem lock, sem hash e sem versão por item | §9.5:736 | §4 (a decisão de rodar `shadcn add`) |
| 10 | **Versionamento:** "MAJOR sobe quando uma decisão fechada é revertida ou trocada" × 0.6 remove o `ALTER ROLE … SET role`, 0.7 remove o `pgcrypto` e troca o escopo da chave, 0.8 troca a espera limitada pelo fail-fast — três reversões, todas MINOR. E a única subida de MAJOR não é reversão nenhuma | Cabeçalho:6-8 | Histórico:16-19 |
| 11 | **Contagem de rodadas:** "Oito rodadas" × "Saíram de seis rodadas" × "nestas seis rodadas" | Histórico:16 | Princípios:44, :86 |
| 12 | **Contagem de passos:** `APROVADO 12/12`, numa seção cuja tese é que o denominador precisa ser verdadeiro × tabela de 10 linhas | §7:659 | §7:662-672 |
| 13 | **`config/`:** regra determinística "`process.env` fora de `config/`" × a tabela de camadas que o `dependency-cruiser` impõe não tem `config/` | §9.2:706 | §6:644-648 |
| 14 | **Fixture impossível:** "migration antiga editada" listada como regra determinística × o harness exige par `aprovar/`/`reprovar/` com `@expect-rule`, e nenhum arquivo em `reprovar/` pode representar uma propriedade do histórico do VCS | §9.2:706 | §9.3:717, :724 |
| 15 | **`int8`:** "o `pg` devolve `bigint` como string; esperar `number` quebra" × a regra de precedência da linha 28 ("vence o código"), e o código já sobrescreve para `BigInt` | §4.4:378 | Precedência:28 + `prumo/…/connection.ts:32` |
| 16 | **§2 contra si mesmo:** "Estes números são o que está **instalado**" × a tabela não diz onde, omite seis dependências, e já está atrás do prumo em quatro pacotes — a regra da linha 28 é aplicada ao Kysely e ao `pg` no §4 e não é aplicada aqui | §2:114 | Precedência:28 |
| 17 | **CSRF × topologia:** "CSRF nasce junto com a decisão de autenticação" × a variável que força `SameSite=None` é a topologia de origem (linha 744), não a autenticação. E o §2 mantém Vite SPA enquanto o §10 empurra TanStack Start | §10:748 | §10:744, §2 |
| 18 | **Ponteiro errado:** "Driver — Troca direta — ver §4.6" × §4.6 é a seção de privilégio; o driver está no preâmbulo do §4 e no §4.4 | §1:95 | §4, §4.4 |
| 19 | **"Zero linha = conflito":** regra sem ressalva × RLS adotada como "a segunda porta", sob a qual linha invisível produz o mesmo zero | §4.1:355 | §1:104, §4.6, §10:747 |

---

## 5. NÃO VERIFICADO — dívida de verificação, **não** achado

Nada abaixo entrou em BLOQUEANTES. Cada item é uma afirmação que um agente **não conseguiu confirmar na camada dona**, listada aqui para que ninguém a trate como fato.

**Ambiente.** Nenhum agente conseguiu executar contra um PostgreSQL real: o Docker Desktop está instalado (29.4.3) mas o daemon não roda, e não há `psql` no PATH. Toda afirmação sobre comportamento de servidor vem de doc oficial do PostgreSQL 17 ou de código-fonte de `REL_17_STABLE`, não de saída de comando. As afirmações sobre driver vêm do código instalado em `prumo/node_modules`, com reprodução em `node` onde aplicável.

1. **A simultaneidade que sustenta o §3.1 inteiro.** A premissa 1 (STACK.md:246-247) afirma que o advisory xact lock é liberado "o mesmo instante em que a linha de idempotência fica visível". Se a liberação acontecer **antes** de o commit entrar no proc array, existe uma janela em que B adquire o lock, não enxerga a linha de A, e cai no INSERT que bloqueia no índice único — o buraco de pool que a v0.8 fechou, agora sem caminho de fail-fast. A doc do PostgreSQL não faz essa afirmação em `functions-admin`, `explicit-locking`, `transaction-iso` nem `mvcc`. Confirmar exige ler `src/backend/access/transam/xact.c` (ordem de `RecordTransactionCommit` / `ProcArrayEndTransaction` / `ResourceOwnerRelease`). **É o mesmo padrão de erro que o documento diz ter cometido duas vezes.** Prioridade máxima na fila de verificação.
2. **`has_table_privilege('app_login','public.pedido','SELECT') → false` sob `GRANT … WITH INHERIT FALSE`.** A seção "Access Privilege Inquiry Functions" da doc 17 não especifica se essas funções contam privilégio alcançável só via `SET ROLE`, ao contrário de `pg_has_role`, que é explícita. É premissa não escrita segurando uma asserção de fitness test. Se der `true`, a asserção de catálogo correta é `pg_has_role(…,'USAGE') = false` — que **é** documentada. Rodar uma vez contra PostgreSQL 17 real e fixar o resultado como fixture, com comando e saída registrados.
3. **Se `kysely-ctl` envolve o `Migrator` de outro jeito.** O documento prescreve "Kysely + kysely-ctl", e `kysely-ctl` **não está instalado** em `prumo/node_modules`. Tudo o que foi afirmado sobre transação única, chave de lock e `lock_timeout` vem do `Migrator` e do `PostgresAdapter` do kysely 0.29.5. Se o CLI envolver diferente, o bloqueante #9 precisa ser reconferido contra ele.
4. **Se o pool de admin do prumo entrega a mesma conexão física para os três statements de advisory lock.** Com `max: 2` e execução serial o `pg-pool` reutiliza o cliente ocioso, então o defeito do #29 é **latente**, não observável hoje. O que está verificado: nada no código o impede, e o próprio Kysely fixa a conexão para o seu lock interno.
5. **Não existe implementação de outbox nem de registro de idempotência em nenhum dos dois repositórios.** Grep por `outbox` em `prumo/apps` e `prumo/packages` não encontra tabela nem worker. Todos os achados de §5.1 e §3.1 são contra o **desenho descrito**, não contra código rodando.
6. **Se o teste hostil realmente permanece verde com `pg_read_all_data` concedido.** A conclusão do #7 vem de compor `predefined-roles.html` (nenhuma role predefinida é superusuária nem tem BYPASSRLS) com o texto literal das sete asserções. É dedução a partir de duas fontes primárias, não execução.
7. **Se a musl libc do `postgres:17-alpine` degrada especificamente as collations não-C do provedor libc.** Confirmado que o comportamento do provedor libc varia por plataforma e que o ICU é independente do SO; não achada fonte primária (musl ou docker-library/postgres) sobre o comportamento concreto no alpine. **O bloqueante #31 não depende disso** — depende de o banco ser criado pelo entrypoint, que está documentado.
8. **A gramática do PostgreSQL para `FOR UPDATE` antes de `LIMIT`.** `src/backend/parser/gram.y` do `REL_17_STABLE` veio truncado antes de `select_no_parens`. Verificado: o synopsis põe a cláusula de bloqueio por último, a seção Compatibility nada diz sobre a ordem inversa, e uma issue do jOOQ a descreve como ordem não documentada aceita.
9. **Se o PostgreSQL redige valores no `errdetail` de violação de CHECK e NOT NULL** (`ExecBuildSlotValueDescription`) do mesmo modo que faz para índices. Por isso o achado sobre log restringe a afirmação a `where`, `internalQuery`, `constraint` e `hint`, que comprovadamente não passam por redação.
10. **O `max_connections` efetivo da imagem `postgres:17-alpine`.** O 100 vem da doc ("typically 100"); não verificado se a imagem alpine sobrescreve no `postgresql.conf` gerado pelo `initdb`.
11. **O `TimeZone` default do container `postgres:17-alpine`.** O mecanismo do `RESET ALL` apagando o `SET TIME ZONE 'UTC'` está provado; se o default do cluster já for UTC, o efeito prático nesse caso é nulo (o dos timeouts não é).
12. **Se o Docker Compose deixa de reiniciar um container `unhealthy` com `restart: unless-stopped`.** A afirmação sobre "boot pendurado sem ninguém reiniciar" está apoiada em leitura do compose, não em teste.
13. **Declaração oficial de que o crawler não executa JavaScript.** Não encontrada em nenhuma das quatro plataformas nomeadas; do Discord não há doc pública; `developer.x.com` devolveu HTTP 402. A afirmação é quase certamente verdadeira na prática, mas hoje só tem fonte secundária — e é por isso que o bloqueante #13 é sobre proveniência, não sobre a conclusão.
14. **As versões instaladas do herz.** O repositório não tem `node_modules`; usados `package-lock.json` e `package.json`, que trazem versões travadas e concordam entre si, mas não são árvore instalada.
15. **`npm install` resolve sem peer conflict e sem override** (§3:153). Verificado que não há chave `overrides` e que o peer relevante do `@orpc/tanstack-query` é satisfeito nos dois repositórios; `npm install`/`npm ls` não foram rodados.
16. **Byte-a-byte contra o registro do shadcn:** apenas `badge.tsx` foi diferenciado (idêntico). Os outros 32 têm evidência indireta (sem comentário em português, convenções intactas). **`shadcn add` não foi executado** — a evidência de onde o comando escreve vem da especificação de `registry-item` e do `dist` do CLI 4.19.0.
17. **`tsc` com `exactOptionalPropertyTypes` no herz** não foi rodado (sem `node_modules`). O volume de erro em `src/components/ui` é **risco declarado, não medição** — e a colisão com o §4 (regenerar `ui/` com `shadcn add`) é real: ou a flag ganha exceção declarada para `ui/`, ou cada `add` pode quebrar o `tsc`.
18. **Bundle, LCP, CLS e INP não foram medidos.** As afirmações são sobre ausência de configuração e de passo de verificação, não sobre valores.
19. **Os números de contraste WCAG** vêm de script próprio (OKLCH → sRGB → luminância relativa, sem gamut mapping, com clamp). Não conferidos contra ferramenta de referência independente.
20. **`oxlint --rules`** não produziu saída capturável; verificado apenas que `--jsx-a11y-plugin` existe e é desligado por padrão. A afirmação do §9.1 de que os plugins JS do oxlint estão em alpha e não recebem type-awareness **não foi conferida na doc do oxlint**, que é a camada dona.
21. **O painel do alicerce** não estava acessível. O documento o cita cinco vezes, inclusive para revogá-lo, sem nunca dizer o que é nem onde está — o que colide com a exigência do próprio princípio 3 de que a citação nomeie o componente.
22. **Corpo dos ADRs 0003, 0011 e 0013** do prumo não lido (só títulos, que batem). O ADR 0005 foi conferido palavra por palavra e confere.
23. **Se a matriz de CI Windows + Linux do §7 consegue rodar "Integração com Postgres real" nos dois lados.** O documento não nomeia o provedor, então não há camada dona a consultar. Tensão a checar quando o provedor for escolhido.
24. **`@fastify/compress` com SSE** — o pacote não está instalado; entrou apenas como decisão ausente ligada à inexistência de decisão sobre proxy reverso / terminador TLS.
25. **A suíte do prumo e o `verificar` não foram rodados.** Todas as afirmações sobre o código de referência são leitura de arquivo, com caminho e linha.

---

## 6. DUPLICATAS E DISCORDÂNCIAS

### Consolidadas (mesmo achado por duas ou mais lentes)

| Achado consolidado | Lentes | O que cada uma acrescentou |
|---|---|---|
| **Outbox: `lease_until` escrito e nunca lido** (#1) | Concorrência (crítico), Coerência (alto) | Concorrência trouxe a sequência temporal com dois workers e o literal do `sql-select` sobre SKIP LOCKED; Coerência trouxe `explicit-locking` §13.3.2 sobre liberação de lock de linha no commit. **Gravidade adotada: crítico** |
| **Três timeouts de servidor ausentes** (#17) | Concorrência (alto), Produção (crítico), Segurança (implícito) | Concorrência trouxe o caminho ROLLBACK-que-falha e o `_release` do pg-pool sem limpeza; Produção trouxe o vetor `RESET ALL` e a correção via `ALTER ROLE` em vez de `SET`. **A correção de Produção é a que fecha** |
| **Fila do pool ilimitada + orçamento de conexão inexistente** (#16) | Concorrência (alto), Produção (crítico ×2) | Concorrência mostrou que o DoS migrou do índice único para `_pendingQueue`; Produção somou o rolling deploy dobrando a demanda e `max_connections`. Fundidos porque a correção é a mesma |
| **Retenção de idempotência** (#24) | Concorrência (alto), Produção (alto) | Concorrência trouxe a sequência do purge job reintroduzindo cobrança dupla; Produção trouxe o argumento decisivo — **TTL é cláusula de contrato, não faxina**, e por isso não existe momento seguro de escolhê-lo depois |
| **CSRF: o plugin descrito não existe** (#12) | Factual (alto), Coerência (medio), Segurança (acoplamento) | Factual e Coerência chegaram ao mesmo código, independentemente; Segurança contribuiu a dependência real (topologia de origem, não autenticação). Todas as três confirmadas no código **[reverificado]** |
| **`numeric[]` volta como float** (#10) | Factual (alto), Segurança (alto) | Factual acrescentou o protocolo binário; Segurança acrescentou o `jsonb` → `JSON.parse` e o ataque ao replay de idempotência, que é a metade mais grave |
| **`SET ROLE ${role}` sem quoting** (#15) | Factual (medio), Segurança (baixo) | Idênticos. Segurança acrescentou "é o único código executável da seção mais forte, portanto será copiado literalmente" |
| **`pgcrypto` como exemplo vivo depois de removido** (#3 nas contradições) | Factual (alto), Coerência (alto) | Idênticos. Factual acrescentou que `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` não alcança `pg_catalog` |
| **`int8` já sobrescrito no prumo** | Factual (baixo), Segurança (baixo) | Segurança acrescentou o modo de falha que faz reverter a correção: `count(*)` vira `BigInt` e `JSON.stringify` lança na fronteira do oRPC, num caminho sem dinheiro nenhum |
| **409 com semânticas incompatíveis** (#11) | Concorrência (alto), Coerência (alto) | Concorrência trouxe o RFC 9110 e o `PRECONDITION_FAILED` não usado; Coerência trouxe o enquadramento por `type` RFC 9457 e a linha órfã do §7. Fundidos |
| **Migration no boot** (#9, #18, #19, #29) | Concorrência ×3, Produção ×2, Coerência ×1 | Quatro mecanismos **distintos** sobre a mesma decisão, não duplicatas: transação única + `lock_timeout`; `corrupted migrations` matando o rollback; credencial de owner no runtime; lock de sessão em conexão não fixada. Mantidos separados porque as correções são diferentes |
| **Frontend §2 desatualizado/incompleto** (#34 e correções de fato) | Factual (medio), Frontend (medio) | Factual mediu a divergência contra o prumo; Frontend enumerou as seis dependências omitidas e o `shadcn` em `dependencies`. Complementares |

### Discordâncias resolvidas

**(a) "O teste do prumo afirma só `current_user`" — a lente Factual contra a lente de Coerência.**
Coerência tratou a linha 438 como descrição correta do defeito medido e concentrou o achado na linha 564. Factual afirmou que a linha 438 é **factualmente falsa**: o teste afirma três coisas. **Vence Factual**, pelo critério do próprio documento — citou a camada dona da propriedade (o arquivo de teste do prumo) com caminho e linha, e eu reconferi: `database.test.ts:184-194` traz três `expect`, e as três estão escopadas por `WHERE rolname = current_user` **[reverificado]**. Os dois achados sobrevivem, porém, porque são coisas diferentes: a redação da 438 está errada **e** o gate da 564 está incompleto. A observação correta é mais forte que a do documento: é o escopo do `WHERE`, não a contagem de asserções, que deixa a fuga aberta — e `session_user` não é lido em lugar nenhum do repositório.

**(b) O `Migrator` do Kysely fixa a conexão? — Concorrência contra Produção.**
Produção registrou como não verificado e formulou o achado do lock de migration como "premissa ausente". Concorrência afirmou que o Kysely **fixa** (`migrator.js:443-447`, `this.#props.db.connection().execute(...)`) e usou isso como contraste para mostrar que fixar é o requisito. **Vence Concorrência**, com citação de código na camada dona; reconferido: `migrator.js:445` e `:447` executam dentro de `this.#props.db.connection()` **[reverificado]**. A consequência é que o achado fica **mais forte**, não mais fraco: o lock hand-rolled do `migrate.ts` é a única peça que não fixa, e é redundante com um lock interno que já fixa — ou seja, superfície de erro pura.

**(c) Quantas armadilhas restam no §4.4?**
Factual disse quatro (as duas listadas + `numeric[]` + binário); Segurança disse três (as duas + `numeric[]` + `jsonb`). Nenhuma das duas está errada; as duas listas são parciais. Consolidado: **cinco** — `bigint` (já sobrescrito no prumo, portanto o texto está errado sobre o repositório), `float8`, `numeric[]`, `jsonb`, `binary: true`.

**(d) Gravidade do achado de WCAG.**
Frontend marcou crítico. Como revisor-chefe, **rebaixado a PODE ESPERAR** com a decisão destacada: as quatro falhas são retrofitáveis (tokens OKLCH em arquivo de texto), então não fecham porta. O que não pode esperar é **nomear o nível** — "AA" sem versão não decide SC 2.4.11 nem 2.5.8.

**(e) Sem discordância real:** as lentes de Concorrência e Coerência chegaram ao achado do outbox por caminhos diferentes (uma pela semântica de `SKIP LOCKED`, outra pela leitura literal do predicado) e convergiram na mesma correção. Isso é o sinal mais forte da revisão inteira.

---

## 7. PODE ESPERAR

Real, verificado, e não bloqueia a primeira linha de código. Cada item com o gatilho que o transforma em bloqueante.

| Item | Onde | Vira bloqueante quando |
|---|---|---|
| **Nível WCAG não nomeado**, e quatro falhas computáveis na base herdada: `lang="en"` num app pt-BR (SC 3.1.1, A); foco no tema claro 2.54:1 e o padrão real `ring-ring/50` em 1.53:1; `border-input` em 1.27:1; `--chart-1` em 2.52:1 (SC 1.4.11, AA). Os cinco pares fundo/texto das famílias **passam** AA nos dois temas | §10:750, `herz/apps/web/src/index.css`, `index.html:2` | Antes de escrever o primeiro componente. **Decida o nível agora** (WCAG 2.2 AA), ligue `jsx-a11y` no oxlint (uma linha), e o teste de contraste sobre os tokens é barato porque a paleta é dado, não pixel |
| **Ordem de cláusula `FOR UPDATE`/`LIMIT`** e **"8 kB" → 8000 bytes** | §5.1:594, §5.2:630 | Nunca — mas são duas linhas, e o bloco do §5.1 é o que os agentes copiam. Aproveitar a correção do #1 |
| **`LISTEN` sobre o pool morre em silêncio** (registro é de sessão; `idleTimeoutMillis` descarta a conexão e o LISTEN some sem erro) | §5.2 | Quando NOTIFY for implementado. O poller salva do pior, e por isso não bloqueia — mas o ganho de latência que o §5.2 promete simplesmente não ocorre. Correção: `pg.Client` dedicado, fora do pool, com re-LISTEN após queda, e um teste que mate a conexão do listener |
| **Retenção de outbox não decidida** (a linha é marcada, não apagada → cresce para sempre); **índice parcial nunca nomeado** ao lado da query; `autovacuum_vacuum_scale_factor` 0.2 é tarde para tabela de alta rotatividade | §5.1 | Antes da primeira carga real. Particionar por data para que o expurgo seja `DROP PARTITION`, não `DELETE` em massa — que gera exatamente o bloat que se quer evitar |
| **Observabilidade sem uma única métrica nomeada.** As duas que este desenho precisa custam zero: o pool já expõe `totalCount`/`idleCount`/`waitingCount`/`expiredCount` como getters, e o lag do outbox é uma query de uma linha | §8:755 | No primeiro incidente. Sem `waitingCount` não há como distinguir "o banco está lento" de "o pool está cheio" |
| **Sem decisão de TLS para o banco**, e o `pg` 8.23 já trata `prefer`/`require`/`verify-ca` como aliases de `verify-full` com aviso de depreciação — no `pg@9.0` a semântica muda para a do libpq, e a correção mais curta que um agente encontra é `?sslmode=no-verify`, que é `rejectUnauthorized = false` | §4, §8 | No dia em que o Postgres deixar de ser container irmão. Pôr a mudança do 9.0 no mesmo parágrafo do shim do `@types/pg` (§4.6:556), que já é a lista de coisas a revisitar |
| **Rotação de log e disco cheio são o mesmo item.** O driver `json-file` do Docker não rotaciona por padrão (`max-size` default `-1`), e disco de WAL cheio faz **PANIC**, não degradação | §8:755 | Antes do primeiro deploy que fique de pé mais de uma semana. Três linhas no compose |
| **Erro do `pg` carrega `detail`/`where`/`internalQuery` e o serializer do pino copia toda propriedade própria** (`for..in`) e anexa `raw`. "Mascarado na saída" é a resposta HTTP; o log é outro caminho | §6:653 | Quando houver dado pessoal em produção. O `redact` da referência usa paths fixos, que não alcançam a forma do `DatabaseError` |
| **`SECURITY DEFINER` escrito como quatro condições sobre como a equipe escreve função**, e não como varredura de catálogo — então não vê a função que a equipe não escreveu, que é a perigosa | §4.6:500-510 | Junto com o fitness test do #7. Vira uma consulta: `pg_proc` join `pg_namespace`, `prosecdef = true`, afirmando `proconfig`, `proacl` e `proowner` |
| **Upgrade de major do Postgres e rotação de segredo.** No 17→18 muda até o caminho do volume; e o `pg.Pool` captura as opções na construção, então rotação de senha é rolling restart, e na janela o pool não cresce | §8:755, §9.5 | No primeiro ano. Registrar que duas senhas nunca coexistem para a mesma role — logo, role nova + GRANT, não `ALTER PASSWORD` |
| **Catálogo de verificações: 10 no §7, "12/12" no cabeçalho, 15 no PLANO chamado de "13".** As cinco ausentes são componente, acessibilidade, regressão visual, **carga** e **smoke** — e as duas últimas são exatamente as que pegariam os bloqueantes #16, #20 e #23 antes do usuário | §7, PLANO.md:359-360 | Junto com a correção da contagem. Acrescentar carga (critério = o "limite declarado" do #16) e smoke pós-deploy; componente/a11y/visual podem ficar fora **com justificativa escrita** |
| **`config/` não é camada** e **"migration antiga editada" não pode ter fixture** | §9.2:706, §9.3:724 | Quando o harness de fitness test for construído. Separar regra de conteúdo (lint, com fixtures) de regra de histórico (checagem de diff no CI) |
| **Regra de versionamento × histórico; "seis" × "oito" rodadas; ponteiro do driver para §4.6; decisões no corpo sem entrada no histórico** (NFC→JCS, `exactOptionalPropertyTypes`, digest, matriz de CI) | Cabeçalho, Histórico, §1:95 | Nunca funcionalmente — mas o documento afirma que documento sem histórico não prova que não derivou, e o histórico dele derivou |
| **Nomes das cinco famílias de cor.** Proposta que serve aos três presets: `status-pending` / `status-active` / `status-blocked` / `status-retry` / `status-done`, com sufixo unificado ao do shadcn (`-foreground`, `-border`), a divisão escrita entre `destructive` (intenção) e `status-blocked` (estado), e lint restringindo `bg-status-*` ao mapa. Apagar junto a declaração duplicada de `--chart-1..5` nos dois temas, antes que um `shadcn add` decida por você | §10:751 | Antes do primeiro componente novo. A paleta em si não precisa mudar — só `--chart-1` |
| **i18n não existe, e a formatação de número já é não-determinística:** seis `toLocaleString()` sem locale usam o locale do runtime. O §7 fixa relógio, seed e fuso e **não fixa locale** | §7:674 | Imediatamente **se** o preset `site` for para SSR ou prerender — é mismatch de hidratação silencioso. Um módulo `formato.ts` com locale explícito, mais lint proibindo `toLocaleString` fora dele |
| **Lacunas de frontend mal inventariadas.** Já existem no herz: error boundary (`main.tsx:68`) e estado de carregamento (`padroes/estados.tsx`, com `role="alert"` e `aria-busy`). Falta de verdade: `form.tsx` (e a decisão explícita de **não** adotá-lo), **orçamento de bundle** (`vite.config.ts` tem 17 linhas, sem `build`, sem `size-limit`, e o §7 não tem passo de tamanho), **preload de fonte**, **política de imagem** (zero `<img>`, `loading`, `srcset` no app inteiro) e **Core Web Vitals** | §2, §10 | Quando o preset `site` sair do papel. Bundle e CWV dependem do #13 estar resolvido, porque só então se sabe qual HTML medir |
| **`prefers-reduced-motion`: zero ocorrências no app inteiro.** Fora do escopo AA (é SC 2.3.3, AAA), mas o preset `site` terá mais movimento que um app de PCP | §2:135 | Junto com o renome das famílias. Um bloco `@media` no `index.css`, pelo mesmo argumento que o herz já usa para o bloco de cursor |

---

### Nota final do revisor-chefe

O documento não está pronto, e **não está longe**. Doze dos trinta e quatro bloqueantes são correções de texto sobre coisas que o documento já sabe: reescrever a linha 225, tirar a elipse da 433, acrescentar `session_user` à 564, trocar o exemplo da 477, ajustar o snippet da 538. Outros nove são decisões de uma linha que só precisam existir (isolamento, timeouts, retenção, orçamento de conexão, TLS, collation no compose). O resto — a posse do lease no outbox, a partição do espaço de chave, o `effectStatus`, o trigger de `version`, a assimetria RLS/GRANT — é desenho de verdade, e cada um desses cinco é do tipo que é barato agora e caro depois de existir dado.

A recomendação operacional é a que o próprio documento prescreveria: **não abrir v1.1**. Abrir **v2.0**, porque três decisões fechadas serão revertidas (esperar-e-replicar, migration no boot como está, e o 409 único), e a regra de versionamento da linha 6 diz exatamente isso — regra que o histórico até hoje nunca aplicou.