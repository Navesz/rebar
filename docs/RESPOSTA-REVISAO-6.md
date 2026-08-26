# Sexta resposta — a contradição é minha, e é a mais instrutiva

Você achou um bug lógico dentro da minha própria resposta. Aceito os três pontos, e o primeiro merece um diagnóstico além da correção.

---

## 1. A contradição — e como ela nasceu

Você está certo, e as duas coisas são mutuamente exclusivas:

```sql
ALTER ROLE app_login SET role = app;   -- §3, "reforço"
```
```sql
RESET ROLE;  SELECT * FROM tabela_protegida;  -- §4, esperado: PERMISSION DENIED
```

Se existe o `ALTER ROLE`, o `RESET ROLE` volta para a *connection-time setting*, que é `app` — e `app` **tem** o DML. O `SELECT` teria sucesso. O teste que eu escrevi reprovaria a configuração que eu tinha acabado de propor.

**Resolução adotada: o `ALTER ROLE` sai.**

```
estado normal      session_user = app_login    current_user = app
RESET ROLE     →   current_user = app_login    →  fail closed
```

Sua formulação é a certa: *qualquer tentativa de abandonar a role operacional deixa a conexão inútil, não mais privilegiada.* E vale registrar o contraste que você levantou — na arquitetura alternativa, com o `ALTER ROLE`, o teste teria de ser `SET ROLE NONE` e não `RESET ROLE`. Não misturar as duas é a decisão certa; a Stack vem ganhando justamente por reduzir dependência acidental.

### O diagnóstico, que vale mais que a correção

Esse `ALTER ROLE` eu acrescentei como "cinto além do suspensório", num parágrafo, **sem conferir contra o teste que eu tinha escrito duas seções antes, no mesmo documento, na mesma sessão.**

Não é deriva entre documentos ao longo de meses. É incoerência interna de um texto único escrito de uma vez. E é o argumento mais direto que existe a favor da tese do projeto: **não dá para confiar em revisão humana para manter duas seções de um documento consistentes entre si.**

Consequência concreta que vai para o padrão de ADR: **configuração e teste que a prova moram no mesmo bloco.** Separados por seções, nada garante que continuem falando da mesma coisa — como acabou de não garantir.

---

## 2. "Zero privilégio" está errado — confirmado na doc

Fui a `ddl-priv`. A documentação é explícita:

> *"PostgreSQL grants privileges on some types of objects to `PUBLIC` by default … `CONNECT` and `TEMPORARY` privileges for databases; `EXECUTE` privilege for **functions and procedures**; and `USAGE` privilege for languages and data types."*

Então `app_login` nunca teve zero privilégio. A redação corrigida é a sua: **zero privilégio de aplicação, concedido diretamente ou herdado** — e o `PUBLIC` precisa ser auditado, não presumido.

E seu ponto sobre `SECURITY DEFINER` é o caminho de escalada real: função criada pelo owner, com `EXECUTE` para `PUBLIC` por padrão, executa **com os privilégios do dono**. Um `app_login` "sem DML" a chama.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE TEMP ON DATABASE prumo FROM PUBLIC;   -- se não usar tabela temporária
```

### Duas armadilhas práticas que eu acrescentaria

**`ALTER DEFAULT PRIVILEGES` só afeta o futuro.** Ele muda o que será criado dali em diante; **funções que já existem precisam de `REVOKE` explícito**. A própria doc reforça o timing: *"For maximum security, issue the `REVOKE` in the same transaction that creates the object; then there is no window in which another user can use the object."* Então o revoke entra na mesma migration que cria a função, e há uma varredura única para o que já existe.

**As extensões vão quebrar no dia 1.** `pgcrypto` e `citext` criam funções, e elas nascem com `EXECUTE` para `PUBLIC`. Revogar em bloco tira `gen_random_uuid()` da aplicação. Ou seja: o revoke vem acompanhado de `GRANT EXECUTE` explícito para `app` na lista curta do que ela realmente usa. Isso é bom — transforma "quais funções a aplicação chama" de suposição em lista versionada — mas se não for previsto, o primeiro deploy quebra e alguém reverte o endurecimento inteiro por pressa.

---

## 3. Privilégio efetivo, não atributo — adotado

Sua distinção é a certa: minha lista provava **configuração**, não **capacidade**.

```sql
-- catálogo: capacidade efetiva
pg_has_role('app_login', 'db_owner', 'SET')     → false
pg_has_role('app_login', 'app',      'USAGE')   → false   -- por INHERIT FALSE
pg_has_role('app_login', 'app',      'SET')     → true
has_table_privilege('app_login', 'public.pedido', 'SELECT') → false
has_function_privilege('app_login', 'f_sensivel()', 'EXECUTE') → false

-- comportamento: a fuga não funciona
RESET ROLE        → SELECT protegido → PERMISSION DENIED
SET ROLE db_owner                    → PERMISSION DENIED
```

**Asserção de catálogo pega configuração; execução hostil pega realidade.** Os dois, não um.

---

## 4. Duplicate-in-flight precisa de limite — buraco real

Você está certo, e o cenário é concreto: 500 requests com o mesmo `commandId`, o primeiro travando 25 segundos, todos segurando conexão HTTP e possivelmente conexão do pool. **Idempotência vira vetor de esgotamento de recurso.**

E o agravante que você nomeou é o que mais importa aqui: numa stack para agentes, um laço errado gera duplicata em volume, não uma ou duas.

```
duplicate-in-flight
  → espera limitada
  → A conclui dentro da janela   → replay
  → estoura a janela             → 409/202 explícito, cliente tenta depois
```

O caminho normal continua com a API simples que motivou a escolha; o caso patológico deixa de derrubar o processo.

---

## 5. Cross-version — você está certo, eu identifiquei e não decidi

*"Versão diferente é tratada explicitamente"* não é política, é adiamento com aparência de decisão. Fechando com a sua proposta:

**A identidade da idempotência é `(operation, operationVersion, commandId)`.** Não é o `commandId` sozinho com a versão anexada como metadado — a versão faz parte do **escopo**.

```
createOrder · v1 · uuid     ← escopo próprio
createOrder · v2 · uuid     ← outro escopo
```

Consequências, e são o que torna a política utilizável:

- Hash só é comparado **dentro do mesmo escopo**. Nunca há comparação entre normalizações de versões diferentes.
- Um retry que chega durante `v2` com key emitida em `v1` **não colide** — cai em escopo distinto e executa como comando novo.
- A versão antiga continua processável durante todo o TTL de idempotência.

Isso é mais mecânico para o agente do que qualquer regra sobre "tratar explicitamente", que é o teste real de uma política boa nesta stack.

---

## 6. `Assumptions` como quarto campo — adotado, com uma exigência

Seu argumento é o mais forte da rodada: **várias falhas destas seis rodadas não estavam no claim, estavam numa premissa escondida.** O `RESET ROLE` é o caso puro — a afirmação "SET ROLE restringe o current_user" era verdadeira; a premissa "e a identidade de sessão não é mais privilegiada" nunca foi escrita nem checada.

```
Claim:        RESET ROLE não eleva privilégio
Owner:        PostgreSQL
Evidence:     sql-set-role · ddl-priv
Assumptions:  session_user = app_login
              app_login não tem SET até db_owner
              app_login não herda app  (INHERIT FALSE)
              PUBLIC não oferece caminho privilegiado
```

A exigência que eu acrescentaria: **cada linha de `Assumptions` precisa ser individualmente testável, e vira uma asserção no fitness test.** As quatro acima já viram, respectivamente: `session_user`, `pg_has_role(...,'SET')`, `pg_has_role(...,'USAGE')` e a varredura de `PUBLIC`.

Sem isso, `Assumptions` vira mais prosa — e prosa é exatamente o que a Stack está tentando tirar do caminho crítico. Com isso, é o único campo do ADR que se prova sozinho.

---

## Placar

| Item | Veredito |
|---|---|
| Contradição `ALTER ROLE` × teste hostil | ✅ **bug meu** — o `ALTER ROLE` sai, fail closed em `app_login` |
| Não misturar as duas arquiteturas | ✅ adotado |
| "Zero privilégio" está errado | ✅ confirmado — PUBLIC dá CONNECT, TEMPORARY, EXECUTE, USAGE |
| `SECURITY DEFINER` como escalada | ✅ adotado, com revoke + grant explícito |
| Privilégio efetivo via `pg_has_role` | ✅ adotado — catálogo **e** execução hostil |
| Espera limitada no duplicate-in-flight | ✅ buraco real, fechado |
| Escopo `(operation, version, commandId)` | ✅ adotado |
| `Assumptions` no ADR | ✅ adotado, com a exigência de ser testável |

O princípio novo entra como está:

> **A role de fallback deve ser menos privilegiada que a role operacional, e os privilégios efetivos — inclusive os herdados de `PUBLIC` — precisam ser provados, não presumidos.**

Seis rodadas. Três erros factuais meus, um bug lógico meu, e uma vulnerabilidade real no código. O padrão dos cinco é o mesmo: **a falha nunca esteve na afirmação, esteve na premissa que ninguém escreveu.** É por isso que o quarto campo do ADR é o que mais vai render.
