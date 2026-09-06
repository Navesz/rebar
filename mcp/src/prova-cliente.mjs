#!/usr/bin/env node
// Cliente mínimo de MCP — a prova de que este servidor RODA.
//
// Por que existe. O módulo mcp/ estava no disco há dias, 1.412 linhas, e NUNCA tinha
// sido executado: as dependências jamais foram instaladas, nenhum passo do verificar
// o tocava, nenhuma regra o cobria. "Escrito" não é "funcional", e a única forma de
// saber a diferença é falar o protocolo de verdade com ele.
//
// ZERO DEPENDÊNCIA de propósito, mesmo dentro de um pacote que pode ter dependência:
// se eu provasse o servidor com o SDK que o próprio servidor usa, um defeito do SDK
// se cancelaria dos dois lados. Aqui só entra node:child_process e JSON.
//
// O transporte stdio do MCP é JSON-RPC 2.0 em NDJSON — uma mensagem por linha, sem
// enquadramento Content-Length (isso é LSP, e confundir os dois é o erro clássico).
//
//   node mcp/src/prova-cliente.mjs           roda tudo e imprime as trocas reais
//   node mcp/src/prova-cliente.mjs --curto   só o veredito de cada passo

import { spawn } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// O cliente mora fora deste arquivo desde que apareceu a segunda prova que
// precisa dele — a do MCP que o gerador escreve, em new/gate/prove-mcp-template.mjs.
import { Cliente, PROTOCOLO, textoDa, trecho } from './cliente-jsonrpc.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SERVIDOR = join(AQUI, 'index.mjs')
const RAIZ = join(AQUI, '..', '..')
const LEIAME = join(AQUI, '..', 'README.md')
const CURTO = process.argv.includes('--curto')

let falhas = 0

function titulo(t) {
  console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
}

function ok(t) {
  console.log(`  ok   ${t}`)
}

function falhou(t) {
  falhas++
  console.log(`  FALHA ${t}`)
}

// ─────────────────────────────────────────────────────────────────────────────

titulo('1 · handshake: initialize + notifications/initialized')
const cliente = new Cliente(SERVIDOR, { curto: CURTO })

const ini = await cliente.pedir('initialize', {
  protocolVersion: PROTOCOLO,
  capabilities: {},
  clientInfo: { name: 'prova-cliente-do-rebar', version: '1.0.0' },
})
if (ini.result?.serverInfo?.name === 'rebar') {
  ok(
    `servidor "${ini.result.serverInfo.name}" v${ini.result.serverInfo.version}, protocolo ${ini.result.protocolVersion}`,
  )
} else {
  falhou(`initialize devolveu ${JSON.stringify(ini).slice(0, 200)}`)
}
cliente.notificar('notifications/initialized', {})

titulo('2 · tools/list')
const lista = await cliente.pedir('tools/list', {})
const ferramentas = lista.result?.tools ?? []
if (ferramentas.length) {
  for (const f of ferramentas) {
    console.log(
      `  · ${f.name.padEnd(16)} ${Object.keys(f.inputSchema?.properties ?? {}).join(', ') || '(sem parâmetro)'}`,
    )
  }
  ok(`${ferramentas.length} ferramentas`)
} else {
  falhou('tools/list veio vazio')
}

// Cada chamada abaixo é uma pergunta que uma IA de verdade faz neste
// repositório, e o QUARTO campo é o contrato: esta chamada deve devolver
// `isError`, sim ou não?
//
// Antes ele não existia, e `isError` só escolhia um RÓTULO — o do único caso
// que deveria errar ("esperado para id errado"), colado em qualquer erro de
// qualquer uma das sete. Se o `rebar_verificar` passasse a estourar, a prova
// imprimia um `ok` com aquele rótulo emprestado e o passo `mcp-server` ficava
// verde sobre um servidor quebrado.
const chamadas = [
  ['rebar_regras', { nivel: 'N1' }, 'o que me reprova quando eu mexer no CSS/lint', false],
  ['rebar_porque', { id: 'raw-hex' }, 'reprovou hex-cru; por que isso é regra', false],
  ['rebar_decidir', { assunto: 'cor' }, 'posso escrever #fff no componente?', false],
  ['rebar_decidir', { assunto: 'mongodb' }, 'assunto que o rebar NÃO governa', false],
  ['rebar_portao', { passo: 'mcp' }, 'o passo do portão que guarda este módulo', false],
  ['rebar_verificar', {}, 'a régua no próprio rebar', false],
  // Os dois que devem errar, um para cada lado do `sugestao.length ? ... : ''`
  // em consultas.mjs — o ramo que sugere e o que não tem o que sugerir.
  //
  // A sonda daqui era `hex-crus`, com o rótulo "precisa sugerir". Medido: ela
  // parou de sugerir quando os ids foram para o inglês, porque `hex-` deixou de
  // ser prefixo de coisa alguma — a regra virou `raw-hex`. O rótulo continuou
  // afirmando o contrário por seis commits, porque nada comparava. É o defeito
  // que este contrato existe para não deixar acontecer de novo.
  ['rebar_porque', { id: 'raw-hexx' }, 'typo de id real: erra sugerindo o certo', true, 'raw-hex'],
  [
    'rebar_porque',
    { id: 'mongodb-driver' },
    'id de outro mundo: erra sem inventar vizinho',
    true,
    null,
  ],
]

for (const [nome, args, pergunta, erroEsperado, vizinho] of chamadas) {
  titulo(`3 · tools/call ${nome} ${JSON.stringify(args)}   — "${pergunta}"`)
  const r = await cliente.pedir('tools/call', { name: nome, arguments: args })
  const t = textoDa(r)
  if (!t) {
    falhou(`${nome} não devolveu texto`)
    continue
  }
  console.log(`\n${trecho(t, nome === 'rebar_porque' ? 2200 : 1600)}\n`)

  // O CONTRATO, nas duas direções. Errar quando não devia é servidor quebrado;
  // NÃO errar quando devia é contrato silenciosamente afrouxado — um `id`
  // inexistente que passa a responder como se existisse é pior que o erro.
  const erro = r.result.isError === true
  if (erro !== erroEsperado) {
    falhou(
      erroEsperado
        ? `${nome} devia ter devolvido isError e não devolveu — o contrato de id inexistente afrouxou`
        : `${nome} devolveu isError e não devia:\n${trecho(t, 400)}`,
    )
    continue
  }

  // Quem erra tem contrato EXTRA: "não morrer" é metade dele. O quinto campo diz
  // qual vizinho a mensagem deve oferecer — ou `null` quando o certo é não
  // oferecer nenhum. As duas direções importam: sugerir nada quando havia um id
  // parecido é o agente sem saída, e inventar um vizinho para um id de outro
  // assunto é pior que o erro seco.
  if (erroEsperado) {
    const sugeriu = /^Perto disso: (.+)$/m.exec(t)
    if (vizinho && sugeriu?.[1]?.split(', ').includes(vizinho) !== true) {
      falhou(`${nome} devia apontar "${vizinho}" e não apontou:\n${trecho(t, 400)}`)
      continue
    }
    if (!vizinho && sugeriu) {
      falhou(`${nome} inventou vizinho para um id de outro assunto: ${sugeriu[0]}`)
      continue
    }
    // A saída sempre existe, com vizinho ou sem.
    if (!t.includes('rebar_regras')) {
      falhou(`${nome} errou sem dizer onde está a lista completa`)
      continue
    }
  }

  ok(`${nome}${erro ? ' (isError, como o contrato exige)' : ''} — ${t.length} caracteres`)
}

cliente.fechar()

/**
 * Monta um repositório de mentira com uma cópia do servidor dentro, para testar o que
 * só dá para testar mexendo no disco.
 *
 * A cópia mora fora do repositório de verdade de propósito: os passos 4 e 6 precisam
 * de um artefato ausente e de uma fonte adulterada, e nenhum dos dois pode acontecer
 * em cima do rebar — o dono trabalha nele e outro agente também.
 *
 * A árvore imita a de verdade porque o servidor resolve tudo a partir da posição dele:
 * <raiz>/mcp/src/index.mjs → RAIZ = <raiz>. node_modules entra por junção, que no
 * Windows não pede admin e no Linux é symlink comum: o que se testa aqui é o JSON,
 * não a presença do SDK.
 */
function montarCopia(
  prefixo,
  { comArtefato = true, fonteAdulterada = false, semFonte = null } = {},
) {
  const base = mkdtempSync(join(tmpdir(), prefixo))
  const src = join(base, 'mcp', 'src')
  mkdirSync(src, { recursive: true })
  for (const f of ['index.mjs', 'artefato.mjs', 'consultas.mjs']) {
    copyFileSync(join(AQUI, f), join(src, f))
  }
  symlinkSync(join(AQUI, '..', 'node_modules'), join(base, 'mcp', 'node_modules'), 'junction')
  if (comArtefato) {
    copyFileSync(
      join(AQUI, '..', 'rules.generated.json'),
      join(base, 'mcp', 'rules.generated.json'),
    )
  }
  if (fonteAdulterada) {
    const dir = join(base, 'tooling', 'rebar-check')
    mkdirSync(dir, { recursive: true })
    // Conteúdo diferente do original: é isso, e só isso, que o sha256 enxerga.
    writeFileSync(join(dir, 'index.mjs'), '// uma regra nova entrou aqui e o MCP não sabe\n')
  }
  if (semFonte) {
    // Todas as fontes de arquivo copiadas IDÊNTICAS, menos uma, que fica de
    // fora. Idênticas de propósito: se alguma divergisse, o estado seria
    // `suspeito` e a ausência ficaria escondida atrás dela.
    const art = JSON.parse(readFileSync(join(AQUI, '..', 'rules.generated.json'), 'utf8'))
    for (const f of art.fontes) {
      if (f.arquivo.endsWith('/') || f.arquivo === semFonte) continue
      const partes = f.arquivo.split('/')
      const destino = join(base, ...partes)
      mkdirSync(dirname(destino), { recursive: true })
      copyFileSync(join(RAIZ, ...partes), destino)
    }
  }
  return { base, servidor: join(src, 'index.mjs') }
}

/**
 * Desmonta a cópia — a junção PRIMEIRO, e com `rmdirSync`, não com `rmSync`.
 *
 * Uma junção do Windows é uma pasta de verdade para quem só olha, e apagar
 * recursivamente uma árvore que tem uma dentro é a receita para levar junto o
 * `mcp/node_modules` do repositório. `rmdirSync` remove a junção e para ali —
 * conferido antes de escrever isto: o alvo continuou intacto.
 */
function desmontarCopia(base) {
  try {
    rmdirSync(join(base, 'mcp', 'node_modules'))
    rmSync(base, { recursive: true, force: true })
  } catch {
    // Cópia de teste largada em %TEMP% não estraga nada, e o sistema limpa. Falhar a
    // prova por causa da faxina seria trocar o defeito real por ruído.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · o servidor sem artefato tem de MORRER, não servir vazio.
titulo('4 · sem artefato: o servidor morre com mensagem útil')
let semArtefato
try {
  semArtefato = montarCopia('rebar-mcp-sem-artefato-', { comArtefato: false })
} catch (e) {
  falhou(`não deu para montar a cópia de teste: ${e.message}`)
}

if (semArtefato) {
  const morto = spawn(process.execPath, [semArtefato.servidor], { windowsHide: true })
  let saidaDeErro = ''
  morto.stderr.setEncoding('utf8')
  morto.stderr.on('data', (d) => {
    saidaDeErro += d
  })
  const codigo = await new Promise((resolve) => morto.on('close', resolve))
  console.log(saidaDeErro.trimEnd())
  console.log(`\n  exit=${codigo}`)
  const util =
    saidaDeErro.includes('node mcp/generate.mjs') && saidaDeErro.includes('rules.generated.json')
  if (codigo === 1 && util) ok('morreu com exit 1 e disse como gerar o artefato')
  else falhou(`esperado exit 1 com o comando de geração na mensagem; veio exit ${codigo}`)
  desmontarCopia(semArtefato.base)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · o snippet do README tem de FUNCIONAR.
//
// Um MCP só serve se estiver configurado, e configuração errada falha calada: o
// Claude Code simplesmente não lista a ferramenta, e ninguém liga o silêncio ao
// caminho trocado. Então o snippet não é copiado para cá — é LIDO do README e
// EXECUTADO. Se alguém mover mcp/src/index.mjs e esquecer o README, esta prova
// reprova. É o mesmo princípio do resto do módulo: derive, não duplique.
titulo('5 · o snippet de .mcp.json do README sobe o servidor')
const fence = /```json\n([\s\S]*?)```/.exec(readFileSync(LEIAME, 'utf8'))
if (!fence) {
  falhou('não achei bloco ```json no mcp/README.md')
} else {
  const config = JSON.parse(fence[1])
  const entrada = config.mcpServers?.rebar
  console.log(`  cwd: raiz do repositório`)
  console.log(`  ${JSON.stringify(entrada)}`)
  if (entrada?.command !== 'node') {
    falhou(`o snippet chama "${entrada?.command}"; tem de ser "node" (npx no Windows dá ENOENT)`)
  }
  const doSnippet = new Cliente(null, { comando: entrada, cwd: RAIZ, curto: CURTO })
  try {
    const r = await doSnippet.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-do-snippet', version: '1.0.0' },
    })
    const t = await doSnippet.pedir('tools/list', {})
    const n = t.result?.tools?.length ?? 0
    if (r.result?.serverInfo?.name === 'rebar' && n === ferramentas.length) {
      ok(`o snippet sobe o servidor e lista as mesmas ${n} ferramentas`)
    } else {
      falhou(`o snippet subiu algo diferente: ${JSON.stringify(r.result?.serverInfo)}, ${n} tools`)
    }
  } catch (e) {
    falhou(`o snippet não subiu o servidor: ${e.message}\n${doSnippet.stderr.trim()}`)
  }
  doSnippet.fechar()
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · fonte mudou, artefato não: TODA resposta tem de vir com o aviso.
//
// É o defeito do Herz reproduzido de propósito — a regra muda e o MCP continua
// servindo a versão velha. A autoridade sobre isso é o portão (`gerar.mjs
// --verificar`); o servidor só compara o sha256 que o artefato gravou em `fontes[]`
// com o hash do arquivo hoje. Sinal fraco, mas nunca falso negativo: se a regra
// mudou, o hash mudou.
//
// O aviso vai grudado na RESPOSTA, não numa tool de status, e é isso que este passo
// prova: uma tool de status só fala quando alguém pergunta, e o modelo não pergunta.
titulo('6 · fonte adulterada: o aviso de frescor cola em toda resposta')
let velho
try {
  velho = montarCopia('rebar-mcp-velho-', { fonteAdulterada: true })
} catch (e) {
  falhou(`não deu para montar a cópia de teste: ${e.message}`)
}

if (velho) {
  const c = new Cliente(velho.servidor, { curto: CURTO })
  try {
    await c.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-de-frescor', version: '1.0.0' },
    })
    c.notificar('notifications/initialized', {})
    const r = await c.pedir('tools/call', {
      name: 'rebar_regras',
      arguments: { busca: 'readme' },
    })
    const t = textoDa(r)
    console.log(`\n${trecho(t, 700)}\n`)
    if (t.startsWith('AVISO DE FRESCOR') && t.includes('tooling/rebar-check/index.mjs')) {
      ok('o aviso veio na frente da resposta, nomeando o arquivo que mudou')
    } else {
      falhou('a resposta veio sem aviso de frescor')
    }
  } catch (e) {
    falhou(`${e.message}\n${c.stderr.trim()}`)
  }
  c.fechar()
  desmontarCopia(velho.base)
}

titulo('7 · fonte AUSENTE: "em dia" não pode sair de árvore incompleta')
{
  // P2 #10. O estado era binário na prática: mudou (suspeito) ou não mudou (em
  // dia), e "não achei o arquivo" caía no segundo. Enquanto as fontes eram só
  // as quatro de formato isso ainda era defensável; depois que as decisões
  // viraram fonte, deixou de ser — apagar o `new/index.mjs` faria o servidor
  // colar uma decisão derivada de um arquivo que não está mais lá e afirmar que
  // está em dia.
  const semDecisao = montarCopia('rebar-mcp-parcial-', { semFonte: 'new/index.mjs' })
  const c = new Cliente(semDecisao.servidor, { curto: CURTO })
  try {
    await c.apresentar('prova-de-fonte-ausente')
    const r = await c.pedir('tools/call', {
      name: 'rebar_regras',
      arguments: { busca: 'readme' },
    })
    const texto = textoDa(r)
    if (!/AVISO DE FRESCOR/.test(texto)) {
      falhou('árvore sem uma das fontes respondeu sem aviso nenhum')
    } else if (!/new\/index\.mjs/.test(texto)) {
      falhou(`o aviso não nomeia a fonte que falta:\n${trecho(texto, 300)}`)
    } else {
      ok('o aviso veio, nomeando a fonte ausente')
    }
    // E o que É conferível continua sendo conferido: nada de divergência
    // inventada só porque um arquivo faltou.
    if (/mudou desde que o artefato foi gerado/.test(texto)) {
      falhou('ausência foi relatada como divergência — são coisas diferentes')
    }
  } finally {
    await c.fechar()
    desmontarCopia(semDecisao.base)
  }
}

titulo(falhas ? `${falhas} FALHA(S)` : 'tudo passou')
process.exit(falhas ? 1 : 0)
