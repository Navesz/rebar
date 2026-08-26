# Terceira resposta — o pipeline, e uma inversão

Você está certo sobre o `pipeline: true`. Fui à documentação primária do PostgreSQL e ela me contradiz literalmente. Mas a fonte também traz uma coisa que inverte a conclusão dos dois lados.

---

## 1. Concedido — e a citação exata

`libpq-pipeline-mode`, documentação oficial:

> *"The server executes statements, and returns results, **in the order the client sends them**."*

Ponto final. Pipelining remove a espera pelo resultado, **não** a ordem. Minha frase "com pipelining ligado, a premissa de ordenação some" está errada. Sua formulação entra no lugar:

> `pipeline: true` não invalida a ordem de execução do PostgreSQL, mas permite despacho concorrente sem esperar o resultado da inicialização. A fronteira de segurança não deve depender de ordenação nem de enfileiramento: `onConnect` impede que o client seja adquirido antes de a inicialização privilegiada terminar **com sucesso**.

E seu enquadramento é o certo: **o problema nunca foi ordering, foi ausência de acquisition barrier.**

---

## 2. A inversão: pipelining é mais seguro, não menos

A mesma página traz o comportamento de erro, e ele desmonta o que eu tinha implicado:

> *"If any statement encounters an error, the server aborts the current transaction and **does not execute any subsequent command in the queue** until the next synchronization point; a `PGRES_PIPELINE_ABORTED` result is produced for each such command."*

Ou seja: **em pipeline, um `SET ROLE` que falha aborta as queries seguintes.** O caminho de falha fica protegido de graça.

O perigoso é o modo **padrão**, sem pipeline — onde cada query tem o próprio Sync, e um `SET ROLE` que falha **não impede** a próxima query de executar. Com privilégio total.

Eu tinha dito que ligar `pipeline: true` quebraria a fronteira. É o contrário: hoje, sem pipeline, é que a janela existe. Errei duas vezes na mesma frase — no mecanismo e na direção.

O que isso reforça é justamente a sua tese, e de forma mais dura: **o comportamento correto depende de uma configuração que ninguém declarou explicitamente, e ela pode mudar.** É exatamente o tipo de garantia acidental que não pode sustentar uma fronteira de segurança. `onConnect` torna a pergunta irrelevante.

---

## 3. `@expect-rule` — adotado, e você fecha um furo que eu deixei

Concordo integralmente. Marcador estruturado no lugar de comentário livre, com as quatro validações que você listou:

```ts
// @expect-rule sem-io-externo-no-caso-de-uso
```

- a regra existe no conjunto declarado
- a fixture referencia N regras válidas
- cada regra declarada **realmente disparou naquele arquivo**
- **nenhuma regra não declarada disparou ali**

O último item é o que eu não tinha proposto, e é o que fecha o furo de verdade. Sem ele, uma fixture pode ficar vermelha pelo motivo errado indefinidamente.

E seu ponto sobre o typo é concreto: `// viola: sem-io-externo-caso-de-uso` (faltando um `-`) hoje passaria como texto livre e criaria um segundo ponto de ambiguidade. Marcador validado contra o registro de regras elimina isso.

Uma nota de implementação: uma fixture pode legitimamente violar duas regras ao mesmo tempo — um arquivo que importa `db/` **e** fecha ciclo. O `N regras` da sua especificação cobre isso, desde que declaradas. Vale dizer explicitamente, senão alguém escreve o parser aceitando só uma.

---

## 4. A invariante unificada — é a melhor contribuição desta rodada

Adotado como você escreveu:

> **Toda mutação idempotente que produza efeito externo deve persistir estado de negócio, registro de idempotência e linha de outbox na mesma transação.**

Isso conecta duas decisões que estavam sendo discutidas em separado, e o desenho fica:

```
BEGIN
  claim commandId
  executa alteração no domínio
  grava estado de negócio
  grava linha de outbox
  grava resultado da idempotência
COMMIT
        ↓
worker de outbox  →  efeito externo
```

Uma sutileza que vale registrar junto, senão alguém a descobre em produção: **no caminho de replay, nenhuma linha nova de outbox pode ser escrita.** Retry com o mesmo `commandId` e mesmo hash devolve o resultado guardado e não reenfileira o efeito. Caso contrário a idempotência do banco existe e o efeito externo duplica assim mesmo — que é precisamente o que a invariante existe para impedir.

---

## 5. Canonicalização — você está certo em não deixar a gente inventar

`ordenarObjetoRecursivamente()` caseiro é exatamente o tipo de função que nasce em quinze minutos e vira bug de reconciliação seis meses depois.

Das suas duas opções, prefiro a segunda, pelo motivo que você mesmo deu:

```
Zod parse → DTO normalizado → serialização canônica → hash
```

Porque quem decide se `{"quantidade":1}` e `{"quantidade":1,"campoIgnorado":"x"}` são o mesmo comando **é o contrato**, não o hash. Se o schema faz `strip` do campo extra, os dois são o mesmo pedido e precisam ter o mesmo hash. Se o schema é `strict` e rejeita, nem chega no hash. Hashear o texto cru antes do parse põe essa decisão no lugar errado — e num desenho contract-first, é o único lugar onde ela não deveria estar.

JCS/RFC 8785 entra como a serialização canônica **depois** do parse, não no lugar dele.

---

## 6. Sobre RC não significar "não use"

Aceito a nuance, e ela importa para a decisão real. A equipe declara API estável e feature-complete; o defeito da minha primeira resposta foi chamar de GA, não recomendar.

Fica assim no documento: **TanStack Start é candidato forte para o preset `site`, em RC, com API declarada estável pela própria equipe.** Escolhível, com o estágio dito em voz alta — não vendido como estável.

---

## Placar

| Item | Veredito |
|---|---|
| `pipeline: true` remove ordenação | ❌ **errei** — a doc diz "in the order the client sends them" |
| Pipelining piora a fronteira | ❌ **errei ao contrário** — em pipeline, erro **aborta** as seguintes; o perigoso é o modo padrão |
| O problema é acquisition barrier, não ordering | ✅ seu enquadramento, adotado |
| `@expect-rule` estruturado | ✅ adotado, com "nenhuma regra inesperada disparou" |
| Invariante unificada idempotência + outbox | ✅ adotado — melhor contribuição da rodada |
| Canonicalização pelo contrato, não caseira | ✅ adotado |
| RC ≠ não usar | ✅ nuance aceita |

Duas rodadas, dois erros factuais meus, os dois pegos por você indo à fonte primária. O processo está funcionando — e é literalmente o mecanismo que a stack tenta automatizar: **afirmação com número precisa de fonte, e a fonte precisa ser primária.** Eu falhei nisso duas vezes num documento que prega isso, o que é o argumento mais honesto que existe a favor de a regra ser máquina e não disciplina.

Vou aplicar as correções no `STACK.md` antes de virar ADR.
