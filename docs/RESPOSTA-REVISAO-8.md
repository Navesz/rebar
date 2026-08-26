# Oitava resposta — o pool era o furo, e meu conserto não alcançava

Os três pontos procedem. O segundo revela que minha correção anterior era cosmética, e o terceiro é o mais grave da rodada: correção perfeita que ainda derruba o backend.

---

## 1. Extensões — generalizei demais, e a precisão importa

Você está certo. A regra não é "objetos de extensão são do bootstrap superuser". É:

> **Para extensão *trusted* instalada por role *não-superuser*,** os objetos contidos são, por padrão, do bootstrap superuser — salvo se o script da extensão os atribuir explicitamente ao chamador.

Normalmente, quem roda `CREATE EXTENSION` vira dono dos objetos. Minha frase "é o padrão, não exceção" estava errada como regra geral.

E você está certo sobre o `citext` — confirmei na doc:

> *"This module is considered **"trusted"**, that is, it can be installed by non-superusers who have `CREATE` privilege on the current database."*

**Uma refinação que a correção expõe.** Nas duas configurações a auditoria continua necessária, por motivos opostos:

| Quem instala | Dono dos objetos | Problema |
|---|---|---|
| Superusuário (o que o compose faz hoje) | o próprio superusuário | ACL de objeto do superusuário, com `PUBLIC EXECUTE` por padrão |
| `db_owner` não-superuser (a arquitetura-alvo) | **bootstrap superuser**, porque `citext` é trusted | `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` não alcança |

Ou seja: a auditoria de ACL pós-`CREATE EXTENSION` não é contingência de um caso — é obrigatória nos dois. Só o motivo muda. Isso reforça sua proposta em vez de enfraquecê-la.

---

## 2. O envelope versionado era `result: unknown` disfarçado

Você tem razão e este é o tipo de crítica que eu não teria feito sozinho. `{ version: 1, result: … }` **não** diz ao cliente `v2` como parsear o `result`. Eu resolvi a honestidade e abri um buraco de tipo — **exatamente na idempotência**, que é o pior lugar possível para um.

Sua regra entra literal:

> **`version` como discriminador só funciona se o contrato contiver os schemas que esse discriminador pode selecionar.** Sem isso, é `unknown` com nome bonito.

### Adotada a opção B

Separar duas coisas que eu tinha fundido:

| | Estável entre versões? | Conteúdo |
|---|---|---|
| **Desfecho idempotente** | **Sim** | `commandId` · `status` · `operationVersion` · `resourceId` · `completedAt` |
| **Resultado da operação** | Não — é tipado por versão | O objeto de resposta daquela versão |

- **Replay na mesma versão** → desfecho estável **mais** o resultado original tipado.
- **Replay cross-version** → **só o desfecho estável.** É suficiente para dizer *"já executou, não execute de novo, e este foi o recurso criado"*, que é a única coisa que o cliente precisa saber para não cobrar duas vezes.

Isso evita obrigar o cliente atual a entender toda resposta histórica, e evita manter união discriminada de schemas antigos durante o TTL inteiro — que era a opção A, rigorosa e com custo de manutenção que ninguém paga por muito tempo.

O `resourceId` no desfecho é o que faz a opção B funcionar: o cliente que precisar do estado atual do recurso **busca por ele**, na forma da versão corrente. Não há tradução de forma histórica.

---

## 3. O pool — meu conserto anterior não alcançava o problema

Este é o achado mais importante da rodada, e você está certo que eu tratei o sintoma.

Eu escrevi "espera limitada no HTTP". Mas nós **também** decidimos que registro de idempotência, mutação de negócio e outbox vão na mesma transação. Então:

```
A:  BEGIN · INSERT commandId=ABC · trabalha 2 s · COMMIT
B:  INSERT commandId=ABC  →  bloqueia no unique index, esperando A terminar
```

O índice único não pode decidir se há conflito antes de saber o destino da transação de A. **A conexão de B já foi consumida.** Timeout de HTTP não devolve conexão que o Postgres está segurando.

Com 500 duplicatas: 1 trabalhando, 499 conexões do pool paradas. **O vetor de esgotamento que a espera limitada devia evitar continua aberto** — só mudou de camada.

### A invariante, mais forte

> **Duplicate-in-flight nunca espera ocupando transação ou conexão do pool pela janela HTTP.**

### A coordenação fail-fast

Confirmei o mecanismo na doc:

> *"This will either obtain the lock immediately and return `true`, or **return `false` without waiting** if the lock cannot be acquired immediately."*

```
A  →  pg_try_advisory_xact_lock(hash(scope, commandId))  →  true   →  executa a transação
B  →  pg_try_advisory_xact_lock(mesma chave)             →  false  →  devolve a conexão
                                                                   →  409 · Retry-After
```

Três premissas que precisam estar escritas, porque cada uma é um jeito de isso dar errado em silêncio:

1. **Tem de ser a variante `_xact_`.** Ela é liberada no fim da transação, sem release manual — o mesmo instante em que a linha de idempotência fica visível. A variante de sessão vazaria entre requests na conexão reaproveitada do pool.
2. **O lock vem antes do `INSERT`**, e é chaveado no mesmo escopo do índice único. Fora de ordem, B ainda bloqueia.
3. **Colisão de hash é aceitável, e por que.** Advisory lock aceita `bigint`, então `commandId` precisa ser hasheado, e dois comandos distintos podem colidir. O custo é um `409` espúrio — o cliente tenta de novo. **A correção continua no índice único**, não no lock; o lock é só o caminho rápido. Quem não souber disso vai "consertar" a colisão removendo o lock, e o furo do pool volta.

### O teste, com a asserção que faltava

```
500 requests concorrentes · mesmo commandId

→ 1 mutação de negócio
→ 1 linha de outbox
→ nenhuma execução duplicada
→ pico de conexões do banco  ≤  limite declarado     ← a que faltava
→ duplicatas excedentes recebem replay ou 409
```

Sem a linha do pico de conexões, o teste aprova uma implementação correta que derruba o processo. Com ela, o teste é sobre **correção sob concorrência**, que é o que você apontou.

---

## 4. Sobre o `Retry-After`

Aceito sua ressalva de que o RFC descreve `Retry-After` principalmente para `503` e `3xx`. Fica como **convenção de aplicação** ao lado do Problem Details, e o contrato deixa explícito que o cliente decide pelo `type`, não pelo status:

```
409 Conflict
Retry-After: 1
type: idempotency-command-in-progress
```

O `type` estável é o contrato; o status é cortesia para intermediário genérico.

---

## Placar

| Item | Veredito |
|---|---|
| "Objetos de extensão são do bootstrap superuser" | ❌ **generalizei demais** — vale para trusted + não-superuser. `citext` é trusted (confirmado) |
| Auditoria de ACL pós-extensão | ✅ obrigatória nas **duas** configurações, por motivos opostos |
| Envelope versionado resolve o replay tipado | ❌ era `unknown` disfarçado |
| Desfecho idempotente estável × resultado tipado | ✅ opção B adotada |
| Espera limitada no HTTP resolve o pool | ❌ **não alcança** — a conexão já foi consumida no índice único |
| `pg_try_advisory_xact_lock` fail-fast | ✅ adotado, com as três premissas escritas |
| Teste com pico de conexões | ✅ adotado — sem isso o teste aprova um DoS |
| `Retry-After` como convenção | ✅ com o `type` como contrato |

Suas duas perguntas ficam respondidas assim:

**Como um cliente `v2` interpreta de forma tipada um resultado histórico `v1`?**
Não interpreta. Cross-version devolve só o desfecho estável, e quem precisa do estado busca o recurso na forma corrente.

**Como 500 retries deixam de consumir 500 conexões?**
Não chegam ao índice único. `pg_try_advisory_xact_lock` devolve `false` sem esperar, a conexão volta ao pool, e a duplicata recebe `409`.

Oito rodadas. As três últimas seguiram o mesmo formato: eu corrijo o erro que você aponta, e a correção esconde outro uma camada abaixo — versão no escopo, depois envelope sem schema, depois espera no lugar errado. **É a descrição exata de por que `Assumptions` precisa existir**: cada uma dessas correções foi verdadeira sob uma premissa que eu não escrevi.
