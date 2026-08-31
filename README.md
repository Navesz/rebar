# rebar

**Faz código errado não passar.** Um checker que roda contra qualquer repositório, e um
portão que barra o commit quando a regra é ignorada.

Zero dependência em tempo de execução. Nunca escreve no repositório que audita.

```bash
npx github:Navesz/rebar .
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
```

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

**15 determinísticas** derrubam o exit code:

`editorconfig` · `dependabot` · `ci` · `ci-gateia` · `testes` · `typecheck` · `formatter` ·
`env-example` · `licenca` · `readme` · `notice` · `coautoria-ia` · `identidade-git` ·
`ui-falso` · `schema-orfao`

**5 heurísticas** só informam, e a separação é medida, não estética:

`shadcn-completo` · `telefone` · `url-producao` · `hex-cru` · `idioma-unico`

A regra ingênua de cor literal, medida num repositório real, deu **7 ocorrências e zero
verdadeiros positivos** — cinco eram comentários documentando a própria regra. Regra
automática errada custa mais que regra ausente, e heurística que barra ensina a desligar a
saída inteira.

### Toda regra nasce com dois casos

```bash
npm run provar     # 47 casos · 21 de 21 regras com prova
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

O `verificar` não tem campo `opcional` — a chave é recusada com exit 2. E `--passo=<nome>`
imprime `PARCIAL`, lista o que não rodou e sai `3`, nunca `0`. Os dois são portas
destrancadas que existiam no projeto anterior e que este se recusa a herdar.

## Estado

Honesto, e medido:

| | |
|---|---|
| O checker | **funciona** — 21 regras, 47 provas, rodado contra 19 repositórios |
| O portão | **funciona** — CI verde nos dois sistemas, merge barrado com PR plantado |
| Domínio de privilégio de banco | **provado** — 16 asserções contra PostgreSQL 17 real |
| `npm create rebar` (o gerador) | **não existe** |
| Presets `site` / `app` / `api` | **não existem** |

O rebar tira **11 de 11** na própria régua. Isso não é motivo de orgulho — é o mínimo para
ter autoridade de exigir dos outros.

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

Node ≥ 22. O `index.mjs` importa só built-ins — é o que faz o `npx` funcionar sem instalar
nada, e a fronteira é deliberada: zero dependência é propriedade do que **confere**, não do
que se confere.

Coautoria de IA é barrada por allowlist de humanos em [`.rebar-coautores`](.rebar-coautores).
Enumerar humanos é uma lista curta e estável; enumerar agentes de IA é uma corrida que se
perde toda semana.

## Licença

[Apache-2.0](LICENSE)
