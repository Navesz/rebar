# Resposta à revisão da Stack

> Tudo abaixo que diz "verificado" foi conferido no código-fonte instalado ou em fonte
> primária, não aceito por plausibilidade. Onde não verifiquei, está dito.

Obrigado — é a revisão mais útil que a Stack recebeu. Fui checar as afirmações técnicas uma a uma. Você acertou o principal, inclusive coisas que eu não tinha visto. Dois fatos estão desatualizados, e num ponto a sua conclusão está certa mas o argumento é mais fraco do que precisava ser.

---

## 1. O bug do `SET ROLE` — você está certo, e o motivo é ainda melhor que o seu

**Adotado.** Mas com três correções.

### A premissa da versão está errada, e a culpa é nossa

Você leu `pg 8.13` na Stack. O `package.json` real do projeto diz **`pg ^8.23.0`**, e o instalado é **8.23.0**. O número 8.13 veio de um ADR que ficou para trás do código, e eu o propaguei para a Stack sem reconferir.

Ou seja: **não há incompatibilidade de versão.** A versão já tem `onConnect`. O defeito é não estar usando.

*(De quebra, isso é um caso limpo de deriva de documentação — exatamente a classe de problema que a ferramenta existe para pegar. Vai virar checagem.)*

### O caminho de sucesso não é o problema

Você escreveu que a conexão "pode teoricamente ser entregue antes do `SET ROLE` terminar". Entregue, sim — mas **inofensivamente**, no caminho de sucesso.

O `Client` do `pg` serializa por `_queryQueue` (confirmei em `pg/lib/client.js`). Uma `client.query()` disparada de dentro do handler `connect` entra na fila **primeiro**, e toda query posterior naquele mesmo client fica atrás dela. O comentário no nosso código afirma isso, e está correto.

### O caminho de falha é o problema, e aí você tem toda razão

Com `pool.on('connect')`, o client **já foi entregue** ao chamador. Se o `SET ROLE` rejeita, o `.catch` emite `error` no client — mas isso é uma corrida contra queries já enfileiradas, e o modo de falha é servir query **com privilégio total e RLS contornada**. É precisamente o que o mecanismo existe para impedir.

Com `onConnect` isso deixa de ser corrida. Fui ao fonte do `pg-pool@3.14.0`, linhas 288–301:

```js
if (this.options.onConnect) {
  this._promiseTry(() => this.options.onConnect(client)).then(
    () => { this._afterConnect(client, pendingItem, idleListener) },   // só AQUI o client é entregue
    (hookErr) => {
      this._clients = this._clients.filter((c) => c !== client)
      client.end(() => {
        this._pulseQueue()
        if (!pendingItem.timedOut) pendingItem.callback(hookErr, undefined, NOOP)  // o acquire REJEITA
      })
    }
  )
}
```

O client só chega ao chamador **depois** do hook resolver, e na falha o `acquire` **rejeita**. É exatamente a semântica que uma fronteira de segurança precisa. Sua recomendação está adotada.

### Uma armadilha que nem você nem eu tínhamos visto

O `@types/pg` tipa o hook como:

```ts
onConnect?: ((client: ClientBase) => void) | undefined;
```

**Retorna `void`, não `Promise<void>`.** Funciona em runtime porque o `pg-pool` embrulha em `_promiseTry`, mas o tipo não expressa o contrato — e num desenho onde "o tipo é a documentação executável", isso é justamente o tipo de coisa que engana. Vamos usar um wrapper tipado localmente.

---

## 2. TanStack Start — este fato está desatualizado

Você escreveu que o TanStack Start está "ainda em Release Candidate, não v1 estável" em 25/08/2026.

**Ele saiu de RC e chegou a v1.0 estável em março de 2026.** Foi RC em setembro de 2025; a estável veio cinco meses atrás, e há releases publicados em 22/08/2026.

Isso muda a sua própria recomendação a favor dela: a ressalva que te fez dizer "não substituiria automaticamente sua base inteira por ele" cai. Para o preset `site`, TanStack Start deixa de ser aposta e passa a ser a opção conservadora dentro do ecossistema que já usamos.

Fonte: [anúncio do RC](https://tanstack.com/blog/announcing-tanstack-start-v1) · [releases](https://github.com/TanStack/router/releases)

---

## 3. Oxlint — você está certo, e conferi

Sua leitura procede, e é mais grave do que parece:

- JS plugins entraram em **alpha em março de 2026**, e a documentação diz explicitamente que **não seguem semver**.
- A API é compatível com ESLint v9+.
- **Regras customizadas com type-awareness não são suportadas.** O type-aware linting existe, mas só para as regras do TS-ESLint que já vêm embutidas.

Como quase toda regra arquitetural que queremos escrever é própria — "nenhuma transação fora do `UnitOfWork`", "nenhum `fetch` no domínio" —, e várias delas se beneficiariam de tipo, a divisão que você propôs é a certa: **oxlint para o lint geral rápido, ESLint pequeno só para as regras de política, `tsc` como autoridade de tipo.** Adotado.

Fonte: [Oxlint JS Plugins Alpha](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha) · [docs](https://oxc.rs/docs/guide/usage/linter/js-plugins)

---

## 4. Onde você está certo e eu não tinha visto

**`commandId` não é idempotência.** Correto, e é um buraco real. Hoje é só um campo trafegando. Vira invariante de banco: `UNIQUE (scope, commandId)` mais `requestHash`, resultado e `createdAt` armazenados. Mesmo id + mesmo payload → replay do resultado. Mesmo id + payload diferente → erro. Dois concorrentes → um executa.

**O outbox é ambíguo para agente.** Concordo e é grave. Mostrar `FOR UPDATE SKIP LOCKED` e depois falar de entrega convida exatamente o erro de segurar transação durante I/O — que é a regra nº 1 do documento. Vai virar as três fases explícitas: `TX1 claim + lease → COMMIT → I/O sem transação → TX2 acknowledge`.

**`exactOptionalPropertyTypes`.** Adotado. Em PATCH com Zod e banco, a diferença entre `{name: undefined}` e `{}` é exatamente onde nasce o bug.

**Migrations: expand/contract, e `down` lossless é ficção.** Você tem razão. Exigir que toda migration reverta sem perda é obrigar o agente a fabricar uma sensação de reversibilidade — `DROP COLUMN cpf` não reverte. A política passa a ser: reversível → testa o `down`; destrutiva → forward-only com expand/contract. E o advisory lock resolve concorrência de migration, não compatibilidade entre versões durante rolling deploy. Distinção justa.

**Autorização não é autenticação.** Buraco real. `if (!user) throw 401` não responde "este usuário pode modificar **este** recurso". Vira primitivo do `app/`, não invenção de cada rota. E o ponto sobre contexto de tenant em RLS ser **transaction-local** para não vazar por connection pooling é exatamente o tipo de detalhe que só aparece em produção.

**Deploy é a seção mais imatura.** Concordo sem ressalva. E "restore testado é tão importante quanto migration testada" é a frase que faltava — backup nunca restaurado é backup inexistente.

**Tag móvel.** `postgres:17-alpine` contradiz a filosofia de determinismo do resto. Vai para digest fixado. *(Não conferi os números 18.6 / 17.11 que você citou; a crítica não depende deles.)*

**Architecture Fitness Tests.** Aqui você chegou sozinho ao mecanismo mais importante do projeto — e ele já existe pela metade. O ferramental que estamos herdando tem 15 regras de fronteira com **29 fixtures**, divididas em `aprovar/` e `reprovar/`, e um harness que **reprova qualquer regra declarada que não tenha disparado em nenhum caso ruim**. É literalmente a prisão arquitetural sendo testada. Sua lista de doze asserções vira o roteiro de expansão.

**"Tudo tipado" não pode virar ilusão.** Seus quatro níveis — shape, boundary, business, system — vão para o documento como estão. É melhor do que estava escrito.

---

## 5. Onde eu discordo, ou matizo

**"A arquitetura do agente está incompleta" — certo, mas é um documento separado, não uma lacuna.** A Stack é deliberadamente só a metade de baixo. A camada de agente existe e é o resto do projeto: taxonomia de imposição em oito níveis, painel de decisões, e o gerador. Você descreveu de fora, com precisão, algo que já é o produto. Isso é sinal bom.

**Sobre o MCP: concordo com a conclusão, mas o problema é pior do que você descreveu.** Você diz que não faria garantia arquitetural depender de o agente lembrar de chamar uma tool — certo. Só que a medição no repositório anterior mostra que o MCP não é neutro, é **caro**: 17 guias, 1961 linhas, 80 KB servidos por sessão, e o próprio repositório registra que aquilo virou "texto pago em token toda sessão". A regra que adotamos é mais dura que a sua: **nenhuma prosa mora dentro do servidor MCP.** Toda resposta é derivada de fonte versionada no momento da chamada. Resposta que não pode ser derivada não é resposta de MCP — é ADR.

**Sobre "regra em Markdown eventualmente será violada": temos o número.** Nos seis repositórios reais do dono, os **três sem CI são exatamente os três com lint quebrado agora**. E o caso mais eloquente é o repositório que tem `AGENTS.md` com "Hard rules" e "Definition of done", `SECURITY.md`, `GOVERNANCE.md`, prettier, e um script `check` encadeando tudo — **que nada nunca executa**. Ele tem 35 erros de lint. Sua intuição está certa; a evidência é mais forte que a intuição.

**Sua frase final vira o segundo princípio, com um ajuste.** Você propôs: *"qualquer regra que seja importante demais para a IA esquecer é importante demais para existir apenas como texto."* O método que estamos usando já tem uma formulação operacional disso — *"se uma regra pode descer um nível, ela deve descer"* —, mas a sua diz melhor **por que**. As duas entram.

Uma ressalva que a experiência impõe, e que você não menciona: **regra automática errada custa mais que regra ausente.** Medimos a regra "cor literal reprovada", que parecia a mais óbvia de todas — sete ocorrências no repositório de referência, **cinco dentro de comentários que documentam a própria regra**, uma é véu de overlay legítimo. **Zero verdadeiros positivos.** Se aquela regra tivesse ido para produção como `error`, teria ensinado a desligar o portão na primeira semana. Toda regra nova nasce como aviso com contador, e só vira erro depois de provar que não grita à toa.

---

## Placar

| Item | Veredito |
|---|---|
| `SET ROLE` precisa de `onConnect` | ✅ certo — verificado no fonte do `pg-pool@3.14.0` |
| Premissa `pg 8.13` | ❌ o real é `^8.23.0`; ADR desatualizado, culpa nossa |
| Motivo do bug (promise não aguardada) | ⚠️ o caminho de sucesso é seguro pela fila; o de falha é que quebra |
| TanStack Start em RC | ❌ v1.0 estável desde março/2026 |
| Oxlint: plugins alpha, sem type-aware custom | ✅ certo — verificado na doc |
| `commandId` ≠ idempotência | ✅ adotado |
| Outbox ambíguo | ✅ adotado |
| `exactOptionalPropertyTypes` | ✅ adotado |
| Expand/contract, `down` lossless é ficção | ✅ adotado |
| Autorização ≠ autenticação | ✅ buraco real |
| Deploy imaturo | ✅ concordo |
| Tag móvel do Postgres | ✅ certo (números não conferidos) |
| Fitness tests | ✅ e já existe pela metade |
| Separar preset `site` de `app` | ✅ e agora com TanStack Start estável |
| CSRF junto com auth | ✅ adotado |
