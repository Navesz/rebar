# rebar — estado do projeto

> **Leia este arquivo primeiro.** É o ponto de entrada de qualquer sessão nova.
> Medido e reescrito em **30/08/2026** · repo: `C:\Users\leona\OneDrive\Documents\rebar`
>
> **Revisão de 31/08/2026:** o gerador passou a existir e a rodar — §4.11. As seções 4.2,
> 4.3 e 5.1 foram remedidas nesta data porque o gerador mudou o que elas contavam. O que
> não foi remedido em 31/08 continua com a data e o número de 30/08, e está dito onde é.
>
> **Revisão de 02/09/2026:** os números deste arquivo **deixaram de ser digitados** — leia
> a §0, que mudou por inteiro. Todo número que é propriedade desta árvore agora vem de
> `node ferramental/numeros.mjs` e é conferido pelo passo `numeros` do `verificar`. O que
> não é derivável ficou com a data ao lado, dizendo que é histórico.

---

## 0. A regra deste arquivo

**Nenhum número que seja propriedade desta árvore é digitado aqui.** Ele é derivado da
fonte por `ferramental/numeros.mjs`, gravado entre marcadores invisíveis, e conferido a
cada `npm run verificar`:

```bash
node ferramental/numeros.mjs              # reescreve os números do README e deste arquivo
node ferramental/numeros.mjs --verificar   # o passo `numeros` do portão: sai 1 se divergiu
node ferramental/numeros.mjs --fatos       # o catálogo: cada fato, seu valor e sua fonte
```

No markdown cru o número aparece assim, e o comentário HTML é invisível no GitHub:

    **<!--n regras.deterministicas-->17<!--/n--> determinísticas** derrubam o exit code

O marcador **nomeia o fato**, então quem abre o arquivo cru para editar o número lê
`regras.deterministicas` antes de tocar nele — o aviso mora no lugar exato onde a tentação
acontece. E o medidor recusa marcador dentro de cerca de código, porque lá o comentário
seria impresso literalmente: **cerca mostra o comando, a prosa ao lado mostra o número.**

### Por que isto substituiu a regra anterior

A regra anterior era boa e falhou. Ela dizia: _"todo número vem com o comando que o
reproduz"_ — e continua valendo para o que **não** é derivável, mais abaixo. O que ela não
conseguia era impedir que o número envelhecesse entre o dia em que foi medido e o dia em
que alguém lê.

**Este arquivo e o README erraram número SEIS vezes.** A versão anterior desta seção
admitia três e prometia mais cuidado; o cuidado durou dois dias e vieram outras três:

| # | Quando | O que estava escrito | O que era verdade |
| --- | --- | --- | --- |
| 1 | 30/08 | "20 checagens" | 19 |
| 2 | 30/08 | placar tirado de uma régua descalibrada, em que uma pasta vazia empatava com o rebar | o N/A não estava fora do denominador |
| 3 | 30/08 | uma tabela que soma 56, com o texto ao lado dizendo 55 | 56 |
| 4 | 02/09 | README: "16 determinísticas", e a lista omitindo `hooks-executaveis` | 17 |
| 5 | 02/09 | README: "50 casos · 21 de 21 regras com prova" | 52 casos · 22 de 22 |
| 6 | 02/09 | README: "os 8 passos" do `verificar` | eram 12 naquele momento, e são 13 agora |

E, ao lado dos seis, o defeito que os torna todos previsíveis: **este arquivo carregava
QUATRO contagens diferentes de casos de prova — 13, 33, 47 e 50 — espalhadas pelo mesmo
texto.** Das quatro, no máximo uma podia estar certa.

**A causa é estrutural, e escrever com mais cuidado é a resposta que já falhou seis vezes.**
Os números eram escritos à mão e a verdade muda a cada commit. Este repositório inteiro
existe para dizer que regra em markdown tem cumprimento próximo de zero e regra em portão
tem 100%; manter os próprios números em markdown era a exceção que a régua se dava.

**A resposta desta vez não foi recontar. Foi tirar o número da mão humana** — a mesma
doutrina que o `mcp/gerar.mjs` já tinha aplicado ao MCP, no §4.12:

1. o fato é **derivado** da fonte, nunca digitado;
2. **um comando regenera** — `node ferramental/numeros.mjs`;
3. **um comando `--verificar`** compara com o disco e **reprova** se divergir;
4. um **passo do `verificar`** roda esse `--verificar`, então commitar com documento velho
   deixou de ser possível.

O sétimo erro não vai depender de alguém lembrar. Vai ser um passo vermelho.

### O que continua sendo escrito à mão, e por quê

Nem todo número de um documento é um fato desta árvore. Um número entra no catálogo
derivado se, e só se, passa nos três testes de `ferramental/numeros.mjs`: **(1)** é
propriedade desta árvore agora; **(2)** muda quando o código muda, e só então — não com o
relógio, e não pelo próprio ato de ser registrado; **(3)** tem derivação de uma linha, sem
rede e sem rodar o produto.

O que não passa fica escrito à mão, **com a data ao lado e dito que é histórico**:

| Fica à mão | Por quê |
| --- | --- |
| "161 commits em seis repositórios", "8 de 9 credenciais reais passaram", o placar dos 19 repositórios da §4.8 | medição de **outra árvore**, outra máquina, outro dia. Derivar é impossível; sobrescrever seria apagar história, e a história é o que dá autoridade à regra |
| a contagem de commits | falha o teste 2: o commit que grava "36" faz a contagem virar 37, e o CI, que roda **depois** do commit, ficaria vermelho para sempre. Fato que muda por ser registrado é portão que nunca fecha |
| "13 de 13 na própria régua" | falha o teste 3: sai de **rodar** o `rebar-check`, e quem já o trava é o passo `auto`. Derivá-lo aqui duplicaria o passo mais caro do portão dentro do mais barato |
| tamanhos em bytes, contagens de linha de `docs/`, cronometragens | medição de conveniência, remedida quando alguém mexe na seção. Cada uma leva a data da medição |

Para esses vale a regra antiga, sem mudança: **o comando que reproduz vem junto**, e onde
uma afirmação veio de relato e não de execução ela está marcada como **não medido**.

---

## 1. O objetivo final

`rebar` é o **alicerce v2**. Repositório novo, não construído sobre o alicerce atual.

A dor que ele existe para resolver, nas palavras do dono:

> _"Todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador,
> esquecendo do shadcn."_

O diagnóstico já estava escrito pelo próprio alicerce: **"decisão que mora onde nenhuma
máquina lê"**.

### Os seis objetivos

1. **Fazer código errado não passar.** Erro que **barra**, não que vira aviso ignorado.
2. **`npm create rebar`** — projeto que nasce com a stack certa e o portão fechado.
3. **Continuar impondo depois do dia 1** — o gerador não sai de cena; fica como MCP e portão.
4. **Descer as regras de nível** — o que é pedido em prosa e caberia num lint, vira lint.
5. **Manter o MCP vivo** — regra mudou, MCP se regenera, e o portão reprova se estiver velho.
6. **Navegável por agente novo** sem ler tudo.

O **nº 5 fechou em 01/09/2026** (§4.12): o MCP virou artefato gerado, e o passo `mcp` do
portão regenera em memória e reprova se o disco divergir. Com ele, o **nº 3 ganhou a
segunda metade** — o portão já ia no projeto gerado, o MCP passou a ir junto por ponteiro.

---

## 2. Os três princípios

Saíram das rodadas de revisão com o revisor externo — `ls docs/RESPOSTA-REVISAO*.md | wc -l`
devolve **8**. Os dois últimos princípios nasceram de **erros cometidos no próprio
documento**, não de teoria.

**1 · Descer de nível, com uma condição.**

> Se uma regra pode descer de prosa para enforcement, ela deve descer — **mas o
> enforcement precisa ser mais confiável do que a regra que substitui.**

**2 · Nada importante mora só em texto.**

> Qualquer regra importante demais para a IA esquecer é importante demais para existir
> apenas como texto.

**3 · Proveniência é de camada, não de fonte.**

> Afirmação verificável precisa de fonte primária **da camada responsável pela propriedade
> afirmada.** Não pule camada.

| Propriedade                       | Dono          |
| --------------------------------- | ------------- |
| MVCC, `SKIP LOCKED`, `RESET ROLE` | PostgreSQL    |
| Sync por query, `onConnect`       | node-postgres |
| Serialização, mapa de status      | oRPC          |
| SQL gerado                        | Kysely        |

Formato obrigatório de citação em ADR: **`Claim` · `Owner` · `Evidence` · `Assumptions`**,
e cada linha de `Assumptions` vira asserção no fitness test.

---

## 3. Decisões travadas

| Decisão            | Escolha                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Natureza           | Gera **e** fica vigiando                                                                      |
| Alvo               | Presets `site` / `app` / `api`                                                                |
| Dureza             | Bloqueia commit **e** CI                                                                      |
| Banco              | **Postgres.** SQL Server exige licença, e não há migração — o backend do herz nunca existiu   |
| Contrato           | **oRPC 1.15.0**, não ts-rest (ADR 0011 do prumo supersedeu)                                   |
| Componentes        | **shadcn sobre `@base-ui/react`**, style `base-nova`. **Não é Radix**                         |
| Interface          | Aproveitar a do herz — animação por `tw-animate-css` + data-attributes, sem `@keyframes`      |
| Linter             | oxlint rápido + ESLint pequeno para regras próprias                                           |
| Ordem              | **Consumidor antes do gerador** — checar o que existe antes de gerar o próximo                |
| Postura do checker | **Só reporta.** Nunca escreve em repositório nenhum                                           |

### As três decisões travadas em 30/08

**Prettier é a única dependência do repositório.** São
<!--n pacote.dependencias-->0<!--/n--> dependências de runtime e, em desenvolvimento, só <!--n pacote.dev-dependencias-->`prettier` 3.9.6<!--/n-->.

```bash
cat package.json    # o campo dependencies não existe; devDependencies tem uma entrada
```

A fronteira é deliberada: `ferramental/rebar-check/index.mjs` continua importando só
built-ins, então `npx github:Navesz/rebar` roda sem instalar nada. Zero dependência é
propriedade do que **confere**, não do que se confere.

As duas alternativas foram descartadas com motivo: aceitar o 90% deixaria o `verificar`
vermelho para sempre, e portão que nunca fica verde é portão que se aprende a ignorar;
estreitar a regra para dispensar repositório sem dependência seria abrir exceção para si
mesmo na única régua que o projeto entrega.

**Coautoria de IA vira allowlist de humanos, não enumeração de agentes.**

```bash
git ls-files .rebar-coautores              # rastreado — se não estiver, o checker o ignora
grep -vE '^\s*#|^\s*$' .rebar-coautores    # 1 identidade humana; o resto é comentário
```

A política era uma lista de 9 agentes de IA, e o ataque de 30/08 furou os dois lugares
onde ela morava (§10, linhas 10 e 11). Agora o arquivo é `.rebar-coautores`, na raiz, com
identidades **humanas** aceitas; qualquer trailer `Co-authored-by:` fora da lista reprova.
Fica na raiz e não em `ferramental/` porque o `rebar-check` roda contra repositório de
terceiro, e terceiro não tem `ferramental/`. Mesma família do `.rebarignore`.

**O repositório é público, em `https://github.com/Navesz/rebar`.** Criado, empurrado e
gateado — **não mais vazio, como este arquivo dizia até 02/09/2026.**

```bash
git remote -v         # origin  https://github.com/Navesz/rebar.git
git ls-remote origin  # exit 0
```

Medido em 02/09/2026: `git ls-remote origin` devolve **15 refs** — `HEAD`, `refs/heads/main`
e 13 `refs/pull/*/head`. A `main` aponta para o mesmo commit que o `HEAD` local. Este é um
número de **rede**, não desta árvore, e por isso fica à mão com a data: ele muda quando
alguém abre um PR, sem que uma linha deste repositório mude.

---

## 4. O que está FEITO

Dividido em **PROVADO** — tem teste que roda, e que rodei agora — e **EXISTE** — está no
disco, e ninguém o exercita.

### 4.1 PROVADO · Domínio de privilégio de banco

A suíte tem <!--n dominio.privilegio.testes-->16<!--/n--> asserções, e em 30/08/2026 as <!--n dominio.privilegio.testes-->16<!--/n--> passaram, `fail 0`, exit 0. O `duration_ms`
varia a cada execução; o que vale é o par contagem/exit.

```bash
cd dominios/privilegio-de-banco && npm test
```

Contra PostgreSQL 17.2 **real**, não mock. Três identidades: `db_owner` (migrations) ·
`app` (NOLOGIN, DML) · `app_login` (LOGIN, **NOINHERIT**, zero privilégio de aplicação).

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;   -- PG 16+
```

`INHERIT FALSE` é a peça: `RESET ROLE` cai em `app_login` sem nada → **falha fechado**.

**Achado que só o código encontrou** — nem a revisão humana nem seis agentes pegaram:

> `onConnect` é barreira por conexão **FÍSICA**, não por checkout.

```
checkout          current_user = app
RESET ROLE        current_user = app_login
release → pool
próximo checkout  current_user = app_login   ← onConnect não rodou de novo
```

Aqui falha fechado. Num desenho com `session_user` privilegiado — **o estado atual do
prumo** — falharia **aberto**.

**Conserto medido:** `SET LOCAL ROLE app` como primeira instrução da transação, no
`UnitOfWork`. Dois dos <!--n dominio.privilegio.testes-->16<!--/n--> testes são exatamente
esse par, e saíram verdes nesta medição:

```
✔ ACHADO · onConnect é barreira por conexão FÍSICA — RESET ROLE sobrevive ao release
✔ CONSERTO · SET LOCAL ROLE no UnitOfWork cura a conexão envenenada e reverte sozinho
```

Um terceiro documenta a fronteira que continua aberta:

```
✔ RLS · ACHADO CONHECIDO: o GUC de tenant é USERSET — app troca o próprio contexto
```

### 4.2 PROVADO · `rebar-check` — <!--n regras.total-->22<!--/n--> checagens, zero dependência

_Remedido em 31/08/2026 · números derivados desde 02/09/2026._
`ferramental/rebar-check/index.mjs`, <!--n linhas.rebar-check-->2.350<!--/n--> linhas.
Roda em qualquer repositório, **nunca escreve**.

São <!--n regras.deterministicas-->17<!--/n--> determinísticas e <!--n regras.heuristicas-->5<!--/n--> heurísticas, e as duas listas saem do array `REGRAS`
exportado pelo próprio `index.mjs` — a mesma fonte de que o MCP deriva.

**Não conte por `grep`.** Este arquivo já publicou "16 determinísticas" por causa disso: o
grep de `classe: 'determinística'` devolve <!--n regras.deterministicas-->17<!--/n--> + 1
hoje, porque casa também o comentário que explica a distinção. A contagem que vale é a do
array, e ela é a que o marcador acima carrega:

```bash
node ferramental/numeros.mjs --fatos                                        # o catálogo
node ferramental/rebar-check/index.mjs --json . | grep -c '"classe": "determinística"'
node ferramental/rebar-check/index.mjs --json . | grep -c '"classe": "heurística"'
```

Determinísticas, e derrubam o exit code:
<!--n regras.lista-deterministicas-->`editorconfig` · `dependabot` · `ci` · `ci-gateia` · `testes` · `typecheck` · `formatter` · `env-example` · `licenca` · `readme` · `notice` · `hooks-executaveis` · `coautoria-ia` · `identidade-git` · `ui-falso` · `schema-orfao` · `telefone`<!--/n-->

Heurísticas, e só informam:
<!--n regras.lista-heuristicas-->`conteudo-fora-do-codigo` · `shadcn-completo` · `url-producao` · `hex-cru` · `idioma-unico`<!--/n-->

A versão anterior desta seção trocava as duas listas de lugar num ponto: dava
`conteudo-fora-do-codigo` como determinística, quando ela é heurística, e omitia
`hooks-executaveis` inteira. As duas listas acima passaram a ser derivadas justamente
porque errar a **composição** é mais silencioso do que errar o total.

`telefone` subiu de heurística a determinística em 2026-08-30, com o número que a promoveu
escrito na própria regra: 1 verdadeiro e 0 falsos em 417 arquivos de código medidos.
`url-producao` NÃO subiu, e o porquê também está lá — 6 acusações verdadeiras, das quais só
2 são o defeito que o nome da regra promete.

A separação é medida, e o motivo está escrito no cabeçalho da seção `as regras` do
`index.mjs` — `grep -n "SETE ocorrências"`: a regra de cor literal ingênua deu 7
ocorrências e zero verdadeiros positivos no herz, medidos em 30/08/2026, e cinco eram
comentários documentando a própria regra.

**O rebar na própria régua.** Medido em **02/09/2026**, já com `novo/` rastreado:

```bash
node ferramental/rebar-check/index.mjs .     # é o passo `auto` do verificar
```

| | |
| --- | --- |
| nota | **13 de 13** · 4 não se aplica · exit 0 |
| casos de prova fora da avaliação | 261 arquivos |
| modelo do gerador fora da avaliação | 22 arquivos · `novo/portao/arquivos/`, `novo/site/blocos/` |
| código fora das regras de conteúdo por ser teste | 3 arquivos |

**Este par de números fica à mão de propósito, com a data acima.** Ele sai de RODAR a
régua, não de ler a fonte, e quem já o trava é o passo `auto` do `verificar` — derivá-lo em
`numeros.mjs` criaria a segunda fonte que a §7.2 do plano proíbe e duplicaria o passo mais
caro do portão dentro do mais barato. Ver §0.

Os 4 que não se aplicam: `ci-gateia` (o `package.json` não tem script de lint, typecheck
nem test), `typecheck` (não tem TypeScript), `ui-falso` (não tem `components/ui/`) e
`schema-orfao` (nenhum `.schema.json`).

**A nota conta só as determinísticas.** `13 de 13` é sobre as
<!--n regras.deterministicas-->17<!--/n--> determinísticas menos as 4 que não se aplicam.
As <!--n regras.heuristicas-->5<!--/n--> heurísticas ficam fora do denominador e aparecem
como aviso.

**O que mudou desde 31/08, e a previsão que se confirmou.** Naquela data `novo/` ainda não
estava rastreado, a régua lia `git ls-files` e não enxergava uma linha do gerador: a nota
era **11 de 11 · 5 n/a**, com 227 arquivos de caso fora da avaliação. Para prever o efeito
de rastreá-lo sem tocar no `.git`, foi montado um espelho da árvore num `os.tmpdir()`, com
`git init` próprio e tudo commitado, e ele deu **12 de 12 · 4 n/a**, com 318 arquivos
rastreados e 24 em `novo/`. Hoje o espelho não é mais necessário — a árvore real tem 340 *(medido em 02/09; não é derivado — muda pelo próprio commit que o registra)* arquivos rastreados, dos quais <!--n novo.arquivos-->26<!--/n--> em `novo/`, e a nota subiu mais um ponto com a regra
`hooks-executaveis`, que entrou depois.

`env-example` saiu do N/A e passou a **PASSAR**: o gerador lê `GIT_AUTHOR_NAME` e
`GIT_AUTHOR_EMAIL` como segunda fonte da identidade do dono, e as duas estão documentadas
no `.env.example`. A régua ficou mais exercida, não menos.

**O que o gerador quebrou no caminho, e o conserto.** Na primeira medição do espelho, em
31/08/2026, o resultado era **11 de 13, exit 1** — os três números desta tabela são daquele
dia e descrevem um estado que não existe mais:

| regra | sem o conserto | por quê |
| --- | --- | --- |
| `typecheck` | ✗ nenhum `package.json` rastreado tem script typecheck | os `.tsx`/`.ts` de `novo/site/blocos/` |
| `env-example` | ✗ não documentadas: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `novo/index.mjs` |
| `idioma-unico` | ⚠ comentários em pt (21) e en (3) | 3 comentários em português citando `User-Agent`, `<input type="file">`, `cat-file --batch` |

É o **"material de prova não é produto"** de volta, um andar acima: `novo/site/blocos/` e
`novo/portao/arquivos/` são arquivos que o gerador **copia** para dentro do projeto criado.
Não são compilados aqui, não têm `tsconfig` aqui. A saída é a mesma que já existia para os
casos de prova, com a mesma disciplina: fechadura dupla e contagem impressa.

- **Fechadura 1** — o prefixo tem de ser **exatamente** uma das raízes literais
  (`RAIZES_DE_MODELO`), não "começa com", não "qualquer pasta chamada blocos".
- **Fechadura 2** — tem de existir um `modelo.json` rastreado, com `para` e `porque`.
- **Contagem impressa** — a linha `N arquivo(s) de modelo do gerador, fora da avaliação`
  sai sempre, nomeando as raízes; hoje o `N` é
  <!--n novo.arquivos-modelo-->22<!--/n-->. Exclusão que não se vê é exclusão que ninguém
  confere.

Nada foi afrouxado: o `env-example` virou documentação de verdade, e os modelos continuam
sendo checados **onde caem** — o passo 5 do gerador roda esta mesma régua dentro do projeto
gerado, com `tsconfig.json` e `package.json` do Next em volta. Os dois casos de prova novos
travam as duas fechaduras (§4.3).

O `idioma-unico` era falso positivo da própria heurística: ela testava o idioma em cima do
texto do comentário **inteiro**, crases e tudo, então um comentário em português que cita
um identificador em inglês contava como comentário em inglês. Passou a descartar o trecho
entre crases antes do teste. Medido no espelho: `en` de **3 para 0**, e os três eram
`index.mjs`, `varrer-segredo.mjs` e `novo/index.mjs`, todos com prosa em português. O caso
de prova `idioma-unico` não tem uma crase e não muda por causa disto.

### 4.3 PROVADO · As provas — <!--n provas.casos-->52<!--/n--> casos, <!--n provas.cobertura-->22 de 22<!--/n--> regras

_Remedido em 31/08/2026 · números derivados desde 02/09/2026._

São <!--n provas.casos-->52<!--/n--> casos e <!--n provas.regras-com-prova-->22<!--/n--> regras com prova — cobertura <!--n provas.cobertura-->22 de 22<!--/n-->, sem regra descoberta. O runner conta as pastas
de `ferramental/rebar-check/provas/casos/`, que é exatamente o que o medidor de números lê:

```bash
npm run provar
ls ferramental/rebar-check/provas/casos | wc -l
```

**Este arquivo carregava QUATRO contagens diferentes de casos — 13, 33, 47 e 50 — em
seções diferentes do mesmo texto.** Todas as quatro sumiram: o número agora é um só,
derivado, e o passo `numeros` reprova se ele envelhecer. É o caso que justificou a §0.

Dos <!--n provas.casos-->52<!--/n-->, **dois são de 31/08 e travam a exclusão de modelo**
descrita na §4.2. Rodando só a regra `typecheck`, em 02/09/2026, saíram 5 de 5:

```bash
node ferramental/rebar-check/provas/provar.mjs typecheck
# ✓ typecheck · ✓ typecheck__modelo-do-gerador · ✓ typecheck__modelo-fora-da-raiz
# ✓ typecheck__nao-se-aplica · ✓ typecheck__nome-em-portugues
```

`__modelo-do-gerador` prova o mecanismo: a mesma árvore com e sem o `modelo.json` na raiz.
`__modelo-fora-da-raiz` prova a **fechadura**: o mesmo marcador um nível abaixo,
em `novo/site/blocos/app/`, tem de ser recusado e a árvore continuar avaliada. Sem esse
segundo caso, transformar a exclusão num bypass genérico passaria despercebido.

O caminho é `ferramental/rebar-check/provas/casos/`, **não** `provas/casos/` na raiz.

Toda regra tem caso, determinística e heurística. A caça a falso positivo de 2026-08-30
acrescentou 13 casos e não sobrou buraco: `telefone`, `url-producao`, `idioma-unico` e a
regra nova `conteudo-fora-do-codigo` eram os quatro que faltavam.

**O formato das provas mudou, e a mudança é o conserto de um furo.** O runner lê agora o
`estado` que a regra emite no `--json`, e não o exit code. O motivo está em
o comentário `O ESTADO que cada lado tem de produzir` em `provas/provar.mjs`: o `index.mjs` colapsa `passou` e `na` no
mesmo exit 0, então nenhum ramo "não se aplica" podia ser travado. É por isso que existem
casos com sufixo `__nao-se-aplica`. O mesmo comentário registra que `quebrou` nunca pode
ser esperado — crash é defeito do instrumento, não resultado dele.

### 4.4 PROVADO · `verificar` — <!--n verificar.passos-->13<!--/n--> passos

_Remedido em 02/09/2026. Este arquivo dizia "8 de 8" e o README dizia "os 8 passos"; eram
12 quando a contagem foi refeita, e são <!--n verificar.passos-->13<!--/n--> agora. A
contagem passou a ser derivada do `default export` de `verificar.config.mjs`._

Na ordem em que rodam:
<!--n verificar.lista-passos-->`higiene` · `hooks` · `sintaxe` · `blocos` · `mcp-servidor` · `mcp` · `numeros` · `formato` · `elos` · `segredo` · `passos` · `provas` · `auto`<!--/n-->

```bash
npm run verificar
```

Em 02/09/2026: **APROVADO <!--n verificar.passos-->13<!--/n--> de <!--n verificar.passos-->13<!--/n--> passos · 22,3 s · exit 0.** A duração varia de máquina
e de cache — em 31/08/2026, com 50 casos de prova e 8 passos, duas execuções deram **13,5
s** e **15,7 s**, contra **51,9 s com 47 casos** em 30/08. A causa provável é a
paralelização das fixtures no passo `provas`, mas **o passo isolado nunca foi
cronometrado**; o que se mede é o total. Cronometragem é medição de máquina e fica à mão,
com a data — ver §0.

**Os cinco passos que entraram depois de 31/08**, e o que cada um cobre:

| Passo | Posição | O que ele barra |
| --- | --- | --- |
| `blocos` | <!--n verificar.posicao.blocos-->4 de 13<!--/n--> | sintaxe e `modelo.json` dos arquivos que o gerador copia para dentro de todo projeto criado — defeito aqui nasce replicado em todos eles |
| `mcp-servidor` | <!--n verificar.posicao.mcp-servidor-->5 de 13<!--/n--> | o servidor MCP **sobe e responde ao protocolo**. Sem `mcp/node_modules` o passo QUEBRA (127), não reprova: ferramental faltando não é o repositório errando |
| `mcp` | <!--n verificar.posicao.mcp-->6 de 13<!--/n--> | o artefato do MCP divergir da fonte — §4.12 |
| `numeros` | <!--n verificar.posicao.numeros-->7 de 13<!--/n--> | um número deste arquivo ou do README divergir da fonte — §0 |
| `passos` | <!--n verificar.posicao.passos-->11 de 13<!--/n--> | os passos que são **função** do portão, provados por mutação. `checarBlocos` entrou com 410 linhas e zero teste, e trocar o corpo por `return { codigo: 0 }` mantinha o `verificar` APROVADO |

Os dois primeiros passos conferem o **portão**, não o conteúdo: `higiene` (árvore limpa,
índice sem `skip-worktree`, hash dos arquivos do portão contra o HEAD) e `hooks`
(`core.hooksPath` aponta para o lugar certo e os dois hooks estão lá).

**Nenhum passo é opcional** — o campo não existe, e `verificar.mjs` recusa a chave com exit
2; `--passo=` imprime PARCIAL e sai 3, nunca 0. As duas portas destrancadas do original do
alicerce ficaram de fora de propósito. Onde há afrouxamento ele é **dentro** do passo, e
está dito:

- `higiene` **só avisa** com a árvore suja fora do CI; dentro do CI reprova. Divergência de
  hash que não aparece no `git status` reprova sempre — é a assinatura do `skip-worktree`.
  Avisou nesta medição: `⚠ árvore com 4 alteração(ões) não commitada(s)`.
- `hooks` — `core.hooksPath` **só avisa** dentro do CI, porque o runner não commita.
- `numeros` — grupo de fato que a árvore não sabe derivar **só avisa**, nomeando o que
  faltou.
- `auto` — heurística **não entra no denominador**, sai como aviso.

Os avisos não somem por serem avisos: o campo `avisar` de cada passo os imprime **mesmo
quando o passo passa**, em seção própria abaixo do placar.

### 4.5 PROVADO · Hooks — instalados e ativos

```bash
git config --get core.hooksPath  # ferramental/hooks
git ls-files ferramental/hooks   # checar-mensagem.mjs · commit-msg · instalar.mjs · pre-commit
```

`pre-commit` varre segredo no índice e checa coautoria. `commit-msg` é novo e não existia
no alicerce: o `rebar-check` lê `git log` e não enxerga o commit em curso, então ele
impedia o trailer de **ficar**, não de **entrar**.

Isto era, até esta sessão, o "próximo passo" deste documento. Já foi feito.

### 4.6 PROVADO · Os três portes do alicerce

| Porte                        | Prova de que roda                                        |
| ---------------------------- | -------------------------------------------------------- |
| `segredo/varrer-segredo.mjs` | passo `segredo` do `npm run verificar`, e o `pre-commit`  |
| `elos/verificar-elos.mjs`    | execução direta, abaixo                                   |
| `hooks/`                     | `git config --get core.hooksPath` → `ferramental/hooks`   |

```bash
node ferramental/elos/verificar-elos.mjs
```

Em 02/09/2026: **56 arquivos, nenhum link relativo quebrado, exit 0** — eram 45 em 30/08.
A contagem é do varredor e não está no catálogo derivado; fica à mão, com a data.

O `varrer-segredo.mjs` recebeu sete consertos documentados no próprio cabeçalho; os dois
mais caros estão na §10, linhas 8 e 9.

### 4.7 EXISTE, e ninguém exercita

| Item                              | Estado                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `rebar-backup-20260825/`          | Existe, e **não é repositório git** — é cópia solta de arquivos, sem `.git`                       |

```bash
ls -d ../rebar-backup-20260825/.git      # No such file or directory
```

**Saiu desta lista em 02/09/2026:** `.github/workflows/verificar.yml`. Ele **executou** — o
remoto deixou de estar vazio, a matriz `windows-latest` + `ubuntu-latest` ficou verde e o
merge foi barrado com PR plantado (§9, D+30). O tamanho que este arquivo publicava, 2.163
bytes, também estava velho: em 02/09/2026 são **2.506**. Tamanho em bytes é medição de
conveniência e fica à mão com a data — ver §0.

### 4.8 O placar — 19 repositórios da máquina

_**Medição histórica de 30/08/2026**, e não foi refeita desde então. Nenhum número desta
seção é derivável: eles são propriedade de **outras** árvores, na máquina do dono, e o
medidor de números não sai deste repositório (§0). Se forem remedidos, a data acima muda
junto — e não subtraia um número novo de um velho, pela ressalva do fim da seção._

São **19** repositórios git, não 12. O ESTADO anterior deixou 7 de fora.

```bash
# A PARTIR DE Documents/, nao da raiz do rebar — onde o mesmo comando devolve 1.
# Todo comando deste documento roda da raiz do rebar, MENOS estes dois.
cd /c/Users/leona/OneDrive/Documents
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sort | wc -l    # 19
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sed "s|/[.]git$||" \n  | xargs node rebar/ferramental/rebar-check/index.mjs --json
```

O `--json` aceita vários diretórios de uma vez e devolve um array. A coluna `Nota` é o
campo `nota` que a própria ferramenta emite, repo a repo, e o denominador é o número de
regras **determinísticas aplicáveis** naquele repositório.

| Repo                               | Nota     | Aplicáveis | N/A | Avisos |
| ---------------------------------- | -------- | ---------- | --- | ------ |
| **rebar (ele mesmo)**              | **100%** | 10/10      | 4   | 0      |
| prumo                              | 85%      | 11/13      | 1   | 2      |
| ducado                             | 73%      | 8/11       | 3   | 1      |
| Xthird/tools/obsidian-second-brain | 67%      | 4/6        | 8   | 0      |
| openkartline                       | 62%      | 8/13       | 1   | 2      |
| vectra-painel                      | 50%      | 5/10       | 4   | 0      |
| decima-edicoes                     | 42%      | 5/12       | 2   | 2      |
| LinhaK                             | 36%      | 4/11       | 3   | 0      |
| openkartline-notes                 | 33%      | 2/6        | 8   | 0      |
| VectraB-Lab                        | 33%      | 2/6        | 8   | 0      |
| Xthird/sites/constellation         | 33%      | 4/12       | 2   | 1      |
| Galegos                            | 27%      | 3/11       | 3   | 3      |
| alicerce                           | 20%      | 2/10       | 4   | 0      |
| navesz.github.io                   | 20%      | 2/10       | 4   | 2      |
| Pedro/hug-brasil-propostas         | 17%      | 2/12       | 2   | 2      |
| Xthird/sites/navesz-profile        | 17%      | 1/6        | 8   | 0      |
| Readme                             | 13%      | 1/8        | 6   | 2      |
| Xthird/sites/elssom-climatic       | **0%**   | 0/6        | 8   | 1      |
| Pedro                              | **0%**   | 0/4        | 10  | 0      |

**Agregado: 74 de 177 checagens aplicáveis passam — 41,8%.** N/A somados: 89. Avisos
somados: 18.

A conta fecha com a tabela: somando a coluna `Aplicáveis` dá 74 no numerador e 177 no
denominador; 74 ÷ 177 = 0,4180. **Esta soma foi conferida somando a coluna**, que é
exatamente a verificação que faltava na versão anterior — onde a tabela dava 56 e o texto
ao lado dizia 55.

**Mediana: 33%.** Os 19 valores ordenados são
`0, 0, 13, 17, 17, 20, 20, 27, 33, 33, 33, 36, 42, 50, 62, 67, 73, 85, 100`; o décimo é 33.

**Teto: 100%, o rebar, e ele é o único.** Fora da própria ferramenta o teto é **85% no
prumo** — não 69%, como este arquivo publicava.

**Piso: 0%, empate entre `Pedro` e `Xthird/sites/elssom-climatic`.** Os dois estavam fora
da lista antiga, e por isso o piso publicado (17%, `hug-brasil-propostas`) estava errado.
Ressalva honesta: o `Pedro` tem 0 commits, então o 0% dele mede uma pasta praticamente
vazia — é o piso aritmético. O pior repositório de verdade é o `elssom-climatic`, que tem
5 commits e mesmo assim não passa em nenhuma das 6 checagens aplicáveis.

**CI que alcança a verificação que o próprio repositório declara: quatro.** `prumo`,
`openkartline`, `decima-edicoes` e `Xthird/sites/constellation`. O `constellation` ficava
de fora porque só se olhava 12 repositórios.

```bash
# do mesmo --json, campo `estado` da regra ci-gateia, repo a repo:
# passou 4 · reprovou 1 (ducado, "o CI não alcança: lint") · na 14
```

Os 14 `na` se separam em dois motivos: **oito não têm CI nenhum** (`Galegos`, `LinhaK`,
`Pedro`, `Pedro/hug-brasil-propostas`, `VectraB-Lab`, `Xthird/sites/elssom-climatic`,
`openkartline-notes`, `vectra-painel`) e **seis têm CI e não têm script de lint, typecheck
ou teste para ele alcançar** (`rebar`, `Readme`, `alicerce`, `navesz.github.io`,
`Xthird/sites/navesz-profile`, `Xthird/tools/obsidian-second-brain`). O próprio rebar está
no segundo grupo. 4 + 1 + 8 + 6 = 19.

> ⚠️ **A régua foi recalibrada em 30/08 e número velho não é comparável com número novo.**
> A tabela anterior saía de uma régua em que `null` queria dizer duas coisas ao mesmo
> tempo — "passou" e "não havia o que checar". Consequência medida, e registrada em
> o comentário do helper `na()` no `index.mjs`: uma pasta vazia com um `.git/` vazio tirava 8
> de 14 e empatava com o rebar. O nada não conforma. Três consertos entraram juntos: o N/A
> saiu do **denominador** (por isso a nota é percentual e o denominador varia por
> repositório), o crash do git virou erro explícito em vez de aprovação silenciosa, e a
> classe de falso positivo descrita no fim da §10 caiu. **Não subtraia um número do outro.**

### 4.9 Tamanho do repositório

| Medida                                                           | Valor                                                        | Origem |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | --- |
| Arquivos rastreados                                              | 340 *(medido em 02/09; não é derivado — muda pelo próprio commit que o registra)*                  | derivado |
| Arquivos rastreados, fora os casos de prova                      | 79 *(medido em 02/09)*               | derivado |
| Commits com trailer `Co-Authored-By`                             | <!--n git.commits-com-coautoria-->0<!--/n-->                  | derivado |
| Primeiro commit                                                  | <!--n git.primeiro-commit-->2026-08-25 23:35:43<!--/n-->      | derivado |
| Linhas de código não vazias (.mjs .cjs .js .ts .json .yml .yaml) | 14.727                                                        | medido em 02/09/2026 |
| Linhas de prosa não vazias (.md .txt)                            | 3.997                                                         | medido em 02/09/2026 |
| Razão prosa/código                                               | 0,27 — ou 3,68 linhas de código por linha de prosa            | medido em 02/09/2026 |
| Commits                                                          | 36                                                            | medido em 02/09/2026 · **não derivável**, ver abaixo |

```bash
git ls-files | grep -v '^ferramental/rebar-check/provas/casos/' \
  | grep -E '\.(mjs|cjs|js|ts|json|yml|yaml)$' | xargs grep -chv '^[[:space:]]*$' \
  | awk '{s+=$1}END{print s}'
# a mesma linha com  \.(md|txt)$  no lugar da lista de extensões
git rev-list --all --count
git log --all --format='%B' | grep -icE 'Co-Authored-By:'
```

**A contagem de commits é o caso que define a fronteira do que pode ser derivado**, e ela
falha o teste 2 da §0: se este documento gravasse `36` automaticamente, o commit que grava
`36` faria a contagem virar `37`, e o CI — que roda **depois** do commit — ficaria vermelho
para sempre. Fato que muda pelo próprio ato de ser registrado é portão que nunca fecha.
Fica à mão, com a data. No lugar dele entraram dois números que só mudam quando alguém mexe
no repositório: **arquivos rastreados** (o índice já reflete o `git add` antes do commit) e
**commits com trailer de coautoria**, que a allowlist mantém em zero e que só sai de zero
quando o invariante for violado — aí ficar vermelho é o certo.

O zero é mais forte do que a política exige: não há trailer `Co-Authored-By` nenhum no
histórico, nem de IA nem de humano.

**A contagem de prosa inclui este arquivo**, então ela muda a cada edição do ESTADO. Os
valores medidos acima são da versão que você está lendo já no disco — e é por isso que eles
carregam a data em vez de fingirem estar sempre em dia. Os números anteriores, de 30/08
(44 arquivos, 5.957 linhas de código, 3.071 de prosa, 13 commits), ficam aqui como
referência de quanto o repositório cresceu em uma semana.

### 4.10 Documentos

_Contagens medidas em **02/09/2026**. Linha de documento não está no catálogo derivado — é
medição de conveniência, remedida quando alguém mexe nesta seção (§0)._

```bash
wc -l docs/*.md
```

| Arquivo                     | Linhas                     | O quê                                                        |
| --------------------------- | -------------------------- | ------------------------------------------------------------ |
| `docs/PLANO.md`             | 1.115 (eram 912 em 30/08)  | Painel de decisões, forense dos seis sites, taxonomia N0–N7   |
| `docs/STACK.md`             | 899                        | v1.2, com histórico de 0.1 a 1.2 (não "~780 linhas")          |
| `docs/REVISAO-AGENTES.md`   | 528                        | Revisão por 6 agentes                                         |
| `docs/RESPOSTA-REVISAO*.md` | 1.235 no total, 8 arquivos | As 8 rodadas com o revisor externo                            |

**Uma referência de seção interna continua quebrada:** `docs/PLANO.md:1095` aponta para
`§2.3`, e a série 2.x do documento vai de `2.1` direto para o `§3`. (A linha era a 892 em
30/08; o alvo não mudou, o número da linha sim — mais uma razão para citar por conteúdo e
não por posição.)

```bash
grep -n '§2\.3' docs/PLANO.md
grep -nE '^#+ (2|3)(\.[0-9]+)*[ .]' docs/PLANO.md
# 74:# 2. Contexto · 85:## 2.1 Decisões travadas · 101:# 3. … — não há 2.2 nem 2.3
```

Pelo assunto — o preset `site` ser o pior servido — o alvo pretendido era provavelmente a
`§3.3 O ponto cego do alicerce é onde os projetos do dono vivem`. **Não corrigi: a tarefa
desta sessão é só o ESTADO.md.** As outras ocorrências de `§N.N` que um grep cru levanta
foram conferidas e não são quebra: a `§12.9` já virou auto-documentação, os `§44/68/86` da
REVISAO-AGENTES são ponteiro para linha e não para seção, e as `§9.27.2`/`§13.3.2` são
citação da documentação do PostgreSQL.

### 4.11 PROVADO · O gerador — `rebar novo`, rodado de ponta a ponta

_As duas execuções de ponta a ponta são de **31/08/2026**, com rede, em `os.tmpdir()`, e
não foram refeitas: tudo que este bloco relata sobre elas é histórico. As contagens de
arquivo abaixo, essas sim, são derivadas e estão em dia._

O gerador anuncia <!--n novo.passos-->6<!--/n--> passos e `novo/` tem <!--n novo.arquivos-->26<!--/n--> arquivos, dos quais <!--n novo.arquivos-modelo-->22<!--/n--> são **modelo** — o que ele copia para dentro do
projeto criado, e que por isso não é avaliado aqui. Sobram 4 de código próprio:
`novo/index.mjs` (433 linhas) · `novo/portao/aplicar.mjs` (829) · `novo/site/aplicar.mjs`
(239) · `novo/site/og.mjs` (227), 1.728 no total — contagem de linha medida em 02/09/2026,
à mão (§0); eram 405/391/135/227 em 31/08.

```bash
wc -l novo/index.mjs novo/portao/aplicar.mjs novo/site/aplicar.mjs novo/site/og.mjs
find novo -type f | wc -l
```

#### Como o `npx` chega no gerador

O `bin` do `package.json` tinha um só comando e o checker não conhecia subcomando: `npx
github:Navesz/rebar novo meu-site` tratava `novo` como caminho a auditar e saía **2**.
A correção é despacho dentro do `index.mjs`, e não um segundo `bin`, porque é assim que o
npx resolve: ele executa o bin com o **nome do pacote** e entrega `novo` como `argv[0]`.
O `bin` extra (`rebar-novo`) existe como forma inequívoca, mas só é alcançável por
`npx -p github:Navesz/rebar rebar-novo …`, que ninguém digita.

O despacho vem **antes** do parse de opções (senão a linha de comando do gerador viraria
"opção desconhecida") e o `import` é **dinâmico** (senão o caminho quente, `npx
github:Navesz/rebar .` em CI, pagaria por o gerador existir).

Provado nos dois caminhos. O `github:` de verdade, contra o remoto público:

```bash
cd $(mktemp -d) && git init -q && git add -A && git commit -q -m t
npx -y github:Navesz/rebar .     # placar impresso · exit 1 (repo vazio, é o esperado)
```

E o caminho do gerador, contra um clone git local da árvore desta sessão — mesmo
instalador, mesma resolução de `bin`, sem depender de eu ter feito push:

```bash
npx -y "git+file:///$ESPELHO" .                              # o checker, exit 1
npx -y "git+file:///$ESPELHO" novo padaria-do-ze padaria-do-ze.com.br
# rebar: subcomando "novo" → gerador (para auditar a pasta "novo", use ./novo)
```

`npm pack` **não** serve como prova aqui: ele recusa este pacote com "Invalid package, must
have name and version", porque o `package.json` não tem `version`. O instalador de git do
npm não exige `version` — foi por isso que o `npx github:` sempre funcionou apesar disso.

#### Execução 1 — `padaria-do-ze`, sem identidade de git na máquina

```
▸ 2/6  scaffold pelo shadcn (Next 16 · base-nova · @base-ui/react)
  npx resolvido: C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js
▸ 3/6  preset site: 13 arquivo(s) · domínio padaria-do-ze.com.br  + 17 do portão
▸ 4/6  modo 100755 … .githooks/commit-msg · .githooks/pre-commit
       Hooks instalados: core.hooksPath = .githooks
       primeiro commit: NÃO FEITO
▸ 5/6  12 de 12 · 4 não se aplica
  AVISOS: git sem user.email nesta máquina — o primeiro commit NÃO foi feito.
  régua: exit 0 — passou      gerador: exit 1
```

**Não é defeito do gerador, é a máquina** — e é a checagem funcionando:

```bash
git config --global -l
# fatal: unable to read config file 'C:/Users/leona/.gitconfig': No such file or directory
```

Esta máquina não tem `.gitconfig` global; a identidade do rebar mora no `.git/config` do
próprio repositório. O gerador **se recusa a inventar um autor**: avisa, não commita, e sai
1 mesmo com a régua verde. `coautoria-ia` e `identidade-git` viram N/A por não haver
commit, e a nota cai de 14 para 12 no denominador — 12 de 12, não 12 de 14.

#### Execução 2 — `linhak-motos`, pela segunda fonte de identidade

```bash
GIT_AUTHOR_NAME="…" GIT_AUTHOR_EMAIL="…" npx -y "git+file:///$ESPELHO" novo linhak-motos linhak.com.br
```

```
▸ 4/6  primeiro commit: feito
▸ 5/6  rebar-check · linhak-motos
  ✓ editorconfig ✓ dependabot ✓ ci ✓ ci-gateia ✓ testes ✓ typecheck ✓ formatter
  – env-example  ✓ licenca ✓ readme ✓ notice ✓ coautoria-ia ✓ identidade-git
  ✓ ui-falso     – schema-orfao ✓ telefone
  14 de 14 · 2 não se aplica
  régua: exit 0 — passou      gerador: exit 0 — projeto completo
```

Conferido também com o checker do checkout, fora do gerador:

```bash
node ferramental/rebar-check/index.mjs "$TMP/linhak-motos"    # 14 de 14 · exit 0
```

#### O projeto gerado passa no próprio portão

```bash
cd "$TMP/linhak-motos" && npm run verificar     # lint && typecheck && test && build
# ℹ tests 6 · pass 6 · fail 0
# ✓ Compiled successfully in 12.3s · Finished TypeScript in 2.8s
# ○  (Static)  prerendered as static content   — 5 rotas
# exit 0
```

#### O build estático e o `og:image`

```bash
cd "$TMP/padaria-do-ze" && npx next build       # exit 0
# ┌ ○ /  ├ ○ /_not-found  ├ ○ /manifest.webmanifest  ├ ○ /robots.txt  └ ○ /sitemap.xml
# ○  (Static)  prerendered as static content

grep -o '<meta property="og:[^>]*>' out/index.html
# og:title · og:description · og:url · og:site_name · og:locale
# og:image  content="https://padaria-do-ze.com.br/og.png"
# og:image:width 1200 · og:image:height 630 · og:image:alt · og:type
```

`out/index.html` tem 15.255 bytes; `out/og.png`, 5.720 — gerado só com `node:zlib`, sem
dependência. O `wa.me` sai **com destinatário**:
`https://wa.me/5500000000000?text=Ola!%20Vim%20pelo%20site…`

#### Conteúdo quebrado de propósito — 5 mutações, 5 builds exit 1

É a §12.3 do plano exercida: identidade do negócio é **conteúdo validado no build**, não
variável de ambiente. Uma mutação por vez em `conteudo/site.json`, `next build` em cada:

| mutação | exit | o que o build disse |
| --- | --- | --- |
| `barra-no-fim` | 1 | `"site.meta.urlBase": esperava texto no formato https://dominio.com.br (sem barra no fim)` |
| `telefone-pontuado` | 1 | `"site.identidade.whatsapp.e164": esperava texto no formato só dígitos, com DDI` |
| `apaga-alt` | 1 | `"site.meta.og.alt": esperava texto, veio nada (campo ausente)` |
| `campo-desconhecido` | 1 | `"site.meta": campo(s) que o esquema não conhece — "corDeFundo"` |
| `descricao-curta` | 1 | `"site.meta.descricao": esperava texto com ao menos 50 caractere(s)` |
| _restaurado_ | **0** | — |

`5 de 5 mutações reprovaram o build`. Com env var, cada uma dessas subiria calada — que é
exatamente o que aconteceu no PR `Navesz/Galegos#1`, e por que ele foi estacionado.

#### O que o gerador NÃO faz, de propósito

Criar o repositório remoto, ligar o ruleset e ligar o Pages. As três mexem na conta de
quem roda, e ele imprime as três no passo 6 em vez de fazê-las.

### 4.12 PROVADO · O MCP que se regenera — o objetivo nº 5, fechado

_Medido em 01/09/2026. Antes desta data o `mcp/` tinha 1.412 linhas no disco e **nunca
tinha rodado**: as dependências nunca foram instaladas, nenhum passo do `verificar` o
tocava e nenhuma regra o cobria. Ele servia PROSA do plano por seção._

O defeito que este módulo existe para não repetir, nas palavras do dono: _"no Herz e no
BMB Compras eu elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na
memória"_ — e _"o MCP não era reescrito quando as regras de projeto foram modificadas"_.

**O desenho, e é o da §7.2 do PLANO:** o MCP não é escrito à mão, é artefato GERADO;
o portão regenera em memória e reprova se o disco divergir; e o artefato é derivado da
fonte, nunca cópia dela.

| Peça                      | O que é                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `ferramental/rebar-check/index.mjs` | **A fonte.** <!--n linhas.rebar-check-->2.350<!--/n--> linhas, <!--n regras.total-->22<!--/n--> regras, com o porquê medido de cada uma |
| `mcp/gerar.mjs`           | **O gerador.** <!--n linhas.mcp-gerador-->902<!--/n--> linhas, **zero dependência** |
| `mcp/regras.gerado.json`  | **O artefato.** <!--n mcp.artefato.tamanho-->81 KB<!--/n--> · <!--n mcp.artefato.regras-->22<!--/n--> regras · <!--n mcp.artefato.niveis-->8<!--/n--> níveis · <!--n mcp.artefato.passos-->13<!--/n--> passos · <!--n mcp.artefato.provas-->52<!--/n--> provas |
| `mcp/src/`                | **O servidor.** <!--n linhas.mcp-servidor-->937<!--/n--> linhas, <!--n mcp.ferramentas-->5<!--/n--> ferramentas. Lê o artefato, nunca a fonte |

Os cinco números do artefato são conferidos por **dois** portões independentes: o passo
`mcp` compara o artefato com a fonte, e o passo `numeros` compara esta tabela com o
artefato. Um artefato velho reprova antes de esta linha ser acusada — é a ordem `mcp` →
`numeros` do `verificar.config.mjs`, e ela existe para a acusação não apontar para quem não
errou.

```bash
node mcp/gerar.mjs              # escreve o artefato
node mcp/gerar.mjs --verificar  # o passo `mcp`: regenera em memória e compara com o disco
node mcp/src/prova-cliente.mjs  # o passo `mcp-servidor`: sobe o servidor e fala o protocolo
```

O `prova-cliente.mjs` faz, em 6 blocos: handshake, `tools/list`, sete `tools/call`, o
servidor **sem** artefato, o snippet de `.mcp.json` do README, e a fonte adulterada para
provar que o aviso de frescor cola em toda resposta.

**O ciclo que define o objetivo nº 5, rodado de ponta a ponta.** Muda-se uma regra de
verdade — o título de `readme`, linha 1404 do `index.mjs` — e o portão acusa:

```
✗ mcp        4 erros  167 ms
    - regras.readme.titulo = tem README                    (disco, velho)
    + regras.readme.titulo = tem README na raiz do repositorio   (fonte, hoje)
```

`node mcp/gerar.mjs` — **um comando** — e o `verificar` volta a APROVAR os <!--n verificar.passos-->13<!--/n--> passos.

**Zero dependência, conferido no pior caso.** O portão de frescor roda no `verificar` da
raiz e não pode exigir `mcp/node_modules`. Provado num clone em `tmpdir` com a pasta
apagada: `--verificar` respondeu `em dia` (exit 0) e, com a regra mutada, `DIVERGIU`
(exit 1) — nos dois casos sem uma única dependência instalada. O `git clone` também não
traz `mcp/node_modules`: o `node_modules/` do `.gitignore` já o cobre em qualquer nível.

**Custo medido do passo:** 175–213 ms em 5 rodadas (mediana 206 ms) em 01/09/2026, contra
1,0 s do prettier e os segundos de `provas` e `auto` — cronometragem é medição de máquina e
fica à mão, com a data (§0). Ele é o <!--n verificar.posicao.mcp-->6 de 13<!--/n--> da
lista, depois de `sintaxe` — com o arquivo sem compilar, "o artefato divergiu" seria
acusação falsa.

**O que foi consertado nesta rodada**, porque estava entregue e não funcionava:

1. **O ciclo não fechava em um comando.** O gerador escreve `JSON.stringify(…, 2)` e o
   prettier recolhe array curto para uma linha: depois de `node mcp/gerar.mjs` o passo
   `formato` ficava **vermelho**, e a dica do passo `mcp` mandava rodar só o gerador.
   Eram dois donos dos mesmos bytes. O artefato entrou no `.prettierignore` — é saída de
   máquina, e quem confere o conteúdo dele é o passo `mcp`, que compara FATO, não espaço
   em branco.
2. **`rebar --mcp` não existia.** Todo projeto gerado por `rebar novo` escreve um
   `.mcp.json` que roda `.rebar/mcp.mjs`, que chama `rebar --mcp` — e o parser respondia
   `opção desconhecida: --mcp`, saída 2. O ponteiro existia dos dois lados e o alvo não
   respondia. O despacho entrou no `index.mjs`, ao lado do subcomando `novo`, e entrega o
   stdio ao servidor com `stdio: 'inherit'`. Conferido de ponta a ponta: o `.mcp.json` de
   um projeto gerado sobe o servidor e responde `tools/call`.

**O objetivo nº 3 — "continuar impondo depois do dia 1" — tem agora as duas metades.** O
portão já ia junto no projeto gerado; o MCP passou a ir também, por ponteiro. O projeto
gerado **não** ganha MCP próprio, e a razão é a §7.2: ele tem zero regra própria, então um
MCP local serviria uma **cópia** das <!--n regras.total-->22<!--/n--> regras do rebar — que
é o defeito do Herz outra vez.

**O que fica parcial, e é dito aqui em vez de escondido:**

- **`porque` de cabeçalho em 5 de <!--n regras.total-->22<!--/n--> regras** (medido em
  01/09/2026). As outras têm o porquê extraído do corpo do `checar` ou do caso de prova —
  `0` regras ficaram sem nenhuma razão —, mas a classificação é posicional, não semântica:
  comentário de implementação pura entra junto, rotulado `onde: "implementacao"`. A forma
  melhor é um campo `porque:` dentro de cada regra — zero parsing, conferido pelo prettier
  —, e custa <!--n regras.total-->22<!--/n--> edições no `index.mjs`.
- **`npx --yes github:Navesz/rebar --mcp` não sobe o servidor** numa máquina sem checkout:
  o `npx` instala só as dependências da raiz, e `mcp/` é pacote separado. A falha é
  barulhenta e nomeia o conserto (`cd mcp && npm install`) e a alternativa sem MCP
  (`--json`). Fechar isso de vez pede um servidor de zero dependência — o cliente de prova
  já mostra que o protocolo cabe nisso, o servidor é que ainda usa o SDK.
- **`perfil.json` continua não existindo.** A §7.2 derivava o MCP dele; a fonte legível por
  máquina que existe hoje é o `index.mjs`, e é dele que o gerador deriva.

---

## 5. O que FALTA

### 5.1 Bloqueante para o rebar ser usável

_Remedido em 31/08/2026: as duas primeiras linhas saíram de "não existe"._

| Item                           | Estado                                               |
| ------------------------------ | ------------------------------------------------------ |
| O gerador — `rebar novo`       | **EXISTE e roda.** §4.11. Não é `npm create rebar`: é subcomando do mesmo `bin`, porque é o que o `npx` resolve |
| Preset `site`                  | **EXISTE e roda.** Next 16 SSG, conteúdo validado no build |
| Presets `app` / `api`          | Nenhum, e são **não-escopo** até o `site` rodar sem modificação em dois sites |
| MCP                            | **EXISTE, roda, e o portão o mantém em dia.** §4.12    |
| `perfil.esquema.json`          | Não existe. O pipeline painel→perfil→gerador é prosa   |

```bash
find . -name "*.schema.json" -not -path "*/node_modules/*"
# só os de dentro de provas/casos/schema-orfao — nenhum perfil.esquema.json
```

**Correção de um erro do ESTADO anterior:** ele dizia que o CI do próprio rebar "reprova a
si mesmo em 5 checagens". Não reprova. Em 02/09/2026, `npm run check` sai **13 de 13 · 4
n/a · exit 0** (§4.2); em 30/08 saía 11 de 11 · 6 n/a, que é o número que este parágrafo
publicava.

### 5.2 Os sete itens da §8.1 do PLANO — o que era para vir do alicerce

Estado verificado no disco em **02/09/2026**. Os tamanhos em bytes são medição de
conveniência e ficam à mão, com esta data (§0).

| Item da §8.1                                          | Estado real                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `verificar/verificar.mjs`                             | **PRESENTE.** 34.566 bytes, rastreado. Reescrito, não portado. Hoje com <!--n verificar.passos-->13<!--/n--> passos |
| `segredo/varrer-segredo.mjs`                          | **PRESENTE.** 35.855 bytes, rastreado (eram 34.483 em 30/08). Roda no `verificar` e no `pre-commit` |
| `elos/verificar-elos.mjs`                             | **PRESENTE.** 2.191 bytes, rastreado. Execução limpa                           |
| `hooks/`                                              | **PRESENTE, e instalado.** 4 arquivos rastreados, `core.hooksPath` ativo       |
| `ci/verificar.yml` como template                      | **PRESENTE.** `.github/workflows/verificar.yml`, e **já executou** — §9, D+30   |
| `contexto/ai.mjs`                                     | **AUSENTE.** `ferramental/contexto/` não existe                                |
| 15 presets de fronteira (web 7 + api 8) + 29 fixtures | **AUSENTE.** `ferramental/fronteiras/` não existe                              |

```bash
ls ferramental    # elos  hooks  numeros.mjs  rebar-check  segredo  verificar
```

`numeros.mjs` entrou em 02/09/2026 e não é item da §8.1: ele não veio do alicerce, nasceu
aqui, do defeito da §0.

**Sobram DOIS dos sete**, não três nem quatro: `contexto/ai.mjs` e os presets de fronteira.
O `perfil.esquema.json`, que o ESTADO anterior somava aqui, não é item da §8.1 — ele é
bloqueante da §5.1 acima. De fato não existe, mas contá-lo duas vezes inflava o buraco.

A fonte dos dois ausentes existe: `alicerce/ferramental/contexto/ai.mjs` e
`alicerce/ferramental/fronteiras/`.

### 5.3 As duas decisões 🔴 vermelhas — FECHADAS, e exercidas

_Atualizado em 31/08/2026. Estavam abertas em 30/08 e travavam o preset `site`; foram
fechadas nas §12.2 e §12.3 do PLANO e agora estão RODANDO, não só decididas._

**1 · Estratégia de renderização — fechada em Next 16 App Router com `output: "export"`.**
O argumento que decidiu continua valendo: SPA **não entrega `og:image`**, porque WhatsApp,
LinkedIn, Slack e Discord não executam JS. Exercido: o `out/index.html` do projeto gerado
traz `og:image` absoluto com `width`/`height`/`alt` e **sem uma linha de JS** — §4.11.
O preset `app` (Vite + TanStack Router) não é escopo agora.

**2 · Origem do conteúdo — fechada em `conteudo/*.json` validado no build.** A identidade
do negócio (telefone, CNPJ, endereço) é **conteúdo validado**, não variável de ambiente.
Exercido: 5 mutações no `conteudo/site.json`, 5 builds exit 1 — §4.11. O custo de errar
esta é conhecido e tem número: no PR `Navesz/Galegos#1`, com env var, o `wa.me` subia sem
destinatário e o cardápio parava de entregar pedido **em silêncio**.

### 5.4 Outras fronteiras abertas

**Autorização** — o painel só tem auth corporativa. Falta a distinção que a IA mais erra:
`if (!user) throw 401` não responde _"este usuário pode modificar **este** recurso"_.

**Isolamento de tenant** — fronteira aberta e **documentada em teste que passa de
propósito**: o custom GUC é `USERSET`, então a própria sessão troca o próprio contexto.
Quando o canal for fechado, o teste inverte.

**Tier 2 da revisão dos agentes**, em `docs/REVISAO-AGENTES.md`: TTL da tabela de
idempotência, expurgo do outbox, `statement_timeout`,
`idle_in_transaction_session_timeout`, tamanho do pool contra `max_connections`. Quantidade
exata: **não medida** nesta sessão.

---

## 6. Como rodar

Todos os comandos abaixo foram executados em 02/09/2026 e funcionam. **Os números que eles
imprimem não ficam nos comentários da cerca**, e a razão é concreta: o GitHub mostra a
cerca literalmente, então um `# 50 casos` copiado junto com o comando entrega à pessoa um
número que já não é o que ela vai ver na tela. Cerca mostra comando; o número vai na prosa
ao lado, onde o passo `numeros` alcança. Hoje: <!--n verificar.passos-->13<!--/n--> passos
no `verificar`, <!--n provas.casos-->52<!--/n--> casos no `provar`, <!--n dominio.privilegio.testes-->16<!--/n--> asserções no domínio de privilégio, e 56
arquivos varridos pelo `elos` (este último medido à mão, §0).

```bash
# o checker contra qualquer repositório
node ferramental/rebar-check/index.mjs /caminho/do/repo      # texto
node ferramental/rebar-check/index.mjs --json /caminho/...   # JSON; aceita vários caminhos
node ferramental/rebar-check/index.mjs .                     # o próprio rebar
npm run check                                                # idêntico à linha acima

# o gerador — ESCREVE. Cria a pasta <nome> DENTRO DO CWD, então rode de onde
# você quer o projeto, nunca de dentro do rebar. Por isso NÃO existe script npm
# para ele: `npm run` roda sempre na raiz do pacote, e criaria rebar/<nome>.
cd /onde/o/projeto/vai/morar
npx github:Navesz/rebar novo <nome> [dominio]                       # o caminho do dono
node /caminho/do/rebar/novo/index.mjs <nome> [dominio]              # o mesmo, do checkout

# a sequência inteira
npm run verificar

# as provas do checker
npm run provar

# os números deste arquivo e do README — não tem script npm, é chamada direta
node ferramental/numeros.mjs              # reescreve
node ferramental/numeros.mjs --verificar  # o passo `numeros` do portão
node ferramental/numeros.mjs --fatos      # o catálogo

# formato
npm run formato          # prettier --check .  → "All matched files use Prettier code style!"
npm run formatar         # prettier --write .  — ESCREVE nos arquivos

# elos
node ferramental/elos/verificar-elos.mjs

# domínio de privilégio (precisa do Postgres de pé)
cd dominios/privilegio-de-banco && npm test
```

O `.md` está no `.prettierignore`, então o `formato` não toca nestes documentos: quem manda
nos bytes dos números é o `numeros.mjs`, e dois donos dos mesmos bytes é o defeito que o
artefato do MCP já pagou uma vez (§4.12).

**Sobre o exit code do checker, porque é fácil errar:** ele sai **1** sempre que alguma
regra determinística reprova, e isso vale igualmente para `--json`. Medido nesta sessão:
`. → exit 0`, `../prumo → exit 1`, `--json ../prumo → exit 1`, os 19 caminhos de uma vez →
exit 1. Quem consumir o `--json` num script precisa ler o stdout mesmo com exit diferente
de zero.

Dois scripts existem e **não foram executados nesta medição**, por escreverem estado:

- `npm run formatar` escreve nos arquivos. O `npm run formato` — mesmo binário, `--check` —
  passa, então o `--write` não teria o que mudar.
- `npm run instalar-hooks` altera `core.hooksPath`. O efeito dele já está aplicado.

---

## 7. Ambiente

_Conferido em 30/08/2026, e não remedido desde então. Nada aqui é propriedade desta
árvore — é a máquina do dono, e por isso nenhum número desta seção é derivável (§0)._

### PostgreSQL 17.2 — de pé, conferido campo a campo

```bash
"C:/Users/leona/pg17/pgsql/bin/pg_isready.exe" -h 127.0.0.1 -p 55432
# 127.0.0.1:55432 - aceitando conexões · exit 0

"C:/Users/leona/pg17/pgsql/bin/psql.exe" \
  "postgresql://postgres:bootstrap_dev_only@127.0.0.1:55432/rebar_teste" \
  -tAc "select version(), current_database();"
# PostgreSQL 17.2 on x86_64-windows, compiled by msvc-19.41.34123, 64-bit|rebar_teste
```

Instalado sem Docker e sem admin.

```
binários  C:\Users\leona\pg17\pgsql\bin
cluster   C:\Users\leona\pg17\data
porta     127.0.0.1:55432
log       C:\Users\leona\pg17\pg.log
banco     rebar_teste

superusuário  postgres   / bootstrap_dev_only    ← autenticado nesta medição
db_owner      db_owner   / owner_dev_only        ← não testado isoladamente
runtime       app_login  / app_dev_only          ← não testado isoladamente
```

As duas últimas identidades são exercitadas pela suíte de <!--n dominio.privilegio.testes-->16<!--/n--> testes, que passa. Isso as valida
indiretamente, não diretamente.

Reiniciar — **comando não executado**, o servidor já estava no ar:

```bash
"C:/Users/leona/pg17/pgsql/bin/pg_ctl.exe" -D "C:/Users/leona/pg17/data" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "C:/Users/leona/pg17/pg.log" start
```

### Docker está quebrado nesta máquina, e continua quebrado

Cada restart falhava num socket diferente, sempre erro 123. **Dois diretórios foram
renomeados** em 26/08, e os dois renomes continuam no disco:

```bash
ls -d "$LOCALAPPDATA/Docker/"* "$LOCALAPPDATA/docker-secrets-engine"* | grep -E 'run|secrets'
# …/AppData/Local/Docker/run
# …/AppData/Local/Docker/run.quebrado-20260826
# …/AppData/Local/docker-secrets-engine.quebrado-20260826
# (sem o grep são 12 linhas: o Docker deixa lock, log e install-log na mesma pasta)
```

O Docker recriou um `Docker/run` novo ao lado do renomeado. Nada foi apagado — os
originais estão preservados sob o sufixo `.quebrado-20260826`.

**Não é bloqueante.** O Postgres nativo cobre tudo o que o projeto precisa. Este registro
existe para que a próxima sessão não gaste tempo redescobrindo o mesmo defeito nem apague
os diretórios preservados.

---

## 8. Método de trabalho

1. **Centralizar.** Um arquivo, no máximo três. Centralizar evita pivotar à toa.
2. **Documento vivo.** Decisão nova entra no arquivo, não fica na conversa.
3. **Revisão por múltiplos agentes**, procurando furo e o que combina com o quê.
4. **Verificar o que agente devolve.** _"Não adianta o agente retornar coisas falsas e você
   acreditar."_ — e procede: um revisor afirmou "50 vs 159 commits"; medido, era 61 vs 125.
   Esta reescrita seguiu a regra: partiu de uma medição feita por outro agente e **não** a
   aceitou como dada — placar, contagem de regras, casos de prova, `verificar`, hooks,
   remoto, Postgres e os trechos de código citados na §10 foram todos reexecutados aqui.
5. **Backup antes de mexer.** Existe em `rebar-backup-20260825/` — que é cópia solta de
   arquivos, **não** repositório git — e no histórico do git, hoje com 36 commits (medido
   em 02/09/2026; eram 13 em 30/08, e a contagem fica à mão pela razão da §4.9).
6. **A matriz de invariantes vale se for gerada a partir do código, não escrita antes
   dele.** Domínio fechado = Claim + Assumptions + mecanismo + teste positivo + teste
   hostil + modo de falha + rollback, **com os testes existindo e passando**.

---

## 9. Critério de abandono

Do plano, §9.7. **Primeiro commit:
<!--n git.primeiro-commit-->2026-08-25 23:35:43<!--/n-->** — a data é derivada, e é ela que
ancora todos os marcos abaixo. Em 02/09/2026 o projeto está em **D+8**.

```bash
git log --reverse --format='%ad %s' --date=iso | head -1
# … Importa o plano, a stack e as oito rodadas de revisao
```

O "hoje" desta seção **não** é derivado, e a razão é a mesma da contagem de commits (§0,
teste 2): um D+N calculado a cada execução mudaria sozinho, com o relógio, sem que uma
linha do repositório mudasse — e o portão ficaria vermelho todo dia às zero hora.

| Marco | Vence      | Critério literal                                                                   | Se falhar                         |
| ----- | ---------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| D+7   | 01/09/2026 | `rebar-check` rodou contra ≥3 repositórios que não são o rebar                        | **Para**                          |
| D+30  | 24/09/2026 | ≥2 repositórios com `rebar-check` no CI **reprovando merge**, com link de execução    | Vira checklist e o repo é apagado |
| D+60  | 24/10/2026 | ≥1 checagem disparou e o dono **consertou o código em vez de desligar a checagem**    | A regra estava errada             |
| D+90  | 23/11/2026 | Checagens cresceram ≤50% **e** o nº de repositórios usando cresceu                    | Congela a lista                   |

**Parada dura:** dois repositórios novos iniciados sem o rebar, em sequência.

**Não-escopo:** nenhum preset `app` ou `api` antes de o `site` ter sido usado **sem
modificação** em dois sites.

### D+7 — CUMPRIDO em 30/08/2026, antes de o prazo vencer

O checker rodou em 30/08/2026 contra **18 repositórios que não são o rebar** — 19 menos ele
mesmo. Seis vezes o mínimo de 3, não quatro vezes como este arquivo dizia. O número que ele
publicava, 12, estava errado. A tabela da §4.8 é a saída, e é medição histórica de outras
árvores (§0).

### D+30 — 1 de 2. O primeiro repositório está gateado de verdade

Em 30/08/2026 o rebar saiu de ZERO para UM. As três exigências do critério, cumpridas
para o primeiro repositório e com link:

**(1) O `rebar-check` roda no CI.** `.github/workflows/verificar.yml`, matriz
`windows-latest` + `ubuntu-latest`, chamando `node ferramental/verificar/verificar.mjs`,
cujo último passo é o `rebar-check` apontado para o próprio repositório.

**(2) Existe execução, e ela é verde nos dois sistemas.**

```bash
gh run view 33341062882 --json conclusion,jobs
# success · windows-latest 57 s · ubuntu-latest 14 s
```
https://github.com/Navesz/rebar/actions/runs/33341062882

Foi a **primeira vez que qualquer coisa deste repositório rodou fora do Windows.** Eu
tinha registrado que esperava quebrar em Linux; não quebrou. O motivo provável são os dois
consertos do passo 1: o `.gitattributes` com `eol=lf` e o bit `+x` nos hooks, que eram
exatamente os dois defeitos que quebrariam lá.

**(3) O merge é reprovado de verdade, com PR plantado.** Apaguei o `.editorconfig` de
propósito num branch e abri PR:

```bash
gh pr view 3 --json mergeStateStatus,statusCheckRollup
# estado: BLOCKED
# verificar (windows-latest): FAILURE · verificar (ubuntu-latest): FAILURE
```
https://github.com/Navesz/rebar/pull/3 — fechado depois da prova.

E o push direto na `main` também é recusado:

```
! [remote rejected] main -> main (push declined due to repository rule violations)
```

O ruleset é https://github.com/Navesz/rebar/rules/21884527, com
`bypass_actors: []` e `current_user_can_bypass: "never"` — **nem o dono passa por cima.**
É o N4s da §9.3: o único nível que não mora em arquivo que o agente edita.

**Falta o segundo repositório.** O critério exige ≥2, e o placar é **1 de 19**.

A comparação que desmonta a vaidade do D+7: **o rebar mede 19 repositórios e impõe em 1 —
ele mesmo; o alicerce mede 2 e impõe nos 2.** Medir é ler; impor é barrar. O D+7 conta
leituras, e é por isso que ele é fácil.

```bash
for r in <os 18>; do [ -d "$r/ferramental" ] && echo "$r"; done
# alicerce · prumo
```

No `prumo` o ferramental do alicerce **gateia de verdade**:
`prumo/.github/workflows/ci.yml:113` roda `npm run verificar`, e `prumo/ferramental/` tem 8
diretórios — `contexto`, `controle`, `elos`, `fronteiras`, `hooks`, `portao`, `segredo`,
`verificar`. Ou seja, a premissa "o alicerce nunca encostou em projeto real" é **falsa**.
Ela sobrevivia no cabeçalho de `ferramental/rebar-check/index.mjs`, e **isso foi
consertado**: o cabeçalho hoje registra a própria correção — _"a versão antiga deste
comentário dizia que ele morreu porque a imposição nunca encostou num projeto, e isso foi
MEDIDO e é FALSO"_. Na `docs/PLANO.md` §9.1 já estava corrigido desde 30/08; este parágrafo
cobrava o comentário do código, e a cobrança está paga (conferido em 02/09/2026). Encostou,
e no repositório de nota mais alta fora da ferramenta (85%, medição de 30/08). O que o
alicerce não fez foi **escalar**: 2 de 19. Esse é o diagnóstico defensável.

### D+60 — NÃO MENSURÁVEL AINDA

O mecanismo de disparo existe: os hooks estão instalados e barram commit de verdade. Mas os
commits do rebar não deixam rastro de uma checagem que tenha disparado e sido obedecida, e
o critério fala de repositório do dono em geral, não do rebar. Sem evidência no disco em
02/09/2026.

### D+90 — NÃO MENSURÁVEL, falta a linha de base

A linha de base do critério é a de 30/08/2026: **19 checagens**, teto de ≤50% em **28**.
Hoje são <!--n regras.total-->22<!--/n-->, ainda abaixo do teto, e o marco só vence em
23/11/2026 — compare o marcador com o 28 e a conta está feita. O segundo termo — "nº de
repositórios usando" — está em **1**. Medir 19 repositórios não é ser usado por 19
repositórios.

---

## 10. O que já foi tentado contra este repositório

Esta seção existe para duas pessoas: a próxima sessão, que não deve reabrir buraco já
fechado, e o próximo auditor, que deve começar de onde este parou.

Cada linha é um ataque que foi **reproduzido** e depois fechado, entre 30/08 e 31/08/2026.
Os números dentro da tabela são daquela medição e ficam como estão: são história, e a
história é o que dá autoridade ao conserto (§0).

**Os ponteiros para o código deixaram de ser número de linha em 02/09/2026.** Eles citavam
`arquivo:48-81`, e a conferência desta data achou **9 de 16** apontando para a linha errada
— o mesmo defeito das contagens, na mesma causa: o alvo se move e o documento não.
Agora cada um nomeia o **bloco** ou traz o `grep` que o encontra, que é o que não envelhece.

| #   | Ataque                                                                                                                                                                                                                                                                                                                                    | O que foi feito                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Forja de `--config`.** Seis passos `() => ({ codigo: 0 })` num config em `$TEMP` e `--config=` apontando para lá: saída byte-indistinguível de uma aprovação real, exit 0                                                                                                                                                                | O caminho do config e a raiz resolvida são **sempre impressos**, aprovado ou não; config que não é arquivo rastreado na árvore do git vira CONFIG EXTERNO e nunca sai 0; `--config=` vazio é exit 2. o bloco `FURO 3 — a forja de config` do `verificar.mjs`                                                 |
| 2   | **`skip-worktree`.** `git update-index --skip-worktree verificar.config.mjs` + reescrever o arquivo no disco ⇒ `git status`, `git diff` e `git diff HEAD` todos vazios, e APROVADO na tela                                                                                                                                                 | Roda `git ls-files -v`, o único comando que enxerga, e traduz cada letra anômala — inclusive a minúscula, que é `assume-unchanged`, o irmão silencioso. `LEGENDA_LS_FILES` no `verificar.config.mjs` e o bloco `ls-files -v` do `verificar.mjs`                                                                                   |
| 3   | **Árvore suja saindo APROVADO.** 4 arquivos não commitados ⇒ APROVADO 6 de 6                                                                                                                                                                                                                                                              | Passo `higiene`, novo. "APROVADO" e "árvore limpa" são duas alegações independentes, e o portão só fazia uma. `checarHigiene` no `verificar.config.mjs`                                                                                                                                                         |
| 4   | **Avisos mudos.** `extrairErros` só rodava quando o passo **não** passava, então a stdout de passo aprovado era descartada — inclusive o "⚠ N arquivo(s) escondidos por .rebarignore", que é o único canal que denuncia régua desligada                                                                                                    | Campo `avisar`: RegExp por passo, extraída e impressa **mesmo quando o passo passa**, em seção própria abaixo do placar. o campo `avisar` de cada passo, no `verificar.config.mjs`                                                                                                                                              |
| 5   | **`caso.json` como bypass.** Um `caso.json` na raiz do repositório produz prefixo vazio, e `''.startsWith` casa com tudo: o repositório inteiro sumiria da avaliação com um arquivo de três bytes                                                                                                                                          | Marcador só vale sob `provas/casos/<caso>/`, nunca na raiz, e só com o schema mínimo. Marcador recusado vira **aviso nomeando o arquivo**. o bloco `Onde um caso.json tem significado de marcador` do `index.mjs`                                                                                                                                   |
| 6   | **`.rebarignore` não rastreado.** Arquivo solto no disco — ou escondido atrás de `.git/info/exclude` — cegava o checker sem entrar em diff, em review ou no `git status`                                                                                                                                                                   | A lista é lida do **git**, não do disco. Não rastreado é ignorado por inteiro, e o fato vira aviso. o bloco `Lido do GIT, não do disco` do `index.mjs`                                                                                                                                                                          |
| 7   | **`ehTeste` como terceiro bypass.** Arquivo de teste sai das regras de conteúdo; renomear uma pasta para `provas/` tirou o conteúdo dela de cinco regras **e** ainda satisfez `testes` — "2 de 8 + 2 avisos" virou "3 de 7 + 0 avisos", sem uma linha dizendo o que sumiu                                                                   | A exclusão é **contada e impressa** no placar, com amostra dos caminhos. a linha `arquivo(s) de código fora das regras de conteúdo por serem teste` do `index.mjs` — a linha "2 arquivo(s) … por serem teste" do `npm run check` é essa contagem                                                                                                                     |
| 8   | **Segredo lendo o disco em vez do índice.** `--staged` pegava os NOMES do índice e o CONTEÚDO do disco: lia um arquivo e commitava outro. Não é só ataque — acontece sozinho quando se edita depois do `git add`                                                                                                                           | Em `--staged` o conteúdo vem do **blob do índice**. O disco só é lido no modo normal. o conserto 1 do cabeçalho do `varrer-segredo.mjs`                                                                                                                                                                                 |
| 9   | **PLACEHOLDER desligando a linha inteira.** Medido: 8 de 9 credenciais **reais** passaram. O caso pior era `{ host: "localhost", token: "ghp_…" }`, linha que qualquer projeto escreve                                                                                                                                                     | O placeholder é testado contra o **trecho casado**, nunca contra a linha. Desligar a linha inteira só pelo escape hatch explícito `rebar-segredo-ok:`. o conserto 2 do cabeçalho do `varrer-segredo.mjs`                                                                                                                |
| 10  | **Coautoria por enumeração.** A política era uma lista de 9 agentes de IA. Windsurf, ChatGPT, Cody, Codeium, Amazon Q e Tabnine entraram no histórico com trailer que o `git log --format=%(trailers)` reconhece: hook aprovando, exit 0 nos seis                                                                                          | Virou **allowlist de humanos** em `.rebar-coautores`, comparada por e-mail em caixa baixa, e o arquivo tem de estar rastreado. Enumerar agente é corrida que se perde toda semana                                                                                                                |
| 11  | **Contrabando abaixo da tesoura.** Um `Co-authored-by:` escrito **depois** da linha de comentário `>8` que o git corta: o parser de trailer perdia, e o commit entrava                                                                                                                                                                     | `checar-mensagem.mjs` **não corta na tesoura** — usa `git stripspace --strip-comments` e depois `git interpret-trailers --parse`, nessa ordem. Medido nos dois lados: acha o trailer escondido e não gera falso positivo com o diff do `commit -v`. o bloco `SEGUNDO FURO: O CONTRABANDO ABAIXO DA TESOURA` do `checar-mensagem.mjs` |
| 12  | **As provas liam exit code.** O `index.mjs` colapsa `passou` e `na` no mesmo exit 0, então nenhum ramo "não se aplica" podia ser travado. Medido: das **70 mutações** aplicadas ao `index.mjs`, **30 sobreviveram** com a suíte 15 de 15 verde — entre elas o helper `na()` e o `catch` do `git()`, os dois consertos mais caros do arquivo | Cada lado do caso declara um **estado** (`passou`/`reprovou`/`na`) e o runner o lê do `--json`. `quebrou` nunca pode ser esperado: crash é defeito do instrumento. `provas/provar.mjs:74-95`                                                                                                     |

Três desses ataques têm o mesmo formato, e vale nomear o padrão: **portão aberto tem de ser
fato checado, não omissão.** `.rebarignore`, `caso.json` e `ehTeste` continuam existindo
como saída legítima — o que mudou é que usá-los deixa marca impressa no placar.

Uma classe inteira de falso positivo também morreu nesta sessão: **"defeito procurado
recursivamente, defesa procurada só na raiz"**. Está documentada em
o comentário do `index.mjs` que termina com "Cinco achados, cinco falsos" (`grep -n "Cinco achados"`):
`prumo`, `ducado` e `LinhaK` acusados de "components/ui/ sem components.json" tendo os três
o arquivo rastreado, `openkartline` acusado de "sem prettier" com prettier declarado em
`apps/web/package.json`, e `LinhaK` acusado também em `typecheck`. É parte do motivo de o placar novo não ser comparável com o velho.
**Não existe placar antigo comparável para subtrair** — o número da §4.8 é o novo, e ponto.

---

## 11. Próximo passo

_Reescrito em 02/09/2026. A lista anterior tinha o push e o ruleset como item 1; os dois
foram feitos, e mantê-los aqui seria o mesmo defeito de número velho, um andar acima._

Onde o repositório está, em 02/09/2026: o rebar passa na própria régua com **13 de 13 · 4
n/a** (§4.2), o `verificar` fecha <!--n verificar.passos-->13<!--/n--> de <!--n verificar.passos-->13<!--/n--> passos, as provas são <!--n provas.casos-->52<!--/n--> casos cobrindo <!--n provas.cobertura-->22 de 22<!--/n--> regras, os hooks estão instalados, doze ataques
estão fechados, e o repositório está empurrado, com CI verde nos dois sistemas e ruleset
sem `bypass_actors` (§9, D+30).

O que falta é o que transforma isso em imposição de verdade, e o primeiro item continua não
sendo código:

**1 · Instalar o `rebar-check` no CI de dois repositórios que não são o rebar.** É a
literalidade do D+30, e é o único marco que ainda pode matar o projeto: o placar é **1 de
2**. Os dois candidatos óbvios são `prumo` (85%, já tem CI que gateia) e `openkartline`
(62%, idem) — as duas notas são de 30/08 (§4.8). Vence em **24/09/2026**.

**2 · Fechar o domínio de isolamento de tenant**, que é onde está a única falha conhecida e
documentada em teste (§5.4).

**3 · Os dois itens ausentes da §8.1** — `contexto/ai.mjs` e os presets de fronteira. Ficam
**depois** dos dois acima. Ordem travada: consumidor antes do gerador, e imposição antes de
ferramenta nova.

**4 · O `porque:` como campo da regra**, em vez de comentário extraído por posição (§4.12).
São <!--n regras.total-->22<!--/n--> edições no `index.mjs`, e tiram a última heurística de
posição que sobrou no gerador do MCP.
