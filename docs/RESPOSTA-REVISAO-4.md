# Quarta resposta — errei na camada, e isso vale mais que o erro

Você está certo, e o modo como está certo é a coisa mais útil que saiu destas quatro rodadas.

---

## 1. Concedido, e confirmado no fonte que é dono da semântica

Fui ao `pg@8.23.0` instalado, não à documentação do PostgreSQL. `lib/query.js`:

```js
// linha 114
// since we pipeline sync immediately after execute we don't need to do anything here

// linhas 198-201
// if we're not reading pages of rows send the sync command
connection.sync()
```

**Sync por query.** Confirmado no código do driver. Cada query pipelinada tem o próprio error boundary, e uma falha no meio não impede as seguintes.

Aplicado ao caso:

```
SET ROLE app     → ERRO
SELECT segredo   → EXECUTA
```

Minha "inversão" da rodada anterior está morta. O pipeline do node-postgres não salva ninguém.

E sua conclusão é a certa, mais simples que as duas que eu tentei:

> Nem `pipeline off = perigoso`, nem `pipeline on = seguro`.
> **`pool.on('connect')` + inicialização async não é fronteira, ponto — independente de pipeline.**

A formulação que vai para o ADR é a sua:

> A segurança não depende de ordenação, de query queue, de pipelining nem da propagação de erro entre comandos. **`onConnect` constitui uma acquisition barrier:** o client só se torna adquirível após a inicialização privilegiada concluir com sucesso; se ela falha, a conexão é destruída e o `acquire` rejeita.

Isso elimina o pipeline inteiro da prova de segurança, que é o que uma invariante boa faz — reduz o número de coisas de que ela depende.

---

## 2. O erro real, e por que ele vale mais que o acerto

Você diagnosticou melhor do que eu teria: **a fonte era primária, mas primária da abstração errada.**

```
propriedade que eu afirmava:  comportamento de erro do node-postgres
fonte que eu usei:            documentação do libpq / protocolo PostgreSQL
```

O `node-postgres` não é binding de libpq — é implementação própria do protocolo em JS, e **escolheu** Sync por query em vez de Sync por segmento. A doc do PostgreSQL descreve o que o *servidor* faz num pipeline; ela não descreve, e não pode descrever, o que o *driver* decide enviar.

Foi uma conclusão plausível, bem fundamentada e errada — exatamente a classe de falha que a stack existe para tornar difícil. Fiz num documento sobre não fazer isso.

Seu princípio novo entra, e substitui o meu:

> **Afirmação verificável precisa de fonte primária da camada responsável pela propriedade afirmada.**

Com a regra operacional que decorre dele: **não pule camada.**

| Propriedade afirmada | Quem é dono |
|---|---|
| MVCC, isolamento, `SKIP LOCKED` | PostgreSQL |
| Sync por query, error boundary, `onConnect` | node-postgres |
| Serialização, mapa de status | oRPC |
| SQL gerado | Kysely |
| Preview de link não executa JS | crawler / especificação OG |

Meu "a fonte precisa ser primária" era insuficiente e você mostrou com um caso vivo. Registrado como o terceiro princípio da stack, ao lado dos outros dois.

E há uma consequência prática que eu tiraria disso: **num ADR, a citação precisa nomear o componente, não só a URL.** "PostgreSQL docs" e "node-postgres source" respondem perguntas diferentes, e escrever qual dos dois está sendo invocado força a pergunta "essa camada é dona disso?".

---

## 3. `@expect-rule` — adotado com a gramática rígida

Concordo com fechar por gramática, incluindo o item que você acrescentou: **o harness rejeita qualquer fixture em `reprovar/` sem pelo menos um marcador.** Sem isso, um arquivo novo entra na pasta, fica vermelho por qualquer motivo, e ninguém percebe que ele não prova nada.

Múltiplos marcadores por fixture, como você escreveu:

```ts
// @expect-rule no-db-import
// @expect-rule no-cycle
```

---

## 4. O teste de concorrência — adotado, e é o que faltava

Sua sugestão vira teste de integração obrigatório:

```
20 requests concorrentes · mesmo commandId · mesmo payload
  → 1 mutação de negócio
  → 1 linha de outbox
  → 20 respostas semanticamente iguais
```

Isso é melhor do que qualquer prosa sobre idempotência, porque falha de verdade quando o desenho está errado. E cobre os dois modos: o `UNIQUE (scope, commandId)` sozinho impede a segunda mutação, mas só o teste concorrente prova que o replay não enfileira uma segunda outbox.

---

## 5. Canonicalização — seu refinamento está certo e eu tinha deixado passar

Você está certo que "DTO depois do Zod" não é suficiente. O Zod devolve objeto JavaScript, e JavaScript carrega `undefined`, `Date`, `bigint`, `NaN`, `Infinity` — nada disso existe no modelo JSON sobre o qual o RFC 8785 opera. Passar direto ao JCS é bug esperando data.

A cadeia fica como você escreveu:

```
Contract parse
  ↓
normalized semantic input
  ↓
JSON-safe hash projection
  ↓
RFC 8785
  ↓
hash
```

E o ponto mais forte é o último: **o contrato declara explicitamente o que entra na identidade do comando.** `correlationId`, `clientTimestamp` e metadado de trace são válidos no request e **não** tornam o comando semanticamente diferente. Se o hash for sobre o payload inteiro, dois retries com trace diferente viram comandos diferentes e a idempotência não existe.

Então: `idempotencyPayload(input)` como projeção explícita, versionada junto do contrato e testada — não o payload inteiro.

---

## Placar

| Item | Veredito |
|---|---|
| "pipeline é mais seguro" | ❌ **errei** — `pg` manda Sync por query; confirmado em `lib/query.js:198-201` |
| `pool.on('connect')` não é fronteira, independente de pipeline | ✅ sua conclusão, adotada |
| Fonte primária **da camada certa** | ✅ princípio novo, substitui o meu |
| `@expect-rule` com gramática rígida + fixture sem marcador é erro | ✅ adotado |
| Teste concorrente de idempotência | ✅ adotado |
| Projeção explícita para o hash | ✅ adotado |

Três rodadas, três erros factuais meus, os três pegos por você. O padrão dos três é o mesmo: eu parei de verificar cedo demais, na camada onde a resposta *parecia* estar. Se serve de argumento a favor do projeto — a stack inteira existe porque disciplina não escala, e eu acabei de fornecer três amostras.
