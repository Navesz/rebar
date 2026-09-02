# rebar

**Faz código errado não passar.** Um checker que roda contra qualquer repositório, um
portão que barra o commit quando a regra é ignorada, e um gerador que fabrica o próximo
projeto já do lado certo da régua.

Zero dependência em tempo de execução. O checker nunca escreve no repositório que audita.

```bash
npx github:Navesz/rebar .                    # auditar o que já existe
npx github:Navesz/rebar novo padaria-do-ze   # começar certo
```

---

## O problema

Este projeto nasceu de uma queixa concreta:

> Todos os sites que peço para usar o padrão como referência — muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando a IA como colaboradora,
> esquecendo do shadcn.

A resposta usual é escrever a regra melhor. Não funciona, e dá para medir. Numa forense de
**161 commits em seis repositórios**:

| Medição | Resultado |
|---|---|
| Repositórios sem CI | 3 de 6 |
| Repositórios com lint quebrado agora | **os mesmos 3** |
| Commits com coautoria de IA | 41 de 161 (25,5%) |
| Repositório com mais documento de governança | **35 erros de lint** |

Aquele último é o caso que decide o desenho. Ele tinha `AGENTS.md` com "Hard rules",
`SECURITY.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, e um script `check` encadeando formato,
lint, tipos, teste e build. **Nada nunca executava esse `check`.**

> Regra em markdown tem cumprimento próximo de zero. Regra em CI tem 100%.

Daí a tese: **se uma regra pode descer de prosa para enforcement, ela deve descer — mas o
enforcement precisa ser mais confiável do que a regra que substitui.**

## Uso

```bash
npx github:Navesz/rebar <caminho>          # placar de um repositório
npx github:Navesz/rebar <a> <b> <c>        # vários de uma vez, com resumo comparável
npx github:Navesz/rebar --json <caminho>   # para CI
npx github:Navesz/rebar --regra=ci <dir>   # uma regra só
npx github:Navesz/rebar novo <nome> [dom]  # o gerador — ver "O gerador", abaixo
```

`novo` é subcomando do mesmo `bin`, e não um segundo comando, porque é assim que o npx
funciona: `npx github:Navesz/rebar novo meu-site` resolve o bin com o nome do pacote e
entrega `novo` como primeiro argumento. Para auditar uma pasta que se chame literalmente
`novo`, escreva `./novo`.

Saída:

```
rebar-check · prumo
  ✓ editorconfig       tem .editorconfig
  ✗ dependabot         atualização de dependência automatizada  sem dependabot nem renovate
  ✓ ci                 tem CI
  ✓ ci-gateia          o CI alcança a verificação que o repositório tem
  – typecheck          tem script de typecheck  não tem TypeScript
  11 de 13  ·  1 não se aplica
```

Três estados, e o terceiro é o que impede o placar de mentir: **"não se aplica" sai do
denominador.** Antes de existir, uma pasta vazia com um `.git/` vazio tirava 8 de 14 —
empatava com o próprio rebar e tirava o dobro do repositório mais rigoroso da máquina.
O nada não conforma; o nada não se aplica.

### Códigos de saída

| | |
|---|---|
| `0` | tudo que se aplica passou |
| `1` | reprovou — violação real |
| `2` | alvo inválido ou invocação errada |
| `127` | **quebrou** — uma regra lançou exceção |

O `127` domina o `1`: não se acusa um repositório com uma régua que quebrou.

## O que ele checa

**16 determinísticas** derrubam o exit code:

`editorconfig` · `dependabot` · `ci` · `ci-gateia` · `testes` · `typecheck` · `formatter` ·
`env-example` · `licenca` · `readme` · `notice` · `coautoria-ia` · `identidade-git` ·
`ui-falso` · `schema-orfao` · `telefone`

**5 heurísticas** só informam, e a separação é medida, não estética:

`conteudo-fora-do-codigo` · `shadcn-completo` · `url-producao` · `hex-cru` · `idioma-unico`

```bash
npx github:Navesz/rebar --json . | grep -c '"classe": "determinística"'   # 16
```

A regra ingênua de cor literal, medida num repositório real, deu **7 ocorrências e zero
verdadeiros positivos** — cinco eram comentários documentando a própria regra. Regra
automática errada custa mais que regra ausente, e heurística que barra ensina a desligar a
saída inteira.

### Toda regra nasce com dois casos

```bash
npm run provar     # 50 casos · 21 de 21 regras com prova
```

Cada caso monta um repositório em miniatura num diretório temporário, com `git init`
próprio, e confere o **estado** da regra — passou, reprovou, não se aplica ou quebrou.
Nunca escreve no repositório vivo.

Ler só o exit code não bastava: `passou` e `não se aplica` saem os dois como `0`, então
**13 das 20 regras eram inprováveis por construção.** Hoje, restaurar à mão qualquer um
desses 13 ramos faz a suíte reprovar.

## O portão

O checker é uma das camadas, não a única.

| Camada | O quê | Quem barra |
|---|---|---|
| **N5** | `pre-commit` — segredo em stage | git, na tua máquina |
| **N5** | `commit-msg` — coautoria de IA | git, antes do commit existir |
| **N4** | CI em matriz Windows + Linux | GitHub Actions |
| **N4s** | ruleset com check obrigatório | **o servidor** |

O N4s existe porque tudo abaixo dele mora em arquivo que o agente edita: o workflow ele
apaga, o `core.hooksPath` ele remove sem deixar diff. Só o ruleset resiste — e aqui ele
está com `bypass_actors: []`, então nem o dono passa por cima.

```bash
npm run verificar        # os 8 passos, um comando
npm run instalar-hooks   # aponta core.hooksPath para ferramental/hooks
```

## O gerador

```bash
npx github:Navesz/rebar novo padaria-do-ze padaria-do-ze.com.br
```

Seis passos: valida o nome, chama `shadcn create` (Next 16 App Router, React 19.2.4,
Tailwind 4, `@base-ui/react`, **zero Radix**), aplica o preset `site` por cima, aplica o
portão por cima do preset, faz `git init` + hooks + primeiro commit, e **roda a régua no
que acabou de criar, imprimindo o placar**. Um gerador que fabrica projeto reprovado é um
gerador que fabrica dívida, então o placar sai na tela mesmo quando é ruim — e o exit do
gerador é o exit da régua.

Ele **não escreve aplicação**. O scaffold é do shadcn de propósito: manter uma cópia
própria dele seria mantê-la em dia para sempre, e ela apodreceria na primeira release
deles. O que o gerador põe é o que o shadcn não põe.

Medido em 31/08/2026, rodando de ponta a ponta com rede, num `os.tmpdir()`:

| | |
|---|---|
| régua sobre o projeto gerado | **14 de 14** · 2 n/a · exit 0 |
| `npm run verificar` dentro dele | lint + typecheck + **6/6** testes + build · exit 0 |
| `npx next build` | exit 0, **5 rotas** `prerendered as static content` |
| `out/index.html` | 15.255 bytes, com `og:image` absoluto e **sem uma linha de JS** |
| conteúdo quebrado de propósito | **5 mutações, 5 builds exit 1** |

O preset `site` é Next com `output: "export"` publicado no GitHub Pages — SSG, porque SPA
não entrega `og:image`: WhatsApp, LinkedIn, Slack e Discord não executam JS.

**A identidade do negócio é conteúdo validado no build, não variável de ambiente.** Fica
em `conteudo/site.json`, com esquema em TypeScript puro que roda no `next build`. A decisão
tem preço conhecido: no PR `Navesz/Galegos#1`, com env var, o `wa.me` subia sem
destinatário e o cardápio parava de entregar pedido **em silêncio**. Aqui ele não sobe:

```
ErroDeConteudo: conteudo/site.json inválido em "site.identidade.whatsapp.e164":
  esperava texto no formato só dígitos, com DDI (ex.: 55 + DDD + número),
  veio "(11) 98888-7777".
```

O que o gerador **não** faz, de propósito, porque mexe na conta de quem roda: criar o
repositório remoto, ligar o ruleset e ligar o Pages. Ele imprime as três no fim.

O `verificar` não tem campo `opcional` — a chave é recusada com exit 2. E `--passo=<nome>`
imprime `PARCIAL`, lista o que não rodou e sai `3`, nunca `0`. Os dois são portas
destrancadas que existiam no projeto anterior e que este se recusa a herdar.

## O MCP, e o portão que o mantém em dia

As regras precisam estar na memória da IA que escreve o código, não só no portão que a
reprova depois. É para isso que existe o servidor MCP — e o defeito que ele existe para
**não** repetir é concreto: num projeto anterior o MCP guardava as regras e ninguém o
reescrevia quando elas mudavam, então ele servia a versão velha e nada acusava.

Aqui o MCP **não é escrito à mão**. Ele é artefato gerado, como o `tsconfig` e o lint:

```bash
node mcp/gerar.mjs              # deriva mcp/regras.gerado.json de ferramental/rebar-check/index.mjs
node mcp/gerar.mjs --verificar  # regenera EM MEMÓRIA, compara com o disco, sai 1 se divergir
```

O segundo comando é o **passo `mcp` do portão** — 5 de 11, ~200 ms. Mudar uma regra e
esquecer o MCP virou impossível, e isso é reproduzível em quatro comandos:

```bash
sed -i "s/titulo: 'tem README',/titulo: 'tem README na raiz',/" ferramental/rebar-check/index.mjs
node ferramental/verificar/verificar.mjs   # REPROVADO no passo `mcp`, nomeando o título que mudou
node mcp/gerar.mjs                         # um comando
node ferramental/verificar/verificar.mjs   # APROVADO 11 de 11
```

O artefato é **derivado, nunca duplicado**: ele não guarda cópia da regra, deriva da
fonte, e grava o `sha256` de cada fonte que leu. Não há duas fontes para divergir.

| | |
| --- | --- |
| `mcp/gerar.mjs` | 902 linhas, **zero dependência** — roda no `verificar` da raiz, sem `mcp/node_modules` |
| `mcp/regras.gerado.json` | 78 KB · 22 regras · 8 níveis · 11 passos · 52 provas · 36 parágrafos de porquê |
| `mcp/src/` | o servidor, 937 linhas. Lê o artefato; **nunca** lê o `index.mjs` |

Cinco ferramentas: `rebar_regras`, `rebar_porque`, `rebar_decidir`, `rebar_portao`,
`rebar_verificar`. Para ligar e para a prova de ponta a ponta, ver **[mcp/README.md](mcp/README.md)**.

```bash
cd mcp && npm install           # uma vez: mcp/ é pacote separado, a raiz segue com zero dependência
node mcp/src/prova-cliente.mjs  # handshake, tools/list, 7 chamadas, e o servidor sem artefato
node ferramental/rebar-check/index.mjs --mcp   # é o que o .mcp.json de um projeto gerado executa
```

**O MCP nunca é a porta.** A porta é o `verificar`, o hook e o CI. Chamar uma ferramenta
daqui é atalho para não errar; nenhuma resposta dela autoriza nada.

## Estado

Honesto, e medido:

| | |
|---|---|
| O checker | **funciona** — 22 regras, 52 provas, rodado contra 19 repositórios |
| O portão | **funciona** — CI verde nos dois sistemas, merge barrado com PR plantado |
| Domínio de privilégio de banco | **provado** — 16 asserções contra PostgreSQL 17 real |
| O gerador (`rebar novo`) | **funciona** — rodado de ponta a ponta, projeto 14 de 14 |
| Preset `site` | **funciona** — Next 16 SSG, `og:image` no HTML, conteúdo validado no build |
| Presets `app` / `api` | **não existem**, e são não-escopo até o `site` rodar em dois sites |
| MCP (`mcp/`) | **funciona, e o portão o mantém em dia** — 5 ferramentas, artefato derivado das 22 regras |

O rebar tira **12 de 12** na própria régua — 11 de 11 enquanto `novo/` não estiver
rastreado, porque a régua lê `git ls-files` e não enxerga arquivo fora do índice. Isso não
é motivo de orgulho: é o mínimo para ter autoridade de exigir dos outros.

Detalhe completo, com o comando que reproduz cada número, em **[ESTADO.md](ESTADO.md)**.

### Critério de abandono

O projeto tem data para morrer, e está escrito:

| Marco | Critério | Se falhar |
|---|---|---|
| D+7 | rodou contra ≥3 repositórios que não são ele | para |
| **D+30** | **≥2 repositórios com o check reprovando merge** | vira checklist e o repo é apagado |
| D+60 | uma checagem disparou e o código foi consertado, não a checagem desligada | a regra estava errada |
| D+90 | checagens cresceram ≤50% **e** a adoção cresceu | congela a lista |

Hoje o D+30 está em **1 de 2**. O projeto anterior morreu porque a imposição nunca
escalou; este tem prazo para provar que escala.

## Desenvolvimento

```bash
git clone https://github.com/Navesz/rebar && cd rebar
npm ci                   # única dependência: prettier
npm run instalar-hooks
npm run verificar
```

O gerador **não** tem script npm, de propósito: ele cria a pasta dentro do diretório atual,
e `npm run` roda sempre na raiz do pacote — criaria `rebar/meu-site`. Do checkout, chame o
arquivo, de onde o projeto vai morar:

```bash
cd ~/projetos && node /caminho/do/rebar/novo/index.mjs meu-site meu-site.com.br
```

Node ≥ 22. O `index.mjs` e o `novo/index.mjs` importam só built-ins — é o que faz o `npx`
funcionar sem instalar nada, e a fronteira é deliberada: zero dependência é propriedade do
que **confere**, não do que se confere. O gerador não abre exceção: ele chama o `shadcn`
resolvendo o `npx-cli.js` que mora ao lado do `process.execPath` e passando os argumentos
como vetor, sem `shell: true` — `npx` no Windows é `npx.cmd`, e `execFileSync('npx', …)`
falha lá com `ENOENT` sobre um arquivo que está no PATH. Foi o bug que quebrou o projeto
anterior, e ele só não apareceu antes porque o CI de lá só rodava Linux.

`novo/site/blocos/` e `novo/portao/arquivos/` são **modelo, não produto** — arquivos que o
gerador copia para dentro do projeto criado. Cada uma das duas pastas tem um `modelo.json`
que a tira da avaliação do rebar-check, e a contagem sai impressa no placar. Sem isso, os
cinco `.tsx` de exemplo faziam a regra `typecheck` enxergar aqui um projeto TypeScript sem
compilador. Eles continuam sendo checados onde caem: no passo 5 do gerador, dentro do
projeto gerado, com `tsconfig.json` em volta.

Coautoria de IA é barrada por allowlist de humanos em [`.rebar-coautores`](.rebar-coautores).
Enumerar humanos é uma lista curta e estável; enumerar agentes de IA é uma corrida que se
perde toda semana.

## Licença

[Apache-2.0](LICENSE)
