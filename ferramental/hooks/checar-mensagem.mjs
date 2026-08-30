#!/usr/bin/env node
// Barra coautoria NÃO HUMANA na mensagem que está sendo escrita.
//
// Por que existe além do passo no pre-commit: `rebar-check --regra=coautoria-ia`
// lê `git log`, e o commit em curso ainda não está lá. Aquele passo barra o
// PRÓXIMO commit — impede o trailer de ficar, não de entrar. Como o objetivo
// declarado do rebar é "ignorar uma regra quebra o commit", faltava a metade
// que roda antes de o commit existir. É esta.
//
// Uma vez no histórico, o trailer só sai reescrevendo o histórico. Medido: o
// alicerce tem 11 de 11 commits com coautoria e não dá para limpar sem force.
//
// ── INVERSÃO DE POLÍTICA (2026-08-30) ──────────────────────────────────────
//
// Este arquivo enumerava 9 agentes numa regex. A auditoria montou um repositório
// em tmpdir com este mesmo hook instalado e passou SEIS agentes de uma vez:
//
//   Windsurf, ChatGPT, Cody, Codeium, Amazon Q, Tabnine  ->  hook exit 0 nos seis
//
// e o `git log --format=%(trailers:key=Co-authored-by)` devolveu os seis
// trailers, um por commit. Não é falha de regex: é falha de FORMA. Enumerar
// agente de IA é uma corrida que se perde toda semana; enumerar os humanos do
// projeto é uma lista curta que muda uma vez por ano. Agora passa quem está em
// `.rebar-coautores` na raiz do repositório, e mais ninguém.
//
// ── SEGUNDO FURO: O CONTRABANDO ABAIXO DA TESOURA ──────────────────────────
//
// A versão anterior cortava o texto em
//   # ------------------------ >8 ------------------------
// para não acusar o diff que o `git commit -v` cola ali. Só que o git remove a
// tesoura POR SER COMENTÁRIO e MANTÉM o que vier depois. Medido no mesmo ataque:
// um `Co-authored-by: Claude <noreply@anthropic.com>` escrito abaixo da tesoura
// passou pelo hook com exit 0 e apareceu no `%(trailers)` do commit — o próprio
// agente que a lista de 9 nomeava, entrando pela porta que a lista não olhava.
//
// O conserto é parar de reimplementar as regras de trailer do git à mão:
//
//   git stripspace --strip-comments   |   git interpret-trailers --parse
//
// O primeiro é a MESMA limpeza que o `cleanup=strip` do commit aplica (respeita
// inclusive um `core.commentChar` trocado, que o corte à mão não respeitava); o
// segundo é o git dizendo o que ele considera trailer, com dobramento de linha
// resolvido. Medido nos dois lados que importam:
//
//   trailer abaixo da tesoura        -> stripspace+parse ACHA   (o furo fecha)
//   diff colado pelo `git commit -v` -> stripspace+parse NÃO ACHA (sem falso +)
//
// O `interpret-trailers` SOZINHO, sem o stripspace antes, devolve vazio para o
// trailer abaixo da tesoura — foi medido. Os dois comandos, nesta ordem.
//
// Chamado pelo hook commit-msg com o caminho do arquivo de mensagem.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NOME_ALLOWLIST = '.rebar-coautores'

// fileURLToPath, não .pathname: no Windows o pathname vem como "/C:/Users/...",
// com barra antes da letra do drive, e o join sai em C:\C:\Users\...
const AQUI = dirname(fileURLToPath(import.meta.url))

function rodarGit(args, entrada) {
  return execFileSync('git', args, {
    input: entrada,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * Raiz do repositório. Pergunta ao git; se o git não responder, cai para dois
 * níveis acima deste arquivo — ele mora em `<raiz>/ferramental/hooks/`, e essa
 * é a única suposição de layout que o hook faz.
 */
function raizDoRepo() {
  try {
    const saida = rodarGit(['rev-parse', '--show-toplevel']).trim()
    if (saida) return saida
  } catch {
    /* sem git: cai para o layout conhecido */
  }
  return join(AQUI, '..', '..')
}

const emailDe = (valor) => {
  // `Nome <email>` é a forma normal; `email` cru também vale, para quem escreve
  // a allowlist só com o endereço. Caixa baixa porque e-mail não distingue.
  const m = /<([^<>]*)>/.exec(valor)
  const bruto = (m ? m[1] : valor).trim().toLowerCase()
  return bruto.includes('@') ? bruto : null
}

/**
 * Lê a allowlist do disco, e não do índice do git: no momento do commit-msg o
 * arquivo pode estar sendo editado no mesmo commit, e exigir que ele já esteja
 * em HEAD tornaria impossível o commit que ADICIONA um humano à lista. Quem
 * cobra o rastreamento é o rebar-check, que audita depois e vê o histórico.
 */
function lerAllowlist(raiz) {
  const caminho = join(raiz, NOME_ALLOWLIST)
  let texto
  try {
    texto = readFileSync(caminho, 'utf8')
  } catch (e) {
    return { caminho, emails: null, erro: e.code === 'ENOENT' ? 'não existe' : e.code || e.message }
  }
  const emails = new Set()
  for (const linha of texto.split(/\r?\n/)) {
    const l = linha.trim()
    if (!l || l.startsWith('#')) continue
    const e = emailDe(l)
    if (e) emails.add(e)
  }
  return { caminho, emails, erro: null }
}

/** Os trailers segundo o próprio git. Lança se o git não estiver disponível. */
function trailersPeloGit(texto) {
  const limpo = rodarGit(['stripspace', '--strip-comments'], texto)
  const saida = rodarGit(['interpret-trailers', '--parse'], limpo)
  return saida
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Plano B, usado só quando o git não responde — o que num hook de git é quase
 * impossível, mas "quase" não é "nunca" e o hook não pode virar um `catch`
 * silencioso que aprova tudo.
 *
 * Duas diferenças deliberadas em relação ao corte antigo:
 *  · NÃO corta na tesoura, porque era exatamente ali que o contrabando entrava;
 *  · exige o trailer na COLUNA 0. Toda linha de diff que o `git commit -v` cola
 *    vem prefixada por `+`, `-` ou espaço, então o falso positivo que a tesoura
 *    existia para evitar não alcança a coluna 0 de qualquer jeito.
 *
 * Em compensação este parser não sabe o que é "último parágrafo", então pode
 * acusar uma linha `Co-authored-by:` solta no meio do corpo que o git não
 * consideraria trailer. Errar para o lado de barrar é o lado certo aqui.
 */
function trailersPorContaPropria(texto) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .filter((l) => /^[A-Za-z][A-Za-z0-9-]*:/.test(l))
    .map((l) => l.trim())
}

// ───────────────────────────────────────────────────────────────────── main

const arquivo = process.argv[2]
if (!arquivo) {
  console.error('checar-mensagem: falta o caminho do arquivo de mensagem')
  process.exit(2)
}

let texto
try {
  texto = readFileSync(arquivo, 'utf8')
} catch (e) {
  console.error(`checar-mensagem: não consegui ler ${arquivo}: ${e.message}`)
  process.exit(2)
}
// CRLF normalizado antes de qualquer coisa: no Windows o editor de mensagem
// grava \r\n, e um \r pendurado no fim do valor estragaria a comparação de
// e-mail sem aparecer em lugar nenhum da saída.
texto = texto.replace(/\r\n/g, '\n')

let trailers
let caiuParaOParserProprio = false
let motivoDaQueda = ''
try {
  trailers = trailersPeloGit(texto)
} catch (e) {
  caiuParaOParserProprio = true
  motivoDaQueda =
    (e.stderr || e.message || '').toString().trim().split('\n')[0] || 'git indisponível'
  trailers = trailersPorContaPropria(texto)
}

if (caiuParaOParserProprio) {
  console.error(
    `[coautoria] aviso: não consegui usar o git para ler os trailers (${motivoDaQueda}).\n` +
      '           Caí para o parser próprio deste arquivo, que é mais burro que o git:\n' +
      '           não entende dobramento de linha nem "último parágrafo".',
  )
}

const coautores = trailers
  .filter((t) => /^co-authored-by\s*:/i.test(t))
  .map((t) => ({ linha: t, email: emailDe(t.slice(t.indexOf(':') + 1)) }))

if (!coautores.length) process.exit(0)

const { caminho, emails, erro } = lerAllowlist(raizDoRepo())

// Sem allowlist, TODO coautor é barrado. Fail-closed: a alternativa seria
// aprovar tudo quando o arquivo some, e apagar um arquivo não pode ser o jeito
// mais fácil de desligar a regra.
const forasteiros = emails ? coautores.filter((x) => !x.email || !emails.has(x.email)) : coautores

if (!forasteiros.length) process.exit(0)

console.error('\n[coautoria] trailer de coautoria fora da allowlist de humanos:\n')
for (const x of forasteiros) console.error(`  ${x.linha}`)

if (erro) {
  console.error(
    `\nE não há allowlist para consultar: ${caminho} — ${erro}.\n` +
      'Enquanto ela não existir, NENHUM Co-authored-by passa.',
  )
} else {
  console.error(
    `\nHumanos aceitos (${emails.size}), lidos de ${caminho}:\n` +
      [...emails].map((e) => `  ${e}`).join('\n'),
  )
}

console.error(
  '\nA política é uma ALLOWLIST de humanos, não uma lista de agentes de IA:\n' +
    'a lista de agentes tinha 9 nomes e seis agentes atuais passaram por ela\n' +
    'num único ataque. Se este coautor é uma pessoa do projeto, acrescente o\n' +
    `e-mail dela em ${NOME_ALLOWLIST} — no mesmo commit, se quiser.\n\n` +
    'Se é uma IA, tire a linha e comite de novo. Na raiz, o conserto é não\n' +
    'gerar o trailer:\n' +
    '  .claude/settings.json  ->  { "includeCoAuthoredBy": false }\n' +
    'Assim a string nunca existe, e não há falso positivo a discutir.\n',
)
process.exit(1)
