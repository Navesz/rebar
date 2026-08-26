# Segunda resposta — o que eu errei e o que fica

Você tem razão nas quatro alterações que pediu. Uma delas é um erro factual meu, e as outras três melhoram o desenho. Fui verificar todas, e em dois pontos a evidência é mais forte do que a que você trouxe.

---

## 1. TanStack Start — eu errei, você estava certo desde o começo

Fui à documentação oficial. Ela diz, textualmente:

> *"TanStack Start is currently in the **Release Candidate** stage! This means it is considered feature-complete and its API is considered stable."*

Continua RC. Sua ressalva original valia, e eu a derrubei com uma fonte ruim.

O diagnóstico do meu erro é exatamente o que você supôs: aceitei um resumo de busca que misturou artigos de Medium com números de versão `1.x` do repositório TanStack Router. **Versão 1.x com data de 2026 não é o projeto declarando GA** — e eu tratei como se fosse, num documento cuja tese inteira é que afirmação com número precisa de fonte.

Placar corrigido: **TanStack Start em RC → sua ressalva estava certa.**

Consequência prática: a separação `app` → SPA e `site` → SSR/prerender continua, mas TanStack Start entra como candidato em avaliação, não como escolha conservadora. Ainda é o mais natural dentro do ecossistema; só não pode ser vendido como estável.

---

## 2. `_queryQueue` — você está certo, e o motivo é pior do que você disse

Aceito integralmente não usar interno privado como argumento de segurança. Mas fui ao fonte do `pg@8.23.0` e achei algo que fecha a discussão de vez. Há **duas** depreciações relevantes em `lib/client.js`, não uma:

```
'Client.queryQueue is deprecated and will be removed in pg@9.0.'

'Calling client.query() when the client is already executing a query is
 deprecated and will be removed in pg@9.0. Use async/await or an external
 async flow control mechanism instead.'
```

A segunda é a que mata o padrão atual. O `pool.on('connect')` depende **exatamente** de disparar uma query e deixar as seguintes se enfileirarem atrás. Isso não é só "interno privado" — é comportamento **com data de remoção marcada**.

E confirmei o `pipeline` que você citou: existe no 8.23 (`this.pipeline = Boolean(c.pipeline)`, e `pipeline?: boolean` nos tipos). Com pipelining ligado, a premissa de ordenação some.

Há um argumento a favor do `onConnect` que nenhum de nós dois fez explicitamente: **ele é imune ao pipelining.** O `onConnect` não depende de ordem de fila — ele bloqueia a *entrega* do client. Ligar `pipeline: true` amanhã não quebra a fronteira de segurança. Com `pool.on('connect')`, quebra em silêncio.

Sua formulação está adotada, com esse acréscimo:

> O fluxo atual de sucesso não demonstrou bypass porque, sem pipelining, as queries são processadas em ordem — mas esse comportamento está depreciado com remoção marcada para o `pg@9.0`, e `pipeline: true` já o invalida hoje. `onConnect` é adotado porque fornece a semântica diretamente: nenhuma conexão é disponibilizada antes da inicialização privilegiada terminar, independente de ordem de fila.

---

## 3. Fixtures declarando a regra esperada — certo, e mais barato do que você imagina

Seu modo de falha é real: fixture prova a regra A, regra A quebra, regra B dispara por acaso, fixture continua vermelha, harness fica satisfeito.

Fui ver o harness. Ele hoje verifica duas coisas:

1. toda regra **declarada** disparou em algum lugar de `reprovar/`
2. **zero** violação em `aprovar/` — a asserção de falso positivo

É cobertura no nível do conjunto, não por arquivo. Seu furo existe.

Mas a convenção que falta **já está escrita**. Toda fixture negativa abre com o nome da regra em comentário:

```ts
// viola: sem-io-externo-no-caso-de-uso
import { readFileSync } from 'node:fs'
export const ler = () => readFileSync('x')
```

Ou seja: as 29 fixtures já declaram o que esperam. O que falta é o harness **ler esse comentário e afirmar o par arquivo→regra**. São ~15 linhas, e transforma as fixtures em contract tests das próprias regras, como você propôs. Adotado.

---

## 4. MCP — sua reformulação é melhor que a minha, e a minha era literalmente impossível

Você está certo duas vezes.

"MCP é caro" é generalização errada. O correto é: **MCP que empurra documentação estática para o contexto é caro.** Uma tool `get_adr("0013")` paga só pelo que foi pedido.

E "nenhuma prosa mora dentro do servidor" é impossível de cumprir — nome de tool, descrição, schema e descrição de argumento *são* prosa, e são exatamente o que o modelo lê para decidir chamar. Eu escrevi uma regra que o próprio servidor viola por construção.

Sua formulação entra no lugar:

> **Nenhuma documentação normativa duplicada mora no MCP.** O servidor explica a semântica da própria ferramenta. Regra arquitetural, decisão, guia e invariante vêm da fonte versionada — nunca há duas verdades.

---

## 5. Classes de regra — aceito, e acrescento uma armadilha

Sua correção está certa e a minha generalização era preguiçosa. Três classes:

| Classe | Entrada | Exemplos |
|---|---|---|
| **Determinística** | nasce `error`, depois das fixtures | `domain/` importa `db/` · `@ts-nocheck` · migration antiga editada · `process.env` fora de `config/` |
| **Heurística** | nasce `warn` + contador | cor literal · raio de busca · densidade de comentário |
| **Informacional** | permanece métrica | telemetria de token · cobertura |

E seu ponto sobre warning também treinar o agente é o melhor argumento contra a minha proposta: **40 avisos diários viram ruído**, e ruído ensina a ignorar a saída inteira. Warning não é neutro; é dívida de atenção.

**A armadilha que eu acrescentaria:** regra determinística pode ter *detecção* perfeita e *especificação* incompleta. "`http/` não acessa `db/`" é matemática — até alguém precisar de um import só-de-tipo de `db/tipos`, que é legítimo. O preset que estamos herdando já trata isso, abrindo exceção exatamente para `db/tipos`.

Daí a regra de construção: **regra determinística nasce `error`, mas o conjunto de fixtures precisa incluir o caso-limite legítimo em `aprovar/`, não só a violação em `reprovar/`.** Sem isso, o que nasce `error` é a sua confiança na especificação, não a regra.

---

## 6. Idempotência — você fechou o buraco que eu tinha deixado

Correto, e é grave: se o registro da chave e a mutação de negócio não estiverem na **mesma transação**, o crash entre as duas produz cobrança dupla. Meu desenho não dizia isso. Adotado na forma que você escreveu — claim, replay, verificação de hash divergente, execução e persistência do resultado, tudo num commit só.

E a canonicalização do `requestHash` é o detalhe que faz a diferença entre funcionar e parecer funcionar: `{"a":1,"b":2}` e `{"b":2,"a":1}` são o mesmo pedido e hashes de texto diferentes. Vai documentado, com a canonicalização definida explicitamente — não deixada para o agente inventar.

---

## 7. Migration — sua distinção é correta

Aceito: **forward-only é estratégia de migration; expand/contract é estratégia de compatibilidade entre versões.** Não são sinônimos, e tratar como se fossem esconde que o problema real é coexistência de `N` e `N+1` durante o rolling deploy. A sequência que você escreveu vai para o ADR na forma quase visual, pelo mesmo motivo do outbox: é difícil um agente inventar outra coisa olhando para um diagrama.

---

## 8. O princípio combinado

Adotado como está:

> **Se uma regra pode descer de prosa para enforcement, ela deve descer — mas o enforcement precisa ser mais confiável do que a regra que substitui.**

É melhor do que as duas formulações separadas. A primeira metade sozinha produz CI idiota; a segunda sozinha produz paralisia. Juntas descrevem o único caminho que funciona.

---

## Placar final

| Item | Veredito |
|---|---|
| TanStack Start em RC | ❌ **eu errei** — a doc oficial diz RC. Sua ressalva original valia |
| `_queryQueue` como argumento | ✅ você certo — e há uma segunda depreciação, com remoção no `pg@9.0`, que fecha o caso |
| `pipeline: true` invalida a ordenação | ✅ confirmado no fonte — e `onConnect` é imune a isso |
| Fixture deve declarar a regra esperada | ✅ certo — e a convenção já existe em comentário, falta o harness ler |
| "MCP é caro" | ✅ sua reformulação é melhor — e a minha era autocontraditória |
| Toda regra nasce `warn` | ✅ você certo — três classes, e warning também é dívida de atenção |
| Idempotência na mesma transação | ✅ buraco meu, fechado |
| Canonicalização do `requestHash` | ✅ adotado |
| forward-only ≠ expand/contract | ✅ adotado |
| Agent harness é fronteira documental | ✅ correção aceita dos dois lados |

Das quatro alterações que você pediu, as quatro entram. O documento vai ser corrigido antes de qualquer linha de código ser escrita em cima dele — que é, afinal, o ponto do exercício.
