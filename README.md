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

_Medição histórica de 25/08/2026, feita nos outros repositórios da máquina do dono. Não é
propriedade desta árvore, não é derivável daqui, e não deve ser atualizada: é a evidência
que originou o projeto, com a data em que foi colhida._

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

_Recorte de uma saída real contra o `prumo`, medida em 30/08/2026 — é ilustração do
formato, não placar desta árvore. O placar do próprio rebar está em "Estado", abaixo._

Três estados, e o terceiro é o que impede o placar de mentir: **"não se aplica" sai do
denominador.** Antes de existir, uma pasta vazia com um `.git/` vazio tirava 8 de 14 —
empatava com o próprio rebar e tirava o dobro do repositório mais rigoroso da máquina
(medido em 30/08/2026, com a régua anterior à correção; o número não é comparável com
nenhum de hoje e fica como registro do defeito). O nada não conforma; o nada não se aplica.

### Códigos de saída

| | |
|---|---|
| `0` | tudo que se aplica passou |
| `1` | reprovou — violação real |
| `2` | alvo inválido ou invocação errada |
| `127` | **quebrou** — uma regra lançou exceção |

O `127` domina o `1`: não se acusa um repositório com uma régua que quebrou.

## O que ele checa

São <!--n regras.total-->22<!--/n--> regras em duas classes.

**<!--n regras.deterministicas-->17<!--/n--> determinísticas** derrubam o exit code:

São elas: <!--n regras.lista-deterministicas-->`editorconfig` · `dependabot` · `ci` · `ci-gateia` · `testes` · `typecheck` · `formatter` · `env-example` · `licenca` · `readme` · `notice` · `hooks-executaveis` · `coautoria-ia` · `identidade-git` · `ui-falso` · `schema-orfao` · `telefone`<!--/n-->

**<!--n regras.heuristicas-->5<!--/n--> heurísticas** só informam, e a separação é medida,
não estética:

São elas: <!--n regras.lista-heuristicas-->`conteudo-fora-do-codigo` · `shadcn-completo` · `url-producao` · `hex-cru` · `idioma-unico`<!--/n-->

Este comando imprime o número das determinísticas, e ele é o <!--n regras.deterministicas-->17<!--/n--> da linha acima:

```bash
npx github:Navesz/rebar --json . | grep -c '"classe": "determinística"'
```

A regra ingênua de cor literal, medida num repositório real, deu **7 ocorrências e zero
verdadeiros positivos** — cinco eram comentários documentando a própria regra. (Medição
histórica no `herz`, 30/08/2026; está registrada em `ferramental/rebar-check/index.mjs`,
ao lado da regra que ela decidiu.) Regra automática errada custa mais que regra ausente, e
heurística que barra ensina a desligar a saída inteira.

### Toda regra nasce com dois casos

São <!--n provas.casos-->52<!--/n--> casos, cobrindo <!--n provas.cobertura-->22 de 22<!--/n--> regras — nenhuma regra sem prova:

```bash
npm run provar
```

Cada caso monta um repositório em miniatura num diretório temporário, com `git init`
próprio, e confere o **estado** da regra — passou, reprovou, não se aplica ou quebrou.
Nunca escreve no repositório vivo.

Ler só o exit code não bastava: `passou` e `não se aplica` saem os dois como `0`, então
**13 das 20 regras eram inprováveis por construção** — medido em 30/08/2026, quando as
regras eram 20; o `13` e o `20` são daquele dia e ficam como registro do furo. Hoje,
restaurar à mão qualquer um daqueles 13 ramos faz a suíte reprovar.

## O portão

O checker é uma das camadas, não a única.

| Camada | O quê | Quem barra |
|---|---|---|
| **N5** | `pre-commit` — segredo em stage e coautoria | git, na tua máquina |
| **N5** | `commit-msg` — coautoria de IA | git, antes do commit existir |
| **N4** | CI em matriz Windows + Linux, e o que ele roda é o `verificar` inteiro | GitHub Actions |
| **N4s** | ruleset com check obrigatório | **o servidor** |

`npm run verificar` **não é uma camada nova**: é a sequência que o N4 executa e que você
roda antes dele, hoje com <!--n verificar.passos-->13<!--/n--> passos. O checker é o último
deles.

O N4s existe porque tudo abaixo dele mora em arquivo que o agente edita: o workflow ele
apaga, o `core.hooksPath` ele remove sem deixar diff. Só o ruleset resiste — e aqui ele
está com `bypass_actors: []`, então nem o dono passa por cima.

```bash
npm run verificar        # a sequência inteira, um comando
npm run instalar-hooks   # aponta core.hooksPath para ferramental/hooks
```

### Os <!--n verificar.passos-->13<!--/n--> passos, e o que cada um barra

Na ordem em que rodam, do mais barato para o mais caro — o executor reporta o **primeiro**
passo caído como "conserte primeiro", e consertar sintaxe costuma apagar sozinho as falhas
de baixo: <!--n verificar.lista-passos-->`higiene` · `hooks` · `sintaxe` · `blocos` · `mcp-servidor` · `mcp` · `numeros` · `formato` · `elos` · `segredo` · `passos` · `provas` · `auto`<!--/n-->

| # | Passo | O que ele barra |
|---|---|---|
| <!--n verificar.posicao.higiene-->1 de 13<!--/n--> | `higiene` | o estado do git contra o que o portão está prestes a afirmar: bit de `skip-worktree`/`assume-unchanged` no índice, ignore local em `.git/info/exclude`, e o hash dos dois arquivos do próprio portão contra o HEAD |
| <!--n verificar.posicao.hooks-->2 de 13<!--/n--> | `hooks` | os dois hooks existem e `core.hooksPath` aponta para eles |
| <!--n verificar.posicao.sintaxe-->3 de 13<!--/n--> | `sintaxe` | `node --check` em cada `.mjs` que o git conhece, rastreado ou recém-escrito |
| <!--n verificar.posicao.blocos-->4 de 13<!--/n--> | `blocos` | sintaxe e `modelo.json` dos arquivos que o gerador copia para **dentro** de todo projeto criado |
| <!--n verificar.posicao.mcp-servidor-->5 de 13<!--/n--> | `mcp-servidor` | o servidor MCP **sobe e responde ao protocolo** — não basta existir no disco |
| <!--n verificar.posicao.mcp-->6 de 13<!--/n--> | `mcp` | o artefato do MCP divergir da fonte de que ele deriva |
| <!--n verificar.posicao.numeros-->7 de 13<!--/n--> | `numeros` | um número do README ou do ESTADO divergir da fonte — é o passo que escreveu os números desta página |
| <!--n verificar.posicao.formato-->8 de 13<!--/n--> | `formato` | `prettier --check .` |
| <!--n verificar.posicao.elos-->9 de 13<!--/n--> | `elos` | link relativo quebrado na documentação |
| <!--n verificar.posicao.segredo-->10 de 13<!--/n--> | `segredo` | credencial no repositório, com o conteúdo lido do **índice** quando é `--staged` |
| <!--n verificar.posicao.passos-->11 de 13<!--/n--> | `passos` | os passos que são função do portão, provados **por mutação** — o portão provando o portão |
| <!--n verificar.posicao.provas-->12 de 13<!--/n--> | `provas` | os <!--n provas.casos-->52<!--/n--> casos das regras |
| <!--n verificar.posicao.auto-->13 de 13<!--/n--> | `auto` | o `rebar-check` apontado para o próprio rebar |

**Nenhum passo é opcional**: o campo não existe, e `verificar.mjs` recusa a chave com exit
2. Onde há afrouxamento, ele é dentro do passo, e está dito aqui em vez de escondido:

- `higiene` — **árvore suja só avisa fora do CI**, porque árvore suja é o estado normal de
  quem está editando e portão que não fecha é portão que se aprende a contornar. Dentro do
  CI reprova, porque lá sujeira é artefato de build. Divergência de hash que **não** aparece
  no `git status` reprova sempre, CI ou não: é a assinatura do `skip-worktree`.
- `hooks` — **`core.hooksPath` só avisa dentro do CI**, porque o runner não commita e o
  hook não roda lá. Localmente reprova. A existência dos arquivos de hook reprova em
  qualquer lugar.
- `numeros` — grupo de fato que **esta** árvore não sabe derivar (sem `.git`, sem `novo/`)
  só avisa, nomeando o grupo e a fonte que faltou.
- `auto` — **heurística não entra no denominador**, sai como aviso. É o que impede
  heurística de ensinar a desligar a saída inteira.
- `mcp-servidor` — sem `mcp/node_modules` o passo **QUEBRA** (exit 127), não reprova:
  ferramental faltando não é o repositório errando. O conserto é `cd mcp && npm ci`.

Os avisos não somem da tela por serem avisos: o campo `avisar` de cada passo os extrai e
imprime **mesmo quando o passo passa**, em seção própria abaixo do placar.

## O gerador

```bash
npx github:Navesz/rebar novo padaria-do-ze padaria-do-ze.com.br
```

Ele roda <!--n novo.passos-->6<!--/n--> passos: valida o nome, chama `shadcn create` (Next 16 App Router, React 19.2.4,
Tailwind 4, `@base-ui/react`, **zero Radix**), aplica o preset `site` por cima, aplica o
portão por cima do preset, faz `git init` + hooks + primeiro commit, e **roda a régua no
que acabou de criar, imprimindo o placar**. Um gerador que fabrica projeto reprovado é um
gerador que fabrica dívida, então o placar sai na tela mesmo quando é ruim — e o exit do
gerador é o exit da régua.

Ele **não escreve aplicação**. O scaffold é do shadcn de propósito: manter uma cópia
própria dele seria mantê-la em dia para sempre, e ela apodreceria na primeira release
deles. O que o gerador põe é o que o shadcn não põe.

Medido em 31/08/2026, rodando de ponta a ponta com rede, num `os.tmpdir()`. **É medição
histórica**: os números abaixo são daquele dia e daquela execução, não são propriedade
desta árvore, e não são regenerados por ninguém — refazê-los pede rodar o gerador de novo.

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

O segundo comando é o **passo `mcp` do portão**, o <!--n verificar.posicao.mcp-->6 de 13<!--/n--> da lista, e custa ~200 ms nesta máquina
(mediana de 5 rodadas em 01/09/2026 — Windows 11, Node 24.13; é medição de máquina, não
propriedade da árvore). Mudar uma regra e esquecer o MCP virou impossível, e isso é
reproduzível em quatro comandos — o segundo REPROVA no passo `mcp` nomeando o título que
mudou, e o quarto volta a APROVAR os <!--n verificar.passos-->13<!--/n--> passos:

```bash
sed -i "s/titulo: 'tem README',/titulo: 'tem README na raiz',/" ferramental/rebar-check/index.mjs
node ferramental/verificar/verificar.mjs
node mcp/gerar.mjs
node ferramental/verificar/verificar.mjs
```

O artefato é **derivado, nunca duplicado**: ele não guarda cópia da regra, deriva da
fonte, e grava o `sha256` de cada fonte que leu. Não há duas fontes para divergir.

| | |
| --- | --- |
| `mcp/gerar.mjs` | <!--n linhas.mcp-gerador-->902<!--/n--> linhas, **zero dependência** — roda no `verificar` da raiz, sem `mcp/node_modules` |
| `mcp/regras.gerado.json` | <!--n mcp.artefato.tamanho-->81 KB<!--/n--> · <!--n mcp.artefato.regras-->22<!--/n--> regras · <!--n mcp.artefato.niveis-->8<!--/n--> níveis · <!--n mcp.artefato.passos-->13<!--/n--> passos · <!--n mcp.artefato.provas-->52<!--/n--> provas |
| `mcp/src/` | o servidor, <!--n linhas.mcp-servidor-->937<!--/n--> linhas. Lê o artefato; **nunca** lê o `index.mjs` |

O servidor expõe <!--n mcp.ferramentas-->5<!--/n--> ferramentas: `rebar_regras`, `rebar_porque`,
`rebar_decidir`, `rebar_portao`, `rebar_verificar`. Para ligar e para a prova de ponta a
ponta, ver **[mcp/README.md](mcp/README.md)**.

```bash
cd mcp && npm install           # uma vez: mcp/ é pacote separado, a raiz segue com zero dependência
node mcp/src/prova-cliente.mjs  # é o passo `mcp-servidor` do portão
node ferramental/rebar-check/index.mjs --mcp   # é o que o .mcp.json de um projeto gerado executa
```

O `prova-cliente.mjs` faz o handshake, um `tools/list`, sete `tools/call`, e ainda exercita
o servidor **sem** artefato e com a fonte adulterada — é ele que o passo `mcp-servidor`
executa, porque escrito-e-nunca-executado é o estado em que este módulo passou semanas.

**O MCP nunca é a porta.** A porta é o `verificar`, o hook e o CI. Chamar uma ferramenta
daqui é atalho para não errar; nenhuma resposta dela autoriza nada.

## Estado

Honesto, e medido:

| | |
|---|---|
| O checker | **funciona** — <!--n regras.total-->22<!--/n--> regras, <!--n provas.casos-->52<!--/n--> provas, rodado contra 19 repositórios em 30/08/2026 |
| O portão | **funciona** — <!--n verificar.passos-->13<!--/n--> passos, CI verde nos dois sistemas, merge barrado com PR plantado |
| Domínio de privilégio de banco | **provado** — <!--n dominio.privilegio.testes-->16<!--/n--> asserções contra PostgreSQL 17 real |
| O gerador (`rebar novo`) | **funciona** — rodado de ponta a ponta em 31/08/2026, projeto 14 de 14 |
| Preset `site` | **funciona** — Next 16 SSG, `og:image` no HTML, conteúdo validado no build |
| Presets `app` / `api` | **não existem**, e são não-escopo até o `site` rodar em dois sites |
| MCP (`mcp/`) | **funciona, e o portão o mantém em dia** — <!--n mcp.ferramentas-->5<!--/n--> ferramentas, artefato derivado das <!--n regras.total-->22<!--/n--> regras |
| Os números destes documentos | **derivados** — `node ferramental/numeros.mjs` os escreve, e o passo `numeros` reprova se envelhecerem |

O rebar tira **13 de 13 · 4 não se aplica** na própria régua, com `novo/` já rastreado —
medido em 02/09/2026 com `node ferramental/rebar-check/index.mjs .`, que é o passo `auto`
do portão. Este par de números **não** é derivado: obtê-lo pede RODAR a régua, e quem já o
trava é o passo `auto`; derivá-lo aqui criaria a segunda fonte que o projeto inteiro existe
para não ter. Isso não é motivo de orgulho: é o mínimo para ter autoridade de exigir dos
outros.

**Nenhum outro número desta página foi digitado à mão.** Eles envelheciam em horas e
erraram seis vezes — o README chegou a dizer 16 determinísticas quando eram 17, 50 casos
quando eram 52, e "os 8 passos" quando eram 12. A cura é a mesma que o MCP já usa: o fato é
derivado da fonte, um comando regenera, e um passo do portão reprova se o documento
divergir.

```bash
node ferramental/numeros.mjs              # reescreve os números do README e do ESTADO
node ferramental/numeros.mjs --verificar   # o passo `numeros` do portão: sai 1 se divergiu
node ferramental/numeros.mjs --fatos       # o catálogo: cada fato, seu valor e sua fonte
```

O que **não** é derivado fica dito com a data ao lado, como as três linhas acima: medição
de outra árvore, de outra máquina ou de outro dia é história, e apagar história para deixar
o documento uniforme seria trocar a evidência que fundamenta a regra por aparência de
precisão.

Detalhe completo, com o comando que reproduz cada número, em **[ESTADO.md](ESTADO.md)**.

### Critério de abandono

O projeto tem data para morrer, e está escrito:

| Marco | Critério | Se falhar |
|---|---|---|
| D+7 | rodou contra ≥3 repositórios que não são ele | para |
| **D+30** | **≥2 repositórios com o check reprovando merge** | vira checklist e o repo é apagado |
| D+60 | uma checagem disparou e o código foi consertado, não a checagem desligada | a regra estava errada |
| D+90 | checagens cresceram ≤50% **e** a adoção cresceu | congela a lista |

Em 02/09/2026 o D+30 está em **1 de 2** — o único repositório gateado é o próprio rebar. O
projeto anterior morreu porque a imposição nunca escalou; este tem prazo para provar que
escala.

## Desenvolvimento

O `npm ci` instala <!--n pacote.dependencias-->0<!--/n--> dependências de runtime; a única
de desenvolvimento é <!--n pacote.dev-dependencias-->`prettier` 3.9.6<!--/n-->.

```bash
git clone https://github.com/Navesz/rebar && cd rebar
npm ci
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
gerador copia para dentro do projeto criado — <!--n novo.arquivos-modelo-->23<!--/n--> dos <!--n novo.arquivos-->27<!--/n--> arquivos de `novo/`. Cada uma das duas pastas tem um
`modelo.json` que a tira da avaliação do rebar-check, e a contagem sai impressa no placar.
Sem isso, os `.ts`/`.tsx` de exemplo faziam a regra `typecheck` enxergar aqui um projeto
TypeScript sem compilador. Eles continuam sendo checados em dois lugares: no passo `blocos`
do portão, aqui, e no passo 5 do gerador, dentro do projeto gerado, com `tsconfig.json` em
volta.

Coautoria de IA é barrada por allowlist de humanos em [`.rebar-coautores`](.rebar-coautores).
Enumerar humanos é uma lista curta e estável; enumerar agentes de IA é uma corrida que se
perde toda semana.

## Licença

[Apache-2.0](LICENSE)
