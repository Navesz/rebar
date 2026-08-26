# Quinta resposta — o `RESET ROLE` é real, e pior do que você achou

Você encontrou a falha mais grave de todas as cinco rodadas. Fui verificar no código e na documentação do PostgreSQL, e o buraco existe — só que a identidade de sessão não é "mais privilegiada que `app`". É o **superusuário do cluster**.

---

## 1. O que está no disco

```
.env.example:12   DATABASE_URL=postgres://prumo:prumo@localhost:5432/prumo
ci.yml:52         POSTGRES_USER: prumo
main.ts:42        pool de migration   → config.databaseUrl
main.ts:54        pool da aplicação   → config.databaseUrl   ← a MESMA credencial
```

E o comentário da própria migration `0002` já documenta metade do problema:

> *"`POSTGRES_USER: prumo` in the compose file makes `prumo` the cluster **superuser**, so the app was connecting as a superuser and every policy was decoration."*

O autor viu o sintoma, criou `prumo_app`, e fechou o `current_user`. **Não fechou o `session_user`** — e os dois pools continuam usando a mesma string de conexão.

Estado real de uma conexão de runtime hoje:

```
session_user = prumo      ← SUPERUSER
current_user = prumo_app  ← restrito, via SET ROLE
```

E o teste em `database.test.ts:192` afirma apenas `current_user`. O `session_user` nunca é olhado.

---

## 2. A documentação do PostgreSQL fecha o caso

Fui à camada dona da semântica — `sql-set-role`:

> *"`RESET ROLE` sets the current user identifier to the connection-time setting … Otherwise, `RESET ROLE` sets the current user identifier to the current **session user** identifier."*

E, decisivo:

> *"These forms can be executed by **any user**."*

`RESET ROLE` **não é privilegiado**. Qualquer código de aplicação com acesso a SQL cru emite aquilo. Em Kysely, é uma linha.

Ou seja, hoje:

```sql
SET ROLE prumo_app;   -- aplicação "segura"
RESET ROLE;           -- current_user = prumo = SUPERUSER
                      -- RLS contornada, DDL disponível
```

Isso não precisa de atacante. Um agente tentando "resolver um erro de permissão" escreve exatamente isso, e o comentário do commit vai dizer que resolveu.

**Sua frase está certa e eu a endureceria:** `SET ROLE` reduz o `current_user`, mas não apaga a identidade privilegiada que abriu a sessão. E aqui a identidade que abriu a sessão é a mais privilegiada que existe.

---

## 3. Sua arquitetura de três identidades — adotada

```
db_owner     dono do schema · nunca usado pelo runtime
app          NOLOGIN · DML · NOBYPASSRLS · sem DDL
app_login    LOGIN · NOINHERIT · zero privilégio direto
```

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
```

*(As opções separadas de `INHERIT`, `SET` e `ADMIN` na membership entraram no PostgreSQL **16**, não 17 — funciona nos dois.)*

O `INHERIT FALSE` é a peça que faz a coisa funcionar, e vale registrar por quê: com `INHERIT TRUE`, o `app_login` teria os privilégios de `app` **automaticamente**, sem precisar de `SET ROLE` — e o `RESET ROLE` o deixaria ainda com o DML. Com `INHERIT FALSE`, ele não tem nada até fazer `SET ROLE` explícito.

Resultado:

```
RESET ROLE  →  current_user = app_login  →  zero privilégio
```

**A escapatória passa a reduzir privilégio, nunca elevar.** É exatamente a propriedade que se quer, e é melhor que "impedir `RESET ROLE`", porque não depende de impedir nada.

### Um reforço adicional que a doc permite

O trecho que você não citou: `RESET ROLE` volta para *"the connection-time setting"* se existir uma. Então:

```sql
ALTER ROLE app_login SET role = app;
```

faz até o `RESET ROLE` cair de volta em `app`. É cinto além do suspensório — **não substitui** a separação de identidades, porque `SET ROLE app_login` continua possível. Mas com as duas coisas juntas, nenhum caminho leva a privilégio maior.

---

## 4. O teste hostil — adotado, e é o melhor que você propôs

```sql
RESET ROLE;
SELECT * FROM tabela_protegida;
-- esperado: PERMISSION DENIED
```

Concordo que isso vale mais que checar `current_user`. Checar `current_user` prova que a configuração foi aplicada; o teste hostil prova que **a fuga não funciona**. São perguntas diferentes, e só a segunda é sobre segurança.

O conjunto de asserções fica:

```
session_user == app_login
current_user == app

session_user:  não superuser · não BYPASSRLS · não CREATEDB
               não CREATEROLE · sem DML direto

hostil:  RESET ROLE  →  SELECT protegido  →  PERMISSION DENIED
         SET ROLE db_owner                →  PERMISSION DENIED
```

Acrescentei a última linha: provar que não dá para *subir* para o owner também, não só que o reset não ajuda.

---

## 5. `1 outbox ≠ 1 efeito externo` — você está certo, e eu quase enterrei isso

Meu teste de "20 requests → 1 linha de outbox" está correto, mas a formulação corria o risco de sugerir exactly-once no efeito externo. Não é. O outbox é **at-least-once por construção**:

```
worker pega a linha  →  envia  →  destinatário recebe  →  PROCESSO MORRE
                                                          antes de marcar entregue
        ↓ restart
worker pega a mesma linha  →  envia de novo
```

A regra que já estava na Stack — *"idempotência do consumidor é obrigatória"* — não pode sumir agora que idempotência e outbox foram unificadas. Vai explícita, nos três níveis:

| Camada | Garantia |
|---|---|
| Retry de API | **não** cria segunda linha de outbox |
| Retry do outbox | **pode** reenviar a mesma linha |
| Consumidor | **deve** deduplicar por `outboxId` |

Só com cooperação do destinatário o efeito externo se aproxima de exactly-once. Onde o destinatário não coopera, isso vira decisão consciente e documentada, não suposição.

---

## 6. Duplicate-in-flight — você pegou o teste tomando uma decisão sozinho

Correto, e é sutil. "20 respostas semanticamente iguais" escolhe a semântica **esperar e replicar**:

```
A executando · B..T chegam com mesmo commandId · esperam · recebem o replay de A
```

A alternativa válida seria `409` / `202 command in progress` e o cliente tenta de novo.

Escolho **esperar/replay**, pelo motivo que você deu — é API mais simples para o agente e para o frontend, e evita que o cliente tenha de implementar backoff para um caso que o servidor sabe resolver. Mas vai **escrita no ADR como decisão**, não deduzida do teste. Um teste que decide arquitetura sem o documento perceber é exatamente a classe de coisa que a Stack existe para impedir.

---

## 7. Versionamento do hash — buraco real

Seu exemplo é o certo:

```
v1: quantity default = 1
v2: quantity default = 10
```

Mesmo payload bruto, normalizações diferentes, hashes diferentes — e um `commandId` sobrevive a deploy. Numa janela de idempotência longa, isso vira ou falso conflito ou replay indevido.

Persistido junto: `operation`, `idempotencySchemaVersion`, `requestHash`. E a comparação de hash só é válida dentro da mesma versão de esquema; versão diferente é tratada explicitamente, nunca comparada às cegas.

---

## 8. Unicode no JCS — o detalhe que teria custado caro

Você está certo: o RFC 8785 **não** faz normalização Unicode; ele preserva as strings. Então `é` como `U+00E9` e `e` + acento combinante são visualmente idênticos, byte-distintos, e produzem hashes diferentes.

A cadeia ganha uma etapa, e o contrato decide onde ela se aplica:

```
contract parse
  ↓
normalização semântica  ← NFC apenas onde o contrato declarar
  ↓
projeção JSON-safe
  ↓
RFC 8785
  ↓
hash
```

**Não normalizar tudo cegamente** — nome de arquivo, chave criptográfica e identificador externo podem depender dos bytes exatos. O contrato marca quais campos têm semântica de texto humano.

---

## 9. `claim → owner → evidence` — adotado

Sua nomenclatura entra como formato obrigatório de citação em ADR:

```
Claim:     onConnect bloqueia a aquisição do client
Owner:     node-postgres
Evidence:  pg-pool@3.14.0 lib/index.js:288-301
```

Isso torna a revisão mecânica, e força a pergunta que eu falhei em fazer duas vezes: **essa camada é dona disso?**

---

## Placar

| Item | Veredito |
|---|---|
| `RESET ROLE` como escapatória | ✅ **real e confirmado** — e o `session_user` é o superusuário do cluster, não só "mais privilegiado" |
| `RESET ROLE` é irrestrito | ✅ confirmado na doc: *"can be executed by any user"* |
| Três identidades com `INHERIT FALSE` | ✅ adotado — a fuga passa a reduzir privilégio |
| Teste hostil de `RESET ROLE` | ✅ adotado, mais `SET ROLE db_owner` |
| 1 outbox ≠ 1 efeito externo | ✅ você evitou que eu enterrasse a regra do consumidor |
| Duplicate-in-flight é decisão de produto | ✅ escolhido esperar/replay, e escrito como decisão |
| Versionamento do hash | ✅ adotado |
| JCS não normaliza Unicode | ✅ adotado, com NFC seletivo pelo contrato |
| `claim → owner → evidence` | ✅ adotado |

Sua prioridade está certa e vira a próxima decisão fechada:

> **O runtime nunca autentica com credencial de privilégio superior a `app`. `RESET ROLE` deve reduzir privilégio, ou no pior caso mantê-lo — jamais elevá-lo.**

Cinco rodadas. As três primeiras corrigiram erros meus; esta corrigiu um erro que estava no código há um dia e passava por dois testes verdes.
