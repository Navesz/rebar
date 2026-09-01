// O PORTÃO. É o que o gerador aplica POR CIMA do que o `shadcn create` entregou.
//
// A divisão de trabalho está fechada e é a razão de este arquivo ser pequeno: o
// scaffold é do shadcn, que já entrega a pilha decidida na §12.2 — Next 16 App
// Router, React 19, Tailwind 4, base-nova, zero Radix. Escrever o nosso próprio
// scaffold seria assumir a manutenção de uma cópia do trabalho do shadcn, para
// sempre, e ela começaria a apodrecer na primeira release deles.
//
// O portão é o que o shadcn NÃO entrega e o rebar cobra: régua, CI em matriz,
// hooks, licença, e o fim de linha normalizado.
//
// TUDO AQUI É IDEMPOTENTE, e não é elegância. Outro passo do gerador — o preset
// `site` — escreve no mesmo projeto no mesmo minuto, e os dois têm motivo para
// encostar no next.config.ts. Sobrescrever o que o vizinho acabou de escrever é
// o defeito clássico de gerador em camadas; aqui cada escrita ou é a primeira
// ou é um no-op declarado.

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/Users/...", com
// barra antes da letra do drive, e todo join a partir dele aponta para o nada.
const AQUI = dirname(fileURLToPath(import.meta.url))
const MOLDES = join(AQUI, 'arquivos')

// ─────────────────────────────────────────────────────────── moldes estáticos
//
// Os moldes moram sem o ponto inicial no nome (`editorconfig`, não
// `.editorconfig`) DE PROPÓSITO. Um `.gitignore` ou um `.editorconfig` de
// verdade dentro desta pasta valeria para a subárvore do PRÓPRIO rebar — o git
// e os editores leem arquivo de configuração em qualquer profundidade — e o
// molde passaria a mudar o comportamento do repositório que só queria guardá-lo.
// O mapa abaixo é o único lugar onde o nome final é decidido.

// Os hooks vão para `.githooks/` e NÃO para `hooks/`, e isso não é gosto: o
// `shadcn create` já cria `hooks/` como a pasta de React hooks do projeto,
// aliasada como `@/hooks` no components.json. Despejar `pre-commit` lá dentro
// misturaria hook de git com hook de React na mesma pasta e no mesmo alias.
const PASTA_HOOKS = '.githooks'

const ESTATICOS = [
  ['editorconfig', '.editorconfig'],
  ['gitattributes', '.gitattributes'],
  ['dependabot.yml', '.github/dependabot.yml'],
  ['verificar.yml', '.github/workflows/verificar.yml'],
  ['pre-commit', `${PASTA_HOOKS}/pre-commit`],
  ['commit-msg', `${PASTA_HOOKS}/commit-msg`],
  ['instalar.mjs', `${PASTA_HOOKS}/instalar.mjs`],
  ['portao.test.mjs', 'testes/portao.test.mjs'],
]

// Peças que o gerador COPIA do próprio rebar em vez de duplicar aqui.
//
// São arquivos que já existem, já são revisados e já têm prova: o texto integral
// da Apache-2.0, o varredor de segredo e o checador de mensagem de commit. Uma
// segunda cópia deles nesta pasta seria uma cópia que envelhece separado da
// original — e a única coisa pior que não ter varredor de segredo é ter um
// desatualizado que diz que olhou.
//
// Os dois `.mjs` copiados são autocontidos, só de built-in do Node, e acham a
// raiz por `git rev-parse --show-toplevel`. Postos em `.githooks/`, eles leem o
// repositório GERADO, não o rebar.
const COPIADOS_DO_REBAR = [
  ['LICENSE', 'LICENSE'],
  ['ferramental/segredo/varrer-segredo.mjs', `${PASTA_HOOKS}/varrer-segredo.mjs`],
  ['ferramental/hooks/checar-mensagem.mjs', `${PASTA_HOOKS}/checar-mensagem.mjs`],
]

// Os dois arquivos que o git precisa ver como 100755. Ver `marcarExecutaveis`.
const EXECUTAVEIS = [`${PASTA_HOOKS}/pre-commit`, `${PASTA_HOOKS}/commit-msg`]

// ──────────────────────────────────────────────────────────────── utilitários

function escrever(destino, rel, texto) {
  const caminho = join(destino, ...rel.split('/'))
  mkdirSync(dirname(caminho), { recursive: true })
  // LF sempre, e escrito à mão em vez de confiado ao .gitattributes: o
  // .gitattributes conserta o que o git INDEXA, não o que está no disco de quem
  // acabou de rodar o gerador.
  writeFileSync(caminho, texto.replace(/\r\n/g, '\n'), 'utf8')
}

function lerSe(destino, rel) {
  const caminho = join(destino, ...rel.split('/'))
  return existsSync(caminho) ? readFileSync(caminho, 'utf8') : null
}

// ─────────────────────────────────────────────────────────── conteúdo gerado

function moldeNotice(nome, dono, ano) {
  return `${nome}
Copyright ${ano} ${dono}

Este produto inclui software desenvolvido por ${dono}.

Distribuído sob a Apache License, Version 2.0. O texto integral da licença
está no arquivo LICENSE, na raiz deste repositório.
`
}

function moldeCoautores(dono, email) {
  return `# Coautores HUMANOS aceitos neste repositório. ALLOWLIST, não lista de inimigos.
#
# Por que invertido: a política antiga era uma ENUMERAÇÃO de agentes de IA, e o
# ataque de 2026-08-30 furou os dois lugares onde ela morava — seis agentes
# entraram no histórico de uma vez, com trailer que o git reconhece como
# coautoria, e a régua acusou 1 de 9 commits quando 8 tinham trailer. Enumerar
# agente é corrida que se perde toda semana; humano do projeto é lista curta e
# que muda uma vez por ano.
#
# FORMATO: uma identidade por linha, "Nome <email>" ou só o e-mail. O que é
# comparado é o E-MAIL, em caixa baixa. Nome é texto livre e não identifica
# ninguém. Linha vazia e linha começada por # são ignoradas.
#
# QUEM LÊ:
#   .githooks/checar-mensagem.mjs       no commit-msg, antes de o commit existir
#   regra coautoria-ia do rebar-check   no histórico, depois de ele existir
#
# ESTE ARQUIVO TEM DE ESTAR RASTREADO. O rebar-check só o aceita se o
# "git ls-files" o listar, porque allowlist solta no disco é allowlist que o
# auditor não vê — e aqui um arquivo de dois bytes desligaria a regra inteira.

${dono} <${email}>
`
}

function moldeReadme(nome, dono, ano) {
  return `# ${nome}

Site estático em Next.js com App Router, gerado pelo \`rebar novo\` e nascido com
o portão ligado.

## A pilha, e por que ela

| peça | escolha | motivo |
| --- | --- | --- |
| framework | Next 16, App Router, \`output: "export"\` | publica no GitHub Pages sem servidor |
| UI | shadcn no estilo \`base-nova\`, sobre \`@base-ui/react\` | zero Radix, decisão da §12.2 |
| estilo | Tailwind 4 | vem com o preset |
| conteúdo | \`conteudo/*.json\`, validado no build | §12.3 — ver abaixo |

## Conteúdo não mora no código

Telefone, CNPJ, endereço e preço são **conteúdo validado**, em \`conteudo/*.json\`,
e não literal em \`.tsx\` nem variável de ambiente. A decisão tem custo medido:
mover o número de WhatsApp para variável de ambiente faz o build passar, o link
de WhatsApp subir sem destinatário e o cardápio parar de entregar pedido **em
silêncio**. A régua do rebar cobra isso pelas regras \`telefone\` e
\`conteudo-fora-do-codigo\`.

## Comandos

\`\`\`sh
npm run dev         # desenvolvimento
npm run verificar   # o portão inteiro: lint, typecheck, teste e build
npm run build       # gera out/ , estático
npx --yes github:Navesz/rebar .   # a régua do rebar, o placar
\`\`\`

## Hooks

\`\`\`sh
node .githooks/instalar.mjs
\`\`\`

Configura \`core.hooksPath\`, então o hook é versionado e atualiza junto com o
repositório. O \`pre-commit\` varre segredo no que está em stage; o \`commit-msg\`
barra trailer de coautoria de IA antes de o commit existir. Pular uma vez:
\`git commit --no-verify\`.

## Licença

Apache-2.0. Ver \`LICENSE\` e \`NOTICE\`.

Copyright ${ano} ${dono}.
`
}

// ─────────────────────────────────────────────────────────────── as etapas

/**
 * O `output: "export"` do Next, de forma idempotente.
 *
 * Sem ele o `next build` gera um servidor e o GitHub Pages publica uma pasta
 * vazia — falha que NÃO aparece no build, só no deploy. O `images.unoptimized`
 * vem junto porque o otimizador de imagem do Next exige servidor em execução, e
 * sem ele o mesmo build passa e as imagens somem em produção.
 *
 * Idempotente porque o preset `site` tem o mesmo direito de escrever aqui. Se já
 * houver `output:`, esta função não encosta. Se o arquivo não tiver a forma que
 * ela sabe editar, ela AVISA em vez de fingir que editou — patch silencioso que
 * não pegou é como o defeito chega em produção.
 */
function garantirExportEstatico(destino, avisos) {
  const rel = 'next.config.ts'
  const atual = lerSe(destino, rel)
  if (atual === null) {
    avisos.push('next.config.ts não existe — o output: "export" não foi aplicado')
    return 'ausente'
  }
  if (/output\s*:\s*['"]export['"]/.test(atual)) return 'já estava'

  const corpo = `{
  // GitHub Pages serve arquivo, não processo. Sem isto o build gera servidor e
  // o Pages publica uma pasta vazia — falha que só aparece no deploy.
  output: "export",
  images: {
    // O otimizador de imagem do Next exige servidor em execução. Com export
    // estático e sem esta linha, o build passa e as imagens somem em produção.
    unoptimized: true,
  },
}`
  const vazio = /(const\s+nextConfig\s*:\s*NextConfig\s*=\s*)\{\s*\}/
  if (!vazio.test(atual)) {
    avisos.push(
      'next.config.ts já foi editado por outra camada e não tem a forma esperada — ' +
        'confira à mão se output: "export" está lá',
    )
    return 'não reconheci'
  }
  escrever(destino, rel, atual.replace(vazio, `$1${corpo}`))
  return 'aplicado'
}

/**
 * Os scripts que o portão exige do package.json.
 *
 * `verificar` é UM comando, e o CI chama só ele. O motivo é a regra `ci-gateia`
 * do rebar: ela cobra que o CI ALCANCE o lint, o typecheck e o teste que o
 * repositório tem, e ela expande `npm run verificar` lendo o corpo do script.
 * Com os passos escritos no YAML, renomear um script desliga o passo e o YAML
 * continua verde; com um comando só, o desvio aparece na hora.
 *
 * Só encadeia o que EXISTE. Chamar `npm run lint` num projeto sem `lint` é um
 * CI que quebra por causa do gerador, não por causa do código.
 */
function garantirScripts(destino, avisos) {
  const bruto = lerSe(destino, 'package.json')
  if (bruto === null) {
    avisos.push('package.json não existe — nenhum script foi ajustado')
    return null
  }
  const pkg = JSON.parse(bruto)
  pkg.scripts = pkg.scripts || {}

  // O padrão GLOB, e não `node --test testes/`. Medido no Node 24.13 em
  // Windows: com a pasta como argumento posicional, o runner tenta CARREGAR
  // `testes` como módulo e morre com MODULE_NOT_FOUND — "✖ test at testes:1:1",
  // uma falha que não parece uma falha de caminho. O glob é expandido pelo
  // próprio Node desde a v22, então não depende de shell e vale nos dois
  // sistemas.
  //
  // Apontado para a pasta e não solto: `node --test` sozinho varreria o
  // repositório inteiro e tentaria interpretar `.tsx` do app como teste.
  // Built-in do Node, zero dependência nova.
  if (!pkg.scripts.test) pkg.scripts.test = 'node --test "testes/**/*.test.mjs"'

  const elos = ['lint', 'typecheck', 'test', 'build'].filter((n) => pkg.scripts[n])
  // `npm test` e não `npm run test`: é o nome canônico, e a regra `ci-gateia`
  // procura a palavra `test`, que está nos dois.
  pkg.scripts.verificar = elos.map((n) => (n === 'test' ? 'npm test' : `npm run ${n}`)).join(' && ')

  escrever(destino, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  return elos
}

/**
 * O bit de execução, que é a armadilha que o rebar já pagou uma vez.
 *
 * No Windows o `core.filemode` é false: um `chmodSync(0o755)` no disco NÃO vira
 * modo 100755 no índice do git. O hook é commitado como 100644, e em Linux o
 * git simplesmente NÃO O EXECUTA — sem erro, sem aviso, sem nada. O portão
 * parece instalado e verifica zero.
 *
 * `git update-index --chmod=+x` escreve o modo no índice diretamente, e é a
 * única forma que funciona igual nos dois sistemas. O chmod no disco vai junto
 * porque quem acabou de gerar o projeto vai rodar o hook antes de qualquer
 * clone, e em Linux ele precisa do bit no disco também.
 *
 * Roda DEPOIS do `git add`: `--chmod` mexe no índice, e o que não está no índice
 * não tem modo para mexer.
 */
function marcarExecutaveis(destino, avisos) {
  for (const rel of EXECUTAVEIS) {
    try {
      chmodSync(join(destino, ...rel.split('/')), 0o755)
    } catch (erro) {
      avisos.push(`não consegui dar chmod em ${rel}: ${erro.message}`)
    }
  }
  try {
    execFileSync('git', ['update-index', '--add', '--chmod=+x', ...EXECUTAVEIS], {
      cwd: destino,
      encoding: 'utf8',
    })
  } catch (erro) {
    avisos.push(`git update-index --chmod=+x falhou: ${erro.message}`)
    return null
  }
  // Conferir, e não confiar. O modo é o ponto inteiro desta função.
  const saida = execFileSync('git', ['ls-files', '-s', ...EXECUTAVEIS], {
    cwd: destino,
    encoding: 'utf8',
  })
  const linhas = saida.split('\n').filter(Boolean)
  const errados = linhas.filter((l) => !l.startsWith('100755'))
  if (errados.length) {
    avisos.push(`hook sem modo 100755 no índice: ${errados.join(' | ')}`)
    return null
  }
  return linhas
}

// ──────────────────────────────────────────────────────────────── a aplicação

/**
 * Aplica o portão sobre um projeto já existente.
 *
 * @param {object} opcoes
 * @param {string} opcoes.destino    raiz do projeto gerado
 * @param {string} opcoes.nome       nome do projeto, já validado pelo chamador
 * @param {string} opcoes.raizRebar  raiz do checkout do rebar, de onde se copia
 * @param {string} opcoes.dono       nome do dono, para NOTICE e allowlist
 * @param {string} opcoes.email      e-mail do dono, para a allowlist
 * @returns {{escritos: string[], avisos: string[], elos: string[]|null, exportEstatico: string}}
 */
export function aplicarPortao({ destino, nome, raizRebar, dono, email }) {
  const escritos = []
  const avisos = []

  for (const [molde, rel] of ESTATICOS) {
    escrever(destino, rel, readFileSync(join(MOLDES, molde), 'utf8'))
    escritos.push(rel)
  }

  for (const [origem, rel] of COPIADOS_DO_REBAR) {
    const de = join(raizRebar, ...origem.split('/'))
    if (!existsSync(de)) {
      // Alto e claro. Sem LICENSE, as regras `licenca` e `notice` reprovam; sem
      // o varredor, o pre-commit morre no primeiro commit. Nenhuma das duas
      // pode virar um aviso que se lê depois.
      avisos.push(`NÃO ACHEI no rebar: ${origem} — o projeto sai incompleto`)
      continue
    }
    const para = join(destino, ...rel.split('/'))
    mkdirSync(dirname(para), { recursive: true })
    copyFileSync(de, para)
    escritos.push(rel)
  }

  const ano = new Date().getFullYear()
  escrever(destino, 'NOTICE', moldeNotice(nome, dono, ano))
  escrever(destino, '.rebar-coautores', moldeCoautores(dono, email))
  // O README do create-next-app é boilerplate de framework, e README é a
  // primeira coisa que se vê num repositório público. Este é o único arquivo do
  // scaffold que o portão sobrescreve sem pedir licença.
  escrever(destino, 'README.md', moldeReadme(nome, dono, ano))
  escritos.push('NOTICE', '.rebar-coautores', 'README.md')

  // O .prettierignore do shadcn não conhece prosa nem licença. Acrescentar, não
  // substituir: o que ele já lista (.next/, coverage/) continua valendo.
  const ignore = lerSe(destino, '.prettierignore')
  if (ignore !== null && !ignore.includes('LICENSE')) {
    const nota =
      '# Prosa e texto legal ficam fora. O prettier reflui markdown e a licença,\n' +
      '# e um diff de milhares de linhas esconde a mudança real.\n'
    escrever(
      destino,
      '.prettierignore',
      `${ignore.replace(/\s*$/, '')}\n\n${nota}*.md\nLICENSE\nNOTICE\n`,
    )
    escritos.push('.prettierignore')
  }

  const exportEstatico = garantirExportEstatico(destino, avisos)
  const elos = garantirScripts(destino, avisos)
  escritos.push('next.config.ts', 'package.json')

  return { escritos, avisos, elos, exportEstatico }
}

export { marcarExecutaveis, PASTA_HOOKS, EXECUTAVEIS }
