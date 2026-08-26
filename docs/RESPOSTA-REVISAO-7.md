# Sétima resposta — eu abri um buraco tentando fechar outro

Você está certo, e este é o pior dos meus erros até aqui: os anteriores eram imprecisão ou incoerência. Este **criava uma falha de correção em produção**.

---

## 1. A idempotência — concedido, e a causa raiz é pior que o sintoma

Meu texto:

> *"Retry que chega em `v2` com key emitida em `v1` **não colide** — escopo distinto, comando novo."*

Seu contra-exemplo mata:

```
10:00  charge/v1/ABC  →  cobrança executada  →  resposta se perde
       deploy v1 → v2
10:05  retry commandId=ABC  →  escopo (charge, v2, ABC)  →  não encontra
                             →  COBRA DE NOVO
```

**A proteção de idempotência morre exatamente no deploy** — o momento em que respostas se perdem com mais frequência, porque é quando conexões caem.

### A causa raiz: eu nunca disse quem determina a versão

Escrevi `operationVersion` sem especificar a origem. A leitura natural — e a que eu tinha na cabeça — é *a versão do servidor que está processando*. E é justamente essa que quebra: **a chave passa a identificar a implementação que atendeu, não o comando que o cliente emitiu.**

Sua frase vira princípio, e entra literal:

> **Idempotência deve sobreviver a deploys. Se uma alteração de versão pode converter um retry em nova execução, a chave não está identificando o comando — está identificando a implementação que o processou.**

### A política corrigida

`UNIQUE (scope, commandId)` **estável entre versões**. A versão é atributo do registro, não parte da chave.

| Situação | Comportamento |
|---|---|
| Mesma versão · mesmo hash | **Replay** |
| Mesma versão · hash diferente | **Erro** — key reutilizada |
| **Versão diferente** | **Nunca executa.** Replay do resultado histórico, ou `version_mismatch` explícito |

Nunca "versão mudou → executa de novo". Quem quer mesmo uma operação `v2` nova **gera um `commandId` novo**.

### Sua alternativa é válida, com uma condição que precisa estar escrita

Versão como parte do escopo funciona **se e somente se** `operationVersion` for campo **do cliente**, imutável, carregado em todo retry:

```json
{ "commandId": "ABC", "operationVersion": 1 }
```

Aí o retry pós-deploy ainda procura `charge/v1/ABC` e encontra. Mas isso tem de estar **no contrato** — nunca inferido da versão do servidor em execução. Como não estava escrito, a implementação natural seria a errada.

### Um buraco na sua própria correção, e ele importa

Você escreveu *"replay histórico, se semanticamente possível"*. Quando é possível?

Se `v1` produziu um resultado cuja forma o contrato de resposta de `v2` não expressa, devolver aquele objeto para um cliente `v2` é divergência silenciosa de forma — exatamente o que o desenho contract-first existe para impedir.

Mas **falhar sempre também é errado**: o cliente ficaria sem saber se foi cobrado. Ele precisa aprender o desfecho.

Então a saída é o replay ser **autodescritivo quanto à versão**:

```
replay  →  resultado histórico  +  a versão que o produziu, no envelope
```

O cliente `v2` recebe um resultado marcado como `v1` e sabe como interpretá-lo. Sem a marca, ele parseia errado em silêncio — que é o mesmo defeito, uma camada acima. Só há erro `version_mismatch` quando nem o envelope resolve.

---

## 2. Extensões — confirmado, e é pior do que "pode não governar"

Fui à doc do `CREATE EXTENSION`:

> *"In this case the extension object itself will be owned by the calling user, but **the contained objects will be owned by the bootstrap superuser** (unless the extension's script explicitly assigns them to the calling user)."*

Não é "pode não obedecer" — é o **comportamento padrão**. `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` só governa objetos criados por `db_owner`, e as funções da extensão não são dele.

Sua abordagem adotada: não presumir configuração, **enumerar ACL depois do `CREATE EXTENSION` e depois de todo upgrade de extensão**, e comparar com whitelist. Vira fitness test, não linha de migration.

---

## 3. `pgcrypto` — você está certo, ele sai

Confirmado na doc do próprio pgcrypto, sobre o `gen_random_uuid()` dele:

> *"**(Obsolete, this function internally calls the core function of the same name.)**"*

Se o único motivo era esse, a extensão sai. E o ganho **compõe com o item 2**: uma extensão a menos é um conjunto inteiro de funções de propriedade do bootstrap superuser que some da superfície de ACL a auditar.

Encaixa no critério da Stack sem ressalva: menos extensão, menos objeto, menos ACL, menos coisa para o agente entender. `citext` continua, e é discussão separada.

---

## 4. `SECURITY DEFINER` — regra determinística adicionada

Você está certo que revogar `EXECUTE` não é a história toda. A regra fica com quatro condições, todas verificáveis por catálogo:

```
SECURITY DEFINER  →  search_path seguro declarado, com pg_temp por último
                  →  PUBLIC sem EXECUTE
                  →  owner explícito
                  →  grant em whitelist
```

Classe **determinística** — nasce `error`, não `warn`.

---

## 5. `409`, não `202` — decidido

Você tem razão que deixei aberto o que são duas semânticas distintas.

**Escolhido `409`**, com `Retry-After` e Problem Details de `type` estável:

```
409 Conflict
Retry-After: 1
type: idempotency-command-in-progress
```

`202 Accepted` implica que a API **oferece** processamento assíncrono com mecanismo de consulta posterior. Não é o caso: aqui o comando é síncrono e o cliente só precisa tentar de novo. Usar `202` prometeria um endpoint de status que não existe.

---

## 6. Sua correção sobre `Assumptions` procede

*"O único campo do ADR que se prova sozinho"* está impreciso. O correto é o que você desenhou: **`Claim` e `Assumptions` juntos produzem uma obrigação de teste.**

```
Claim
  ↓ depende de
Assumptions
  ↓ cada uma com proof
Fitness test valida a propriedade
```

O `Claim` sozinho não é testável — é a conclusão. As `Assumptions` sozinhas são testáveis mas não dizem para quê. Juntos viram especificação executável, que é o ponto.

---

## Placar

| Item | Veredito |
|---|---|
| Retry `v1` virar comando novo em `v2` | ❌ **bug meu, e o pior deles** — cobrança dupla no deploy |
| Chave estável entre versões, versão como atributo | ✅ adotado |
| Versão no escopo só se vier do cliente, no contrato | ✅ adotado, com a condição escrita |
| "Replay se semanticamente possível" | ⚠️ indefinido nos dois lados — resolvido com envelope versionado |
| Extensões: objetos do bootstrap superuser | ✅ confirmado na doc — é o padrão, não exceção |
| `pgcrypto` sai | ✅ confirmado obsoleto |
| `SECURITY DEFINER` + `search_path` | ✅ adotado como regra determinística |
| `409` com `Retry-After` | ✅ decidido |
| `Claim` + `Assumptions` = obrigação de teste | ✅ sua formulação é a correta |

Sete rodadas. Este erro é diferente dos outros seis: os anteriores eram imprecisão, fonte errada ou contradição interna — **este teria cobrado duas vezes o mesmo cliente, num deploy, em silêncio.** E nasceu de uma omissão de uma palavra: eu escrevi `operationVersion` sem dizer de quem.

É o argumento mais forte que apareceu a favor do campo `Assumptions`. A premissa não escrita era *"a versão vem do cliente"* — e sem ela escrita, a implementação natural é a que quebra.
