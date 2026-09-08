# rebar

![rebar — checker, portão, gerador](docs/assets/rebar-banner.svg)

> **Faz código errado não passar.** Um checker que roda contra qualquer repositório, um portão
> que barra o commit quando a regra é ignorada, e um gerador que fabrica o próximo projeto já
> do lado certo da régua.

[![verificar](https://github.com/Navesz/rebar/actions/workflows/verificar.yml/badge.svg)](https://github.com/Navesz/rebar/actions/workflows/verificar.yml)
[![Licença](https://img.shields.io/github/license/Navesz/rebar)](LICENSE)
[![Regras](https://img.shields.io/badge/regras-27-blue)](#o-que-ele-checa)
[![Portão](https://img.shields.io/badge/port%C3%A3o-25%20passos-blue)](#o-portão)
[![Estado](https://img.shields.io/badge/estado-alfa-orange)](ESTADO.md)

[Read in English](README.md) · [Léelo en español](README.es.md) ·
[Site](https://navesz.github.io/rebar-site/) · [Estado do projeto](ESTADO.md) ·
[Plano](docs/PLANO.md)

![rebar-check rodando no próprio repositório do rebar: 14 de 14, 4 não se aplicam, 1 aviso](docs/assets/rebar-scoreboard.svg)

Essa é a saída real, gerada da execução — não um print desenhado à mão.
São três estados, e o terceiro é o que impede o placar de mentir: regra que não se
aplica imprime `–` **com o motivo** e sai do denominador, em vez de contar como
aprovação que ela não conquistou.

```bash
npx github:Navesz/rebar .                    # auditar o que já existe
npx github:Navesz/rebar new padaria-do-ze   # começar do lado certo
```

Zero dependência em tempo de execução. O checker nunca escreve no repositório que audita.

---

## O problema, medido

Este projeto nasceu de uma queixa concreta:

> Todos os sites que peço para usar o padrão como referência — muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando a IA como colaboradora, esquecendo do
> shadcn.

A resposta usual é escrever a regra melhor. Não funciona, e dá para medir. Numa forense de
**161 commits em seis repositórios**:

| Medição | Resultado |
|---|---|
| Repositórios sem CI | 3 de 6 |
| Repositórios com lint quebrado agora | **os mesmos 3** |
| Commits com coautoria de IA | 41 de 161 (25,5%) |
| Repositório com mais documento de governança | **35 erros de lint** |

_Medição histórica de 25/08/2026, feita nos outros repositórios da máquina do dono. Não é
propriedade desta árvore, não é derivável daqui, e não deve ser atualizada: é a evidência que
originou o projeto, com a data em que foi colhida._

Aquele último é o caso que decide o desenho. Ele tinha `AGENTS.md` com "Hard rules",
`SECURITY.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, e um script `check` encadeando formato,
lint, tipos, teste e build. **Nada nunca executava esse `check`.**

> Regra em markdown tem cumprimento próximo de zero. Regra em CI tem 100%.

Daí a tese: **se uma regra pode descer de nível, ela deve descer — mas o enforcement precisa
ser mais confiável do que a regra que substitui.**

## Três estados, e o terceiro é o que impede o placar de mentir

```
rebar-check · prumo
  ✓ editorconfig       tem .editorconfig
  ✗ dependabot         atualização de dependência automatizada  sem dependabot nem renovate
  ✓ ci                 tem CI
  ✓ ci-gates           o CI alcança a verificação que o repositório tem
  – typecheck          tem script de typecheck  não tem TypeScript
  11 de 13  ·  1 não se aplica
```

_Recorte de uma saída real contra o `prumo`, medida em 30/08/2026 — é ilustração do formato,
não placar desta árvore._

**"Não se aplica" sai do denominador.** Antes de existir, uma pasta vazia com um `.git/` vazio
tirava 8 de 14 — empatava com o próprio rebar e tirava o dobro do repositório mais rigoroso da
máquina. O nada não conforma; o nada não se aplica.

### Códigos de saída

| | |
|---|---|
| `0` | tudo que se aplica passou |
| `1` | reprovou — violação real |
| `2` | alvo inválido ou invocação errada |
| `127` | **quebrou** — uma regra lançou exceção |

O `127` domina o `1`: não se acusa um repositório com uma régua que quebrou.

## O que ele checa

São <!--n rules.total-->23<!--/n--> regras em duas classes.

**<!--n rules.deterministicas-->18<!--/n--> determinísticas** derrubam o exit code:

São elas: <!--n rules.lista-deterministicas-->`editorconfig` · `dependabot` · `ci` · `ci-gates` · `tests` · `typecheck` · `formatter` · `env-example` · `license` · `readme` · `notice` · `hooks-executable` · `gate-with-placeholder` · `ai-coauthorship` · `git-identity` · `fake-ui` · `orphan-schema` · `phone`<!--/n-->

**<!--n rules.heuristicas-->5<!--/n--> heurísticas** só informam, e a separação é medida, não estética:

São elas: <!--n rules.lista-heuristicas-->`content-outside-code` · `shadcn-complete` · `production-url` · `raw-hex` · `single-language`<!--/n-->

A regra ingênua de cor literal, medida num repositório real, deu **7 ocorrências e zero
verdadeiros positivos** — cinco eram comentários documentando a própria regra. Regra
automática errada custa mais que regra ausente, e heurística que barra ensina a desligar a
saída inteira.

### Toda regra nasce com dois casos

São <!--n proofs.casos-->68<!--/n--> casos, um par por regra, e as <!--n rules.total-->23<!--/n--> regras estão cobertas:

```bash
npm run prove
```

Cada caso monta um repositório em miniatura num diretório temporário, com `git init` próprio,
e confere o **estado** da regra — passou, reprovou, não se aplica ou quebrou. Nunca escreve no
repositório vivo.

Ler só o exit code não bastava: `passou` e `não se aplica` saem os dois como `0`, então **13
das 20 regras eram improváveis por construção** — medido em 30/08/2026, quando as regras eram
20. Hoje, restaurar à mão qualquer um daqueles 13 ramos faz a suíte reprovar.

## As três réguas

| Comando | O que responde | O que não faz |
|---|---|---|
| `npx github:Navesz/rebar .` | O repositório está no formato certo? | Não olha segurança, não roda a aplicação |
| `npx -p github:Navesz/rebar rebar-security .` | Ele tem falha de segurança? | Não checa Broken Access Control — o nº 1 do OWASP |
| `npx github:Navesz/rebar new <nome>` | Começar um projeto já com portão | Um preset só: `site` |

O `-p` da segunda não é detalhe. Sem ele o `npx` roda o bin padrão do pacote — o checker de
formato — e o passo da "régua de segurança" repete o de cima sem ninguém notar.

**O `rebar-security` é honesto sobre o buraco dele.** IDOR e autorização por objeto ficaram de
fora porque a defesa quase sempre mora em middleware, policy ou RLS: duas árvores idênticas no
disco têm veredito oposto. Dizer isso é mais útil que fingir que checa.

## O portão

O checker é uma das camadas, não a única.

| Camada | O quê | Quem barra |
|---|---|---|
| **N5** | `pre-commit` — segredo em stage e coautoria | git, na tua máquina |
| **N5** | `commit-msg` — coautoria de IA | git, antes de o commit existir |
| **N4** | CI em matriz Windows + Linux, rodando o `verify` inteiro | GitHub Actions |
| **N4s** | ruleset com check obrigatório | **o servidor** |

`npm run verify` **não é uma camada nova**: é a sequência que o N4 executa e que você roda
antes dele, hoje com <!--n verify.passos-->25<!--/n--> passos.

Na ordem: <!--n verify.lista-passos-->`hygiene` · `hooks` · `commit-msg` · `syntax` · `blocks` · `mcp-server` · `mcp` · `numbers` · `format` · `links` · `secret` · `secret-proofs` · `steps` · `strip` · `proofs` · `generator-map` · `site-paths` · `remote-gate` · `chain` · `generator-identity` · `mcp-template` · `security` · `security-table` · `security-self` · `self`<!--/n-->

O N4s existe porque tudo abaixo dele mora em arquivo que o agente edita: o workflow ele apaga,
o `core.hooksPath` ele remove sem deixar diff. Só o ruleset resiste — e aqui ele está com
`bypass_actors: []`, então nem o dono passa por cima.

```bash
npm run verify          # a sequência inteira, um comando
npm run install-hooks   # aponta core.hooksPath para tooling/hooks
```

### O passo que faltava, e o que a ausência dele custou

Numa renomeação, o `aplicar.mjs` passou a ler `verify.yml` de uma pasta onde o arquivo se
chama `verificar.yml`. **O `rebar new` morreu com ENOENT** — e o `npm run verify` ficou verde
por seis commits, porque nenhum passo gerava um projeto. O checker se prova, as regras se
provam, o MCP se prova, o portão se prova por mutação — e o produto não.

O `generator-map` fecha isso, e é provado por mutação: replantar o defeito original faz dois
dos cinco testes dele caírem com a mensagem certa.

## O MCP

O projeto gerado leva um servidor que lê as regras dele mesmo, para a IA que o abrir ser
avisada antes de escrever, e não depois.

O artefato é **derivado, nunca duplicado**: o `npm run verify` o regenera em memória e reprova
se o disco divergir. É impossível mudar uma regra e esquecer o MCP.

Ele carrega <!--n mcp.artefato.regras-->27<!--/n--> regras de dois módulos, <!--n mcp.artefato.passos-->25<!--/n--> passos de portão e <!--n mcp.artefato.provas-->74<!--/n--> provas, expostos em <!--n mcp.ferramentas-->5<!--/n--> ferramentas.

## Mapa do repositório

| Caminho | O quê |
|---|---|
| `tooling/rebar-check/` | a régua de formato e seus <!--n proofs.casos-->68<!--/n--> casos de prova |
| `tooling/security/` | a régua de segurança |
| `tooling/verify/` | o executor do portão e as provas por mutação dos passos |
| `tooling/secret/` | o varredor de segredo, e as seis provas de detecção |
| `new/` | o gerador: moldes, portão, e as provas do mapa de arquivos |
| `mcp/` | o artefato gerado e o servidor que o serve |
| `docs/PLANO.md` | o manuscrito único: taxonomia, decisões e a revisão adversarial |
| `ESTADO.md` | o que está feito, o que falta, e o que não está provado |

## O que este projeto não faz

Declarar o limite vale mais que declarar a capacidade, então:

- Não checa **Broken Access Control**, o nº 1 do OWASP. Está fora do alcance de um checker
  estático, e isso está escrito.
- Não roda a sua aplicação. Toda regra decide sobre um repositório parado.
- Tem **um preset de gerador**, o `site`. `app` e `api` estão barrados por não-escopo
  declarado até o `site` ser usado sem modificação em dois sites.
- Uma heurística continua só avisando porque perto de 12% do que ela acusa é vocabulário de
  interface. Se não virar, o critério de abandono manda parar.

## Apoio

Não há destino de doação, e não haverá enquanto o dono do repositório não ativar e verificar
um. A contribuição útil hoje é rodar a régua contra um repositório seu e abrir uma issue com a
saída — falso positivo relatado vale mais que regra acrescentada.

## Licença

[Apache-2.0](LICENSE), com o aviso de atribuição em [NOTICE](NOTICE).

Coautoria de IA é barrada por allowlist de humanos em
[`.rebar-coauthors`](.rebar-coauthors), imposta pelo hook `commit-msg` antes de o commit
existir e pela regra `ai-coauthorship` sobre o histórico depois.
