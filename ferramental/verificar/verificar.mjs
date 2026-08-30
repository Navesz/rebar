#!/usr/bin/env node
// verificar — o comando único do rebar. Roda a sequência declarada em
// verificar.config.mjs e devolve UM veredito, com saída curta o bastante para
// caber num contexto de IA sem custar uma leitura inteira.
//
// Zero dependência, de propósito: o que confere o build não pode depender do
// build. Roda com `node ferramental/verificar/verificar.mjs` em qualquer
// máquina com Node >= 18 e git, antes de existir toolchain.
//
// Uso:
//   node ferramental/verificar/verificar.mjs             roda TUDO
//   node ferramental/verificar/verificar.mjs --json      saída para máquina
//   node ferramental/verificar/verificar.mjs --passo=X   recorte de diagnóstico
//   node ferramental/verificar/verificar.mjs --config=<caminho>
//
// CÓDIGOS DE SAÍDA — cinco coisas diferentes, cinco códigos diferentes:
//   0    todos os passos rodaram e todos passaram. Só aqui existe APROVADO.
//   1    REPROVOU: um passo rodou até o fim e disse não.
//   2    erro de configuração, ou invocação errada.
//   3    PARCIAL: rodou um recorte (--passo=). Não é aprovação.
//   127  QUEBROU: não deu para EXECUTAR um passo — comando ausente, falha de
//        spawn, tempo limite. Defeito do ferramental, não do repositório.
//
// A distinção entre 1 e 127 é a mesma do rebar-check: sem ela, o bug do
// verificador entra na conta como se fosse defeito do repositório auditado.
//
// ─── AS DUAS PORTAS QUE O ALICERCE DEIXOU DESTRANCADAS, aqui trancadas ───
//
// FURO 1 — o campo `opcional`. No alicerce a decisão de reprovar era
// `resultados.some(r => !r.ok && !r.opcional && !r.pulado)`. Consequência: um
// passo com `opcional:true` que FALHAVA imprimia "VERIFICAR — APROVADO" e saía
// 0. Uma palavra transformava qualquer portão em aviso verde. Aqui `opcional`
// não é ignorado: é ERRO DE CONFIGURAÇÃO (exit 2), recusado pelo nome em
// validarPassos(). Passo que não deve bloquear não é passo do verificar.
//
// FURO 2 — `--passo=<nome>`. Medido no alicerce: `node verificar.mjs
// --passo=elos` imprimiu "VERIFICAR — APROVADO", exit 0, tendo rodado 1 de 6
// passos, sem uma palavra sobre os 5 que não rodaram. Qualquer CI fica verde de
// graça. Aqui o recorte imprime "PARCIAL — 1 de N passos · NÃO É APROVAÇÃO",
// lista nominalmente quem não rodou, e sai 3. Aprovação só existe quando o
// denominador inteiro rodou.
//
// Terceira porta, fechada de nascença: não existe abortar-no-primeiro-erro.
// Pular passo é a mecânica que produz falso verde; aqui todo passo selecionado
// sempre roda até o fim. A ordem barato-antes-de-caro do config continua
// valendo — ela decide qual falha é reportada como "conserte primeiro".

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIMITE_LINHAS_PADRAO = 6
const LARGURA_MAXIMA_LINHA = 160
const TEMPO_LIMITE_PADRAO = 5 * 60 * 1000

// ── invocação ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const opcoes = {
  json: args.includes('--json'),
  passo: args.find((a) => a.startsWith('--passo='))?.slice('--passo='.length),
  config: args.find((a) => a.startsWith('--config='))?.slice('--config='.length),
}

const cor = process.stdout.isTTY && !process.env.NO_COLOR && !opcoes.json
const c = {
  verde: (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s),
  vermelho: (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s),
  amarelo: (s) => (cor ? `\x1b[33m${s}\x1b[0m` : s),
  cinza: (s) => (cor ? `\x1b[90m${s}\x1b[0m` : s),
  forte: (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s),
}

class ErroDeConfiguracao extends Error {}

// Argumento posicional silenciosamente ignorado é como se pede uma coisa e se
// recebe outra com exit 0. Aqui qualquer coisa fora do vocabulário sai 2.
const desconhecidos = args.filter((a) => !/^--(json|passo=|config=)/.test(a))
if (desconhecidos.length) {
  console.error(`\n${c.vermelho('VERIFICAR — INVOCAÇÃO ERRADA')}\n`)
  console.error(`  não reconheço: ${desconhecidos.join(', ')}`)
  console.error(`  aceito: --json · --passo=<nome> · --config=<caminho>\n`)
  process.exit(2)
}

// ── configuração ────────────────────────────────────────────────────────────

const CHAVES_VALIDAS = new Set([
  'nome', 'comando', 'funcao', 'dica', 'extrair', 'limite', 'tempoLimite', 'exige',
])

async function carregarConfig() {
  let arquivo
  if (opcoes.config) {
    arquivo = resolve(process.cwd(), opcoes.config)
    if (!existsSync(arquivo)) {
      throw new ErroDeConfiguracao(`--config=${opcoes.config} não existe (procurei em ${arquivo}).`)
    }
  } else {
    // Sobe a árvore até achar. Rodar de dentro de ferramental/ é comum e não
    // pode mudar o veredito: os comandos dos passos são relativos à raiz, e a
    // raiz passa a ser a pasta do config, não o cwd de quem chamou.
    let dir = process.cwd()
    for (;;) {
      const tentativa = join(dir, 'verificar.config.mjs')
      if (existsSync(tentativa)) { arquivo = tentativa; break }
      const pai = dirname(dir)
      if (pai === dir) break
      dir = pai
    }
    if (!arquivo) {
      throw new ErroDeConfiguracao(
        `Nenhum verificar.config.mjs de ${process.cwd()} até a raiz do disco.`)
    }
  }

  let modulo
  try {
    modulo = await import(pathToFileURL(arquivo).href)
  } catch (e) {
    throw new ErroDeConfiguracao(`${arquivo} não carregou:\n  ${e.message}`)
  }
  const passos = modulo.default
  if (!Array.isArray(passos) || passos.length === 0) {
    throw new ErroDeConfiguracao(`${arquivo} precisa exportar como default um array não vazio de passos.`)
  }
  return { passos, arquivo, raiz: dirname(arquivo) }
}

function validarPassos(passos, arquivo) {
  const problemas = []
  const nomes = new Set()

  passos.forEach((p, i) => {
    const onde = `passo #${i + 1}${p?.nome ? ` (${p.nome})` : ''}`
    if (typeof p !== 'object' || p === null) { problemas.push(`${onde}: não é objeto.`); return }

    // FURO 1. A checagem é pelo NOME da chave, antes de qualquer outra coisa,
    // porque o objetivo não é ignorar o campo — é impedir que alguém o escreva
    // achando que funciona e saia daqui com um portão desligado e verde.
    if ('opcional' in p) {
      problemas.push(
        `${onde}: o campo "opcional" não existe no rebar. No alicerce ele fazia um ` +
        `passo FALHAR e mesmo assim imprimir APROVADO com exit 0. Passo que não ` +
        `bloqueia não é passo do verificar: tire-o da lista.`)
    }
    if ('pulado' in p || 'grupo' in p) {
      problemas.push(`${onde}: "pulado"/"grupo" não existem — todo passo selecionado sempre roda.`)
    }
    for (const k of Object.keys(p)) {
      if (!CHAVES_VALIDAS.has(k) && k !== 'opcional' && k !== 'pulado' && k !== 'grupo') {
        problemas.push(`${onde}: chave desconhecida "${k}". Válidas: ${[...CHAVES_VALIDAS].join(', ')}.`)
      }
    }

    if (typeof p.nome !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.nome)) {
      problemas.push(`${onde}: "nome" precisa ser minúsculo, sem espaço (ex.: "sintaxe").`)
    } else if (nomes.has(p.nome)) {
      problemas.push(`${onde}: nome repetido — "--passo=${p.nome}" seria ambíguo.`)
    } else {
      nomes.add(p.nome)
    }

    const temComando = 'comando' in p
    const temFuncao = 'funcao' in p
    if (temComando === temFuncao) {
      problemas.push(`${onde}: declare "comando" (array) OU "funcao", exatamente um dos dois.`)
    }
    if (temComando) {
      // Array, nunca string: string exige shell, e shell no Windows é cmd.exe
      // com regra de aspas própria. Foi execFileSync('npx', ...) sem shell:true
      // que quebrou o alicerce nesta máquina. Sem shell não há o que escapar.
      if (!Array.isArray(p.comando) || p.comando.length === 0 ||
          p.comando.some((a) => typeof a !== 'string' || a.length === 0)) {
        problemas.push(`${onde}: "comando" precisa ser array de strings não vazias, ex.: [process.execPath, "x.mjs"].`)
      }
    }
    if (temFuncao && typeof p.funcao !== 'function') {
      problemas.push(`${onde}: "funcao" precisa ser função.`)
    }
    if ('extrair' in p && !(p.extrair instanceof RegExp)) {
      problemas.push(`${onde}: "extrair" precisa ser RegExp.`)
    }
    if ('exige' in p && (!Array.isArray(p.exige) || p.exige.some((a) => typeof a !== 'string'))) {
      problemas.push(`${onde}: "exige" precisa ser array de caminhos relativos à raiz.`)
    }
    for (const k of ['limite', 'tempoLimite']) {
      if (k in p && (!Number.isInteger(p[k]) || p[k] <= 0)) {
        problemas.push(`${onde}: "${k}" precisa ser inteiro positivo.`)
      }
    }
    if ('dica' in p && typeof p.dica !== 'string') problemas.push(`${onde}: "dica" precisa ser string.`)
  })

  if (problemas.length) {
    throw new ErroDeConfiguracao(`${arquivo}\n\n  ` + problemas.join('\n  '))
  }
}

// ── execução ────────────────────────────────────────────────────────────────
//
// Três desfechos possíveis por passo, e eles NÃO são a mesma coisa:
//   { estado: 'passou'   }   rodou até o fim e devolveu 0
//   { estado: 'reprovou' }   rodou até o fim e devolveu != 0
//   { estado: 'quebrou'  }   nem chegou a dar veredito

function executarComando(passo, raiz) {
  return new Promise((resolvePromessa) => {
    const inicio = Date.now()
    const tempoLimite = passo.tempoLimite ?? TEMPO_LIMITE_PADRAO
    let filho
    try {
      filho = spawn(passo.comando[0], passo.comando.slice(1), {
        cwd: raiz,
        // Muita ferramenta enfeita a saída quando enxerga TTY, e o enfeite
        // atrapalha a extração. Aqui a saída é sempre capturada, sempre crua.
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      resolvePromessa({ estado: 'quebrou', saida: `falha ao iniciar: ${e.message}`, duracaoMs: 0 })
      return
    }

    let saida = ''
    // Ferramenta que despeja megabytes existe. 1 MB já é mais do que suficiente
    // para extrair as primeiras linhas de erro.
    const acumular = (pedaco) => { if (saida.length < 1_000_000) saida += String(pedaco) }
    filho.stdout.on('data', acumular)
    filho.stderr.on('data', acumular)

    let encerrado = false
    const relogio = setTimeout(() => {
      if (encerrado) return
      encerrado = true
      filho.kill('SIGKILL')
      resolvePromessa({
        estado: 'quebrou',
        saida: `${saida}\n[verificar] tempo limite de ${tempoLimite} ms estourado — passo morto sem veredito`,
        duracaoMs: Date.now() - inicio,
      })
    }, tempoLimite)
    relogio.unref()

    filho.on('error', (e) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)
      // ENOENT aqui é o executável não existir. Isso é defeito do ferramental,
      // nunca "o repositório reprovou".
      resolvePromessa({
        estado: 'quebrou',
        saida: `${saida}\n[verificar] falha ao executar ${passo.comando[0]}: ${e.message}`,
        duracaoMs: Date.now() - inicio,
      })
    })

    filho.on('close', (codigo) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)
      resolvePromessa({
        estado: (codigo ?? 1) === 0 ? 'passou' : 'reprovou',
        codigo: codigo ?? 1,
        saida,
        duracaoMs: Date.now() - inicio,
      })
    })
  })
}

async function executarFuncao(passo, raiz) {
  const inicio = Date.now()
  const tempoLimite = passo.tempoLimite ?? TEMPO_LIMITE_PADRAO
  const prazo = inicio + tempoLimite

  // O relógio só vence se a função devolver o controle ao loop de eventos. Uma
  // função que bloqueia (execFileSync num laço, que é o caso do passo `sintaxe`)
  // precisa consultar `prazo` ela mesma — por isso ele vai no argumento.
  const relogio = new Promise((res) => {
    const t = setTimeout(() => res({ estado: 'quebrou', saida: `[verificar] tempo limite de ${tempoLimite} ms estourado` }), tempoLimite)
    t.unref()
  })

  const trabalho = (async () => {
    try {
      const r = await passo.funcao({ raiz, prazo })
      const codigo = Number(r?.codigo ?? 0)
      return { estado: codigo === 0 ? 'passou' : 'reprovou', codigo, saida: String(r?.saida ?? '') }
    } catch (e) {
      return { estado: 'quebrou', saida: `[verificar] a função do passo lançou: ${e.message}` }
    }
  })()

  const r = await Promise.race([trabalho, relogio])
  return { ...r, duracaoMs: Date.now() - inicio }
}

async function executar(passo, raiz) {
  for (const rel of passo.exige ?? []) {
    const alvo = isAbsolute(rel) ? rel : join(raiz, rel)
    if (!existsSync(alvo)) {
      // Script ausente não é o repositório reprovando: é o ferramental faltando.
      return { estado: 'quebrou', saida: `[verificar] arquivo exigido ausente: ${rel}`, duracaoMs: 0 }
    }
  }
  return passo.comando ? executarComando(passo, raiz) : executarFuncao(passo, raiz)
}

// ── extração de erro ────────────────────────────────────────────────────────

// A diferença entre 300 e 15 mil tokens por ciclo de correção está aqui. Uma
// ferramenta que reprova despejando 400 linhas de rastro de pilha custa uma
// leitura inteira de contexto; as mesmas 6 linhas certas custam quase nada.
const PADRAO_ERRO = /(^|\s)(error|erro|✗|✘|⚠|FAIL|failed|falhou)\b|error TS\d+|:\d+:\d+/i

function extrairErros(passo, saida) {
  const linhas = String(saida)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)

  let candidatas = passo.extrair
    ? linhas.filter((l) => passo.extrair.test(l))
    : linhas.filter((l) => PADRAO_ERRO.test(l))

  // Sem padrão reconhecido, as últimas linhas costumam ser o resumo da
  // ferramenta — mais úteis que as primeiras, que são banner.
  if (candidatas.length === 0) candidatas = linhas.slice(-LIMITE_LINHAS_PADRAO)

  const unicas = [...new Set(candidatas.map((l) => l.trim()))]
  const limite = passo.limite ?? LIMITE_LINHAS_PADRAO
  return {
    total: unicas.length,
    mostradas: unicas.slice(0, limite).map((l) =>
      l.length > LARGURA_MAXIMA_LINHA ? `${l.slice(0, LARGURA_MAXIMA_LINHA - 1)}…` : l),
  }
}

// ── relatório ───────────────────────────────────────────────────────────────

function duracao(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function relatar(veredito) {
  const { resultados, naoRodaram, parcial, declarados, duracaoMs } = veredito
  const quebrados = resultados.filter((r) => r.estado === 'quebrou')
  const reprovados = resultados.filter((r) => r.estado === 'reprovou')
  const aprovados = resultados.filter((r) => r.estado === 'passou')

  let titulo
  if (quebrados.length) titulo = c.amarelo('QUEBROU')
  else if (reprovados.length) titulo = c.vermelho('REPROVADO')
  else if (parcial) titulo = c.amarelo('PARCIAL')
  else titulo = c.verde('APROVADO')

  const placar = `${resultados.length} de ${declarados} passos`
  console.log(`\n${c.forte('VERIFICAR')} — ${titulo}  ${c.cinza(`${placar} · ${duracao(duracaoMs)}`)}`)

  // FURO 2: a linha que o alicerce não imprimia. Ela vem ANTES dos detalhes
  // porque é a informação que muda a leitura de tudo o que vem depois.
  if (parcial) {
    console.log(`\n  ${c.amarelo(c.forte(`PARCIAL — ${resultados.length} de ${declarados} passos. NÃO É APROVAÇÃO.`))}`)
    console.log(`  ${c.cinza(`não rodaram (${naoRodaram.length}): ${naoRodaram.join(' · ')}`)}`)
    console.log(`  ${c.cinza('recorte serve para consertar, não para liberar. Rode sem --passo= antes de commitar.')}`)
  }
  console.log('')

  for (const r of [...quebrados, ...reprovados]) {
    const marca = r.estado === 'quebrou' ? c.amarelo('⚠') : c.vermelho('✗')
    const rotulo = r.estado === 'quebrou'
      ? c.amarelo('NÃO EXECUTOU')
      : (r.erros.total === 1 ? '1 erro' : `${r.erros.total} erros`)
    console.log(`  ${marca} ${r.nome.padEnd(10)} ${rotulo}  ${c.cinza(duracao(r.duracaoMs))}`)
    for (const linha of r.erros.mostradas) console.log(`      ${linha}`)
    if (r.erros.total > r.erros.mostradas.length) {
      console.log(c.cinza(`      … mais ${r.erros.total - r.erros.mostradas.length} · node ferramental/verificar/verificar.mjs --passo=${r.nome}`))
    }
    console.log('')
  }

  if (aprovados.length) console.log(`  ${c.verde('✓')} ${aprovados.map((r) => r.nome).join(' · ')}\n`)

  // O config declara do mais barato ao mais caro, então o primeiro da ordem que
  // caiu é o que se conserta primeiro — e consertar costuma apagar os de baixo.
  const primeiro = resultados.find((r) => r.estado !== 'passou')
  if (primeiro) {
    const restantes = resultados.filter((r) => r.estado !== 'passou').length - 1
    console.log(`  ${c.forte('Primeiro:')} ${primeiro.nome}.${primeiro.dica ? ` ${primeiro.dica}` : ''}`)
    if (restantes === 1) console.log(c.cinza('  O outro pode sumir junto.'))
    else if (restantes > 1) console.log(c.cinza(`  Os outros ${restantes} podem sumir junto.`))
    console.log('')
  }
}

// ── principal ───────────────────────────────────────────────────────────────

async function principal() {
  const { passos, arquivo, raiz } = await carregarConfig()
  validarPassos(passos, arquivo)

  const selecionados = opcoes.passo ? passos.filter((p) => p.nome === opcoes.passo) : passos
  if (opcoes.passo && selecionados.length === 0) {
    throw new ErroDeConfiguracao(
      `Passo "${opcoes.passo}" não existe em ${arquivo}.\n  ` +
      `Disponíveis: ${passos.map((p) => p.nome).join(', ')}`)
  }
  const parcial = selecionados.length !== passos.length
  const naoRodaram = passos.filter((p) => !selecionados.includes(p)).map((p) => p.nome)

  const resultados = []
  const inicio = Date.now()
  for (const passo of selecionados) {
    // Progresso só em terminal: em log de CI o \r não apaga nada e as linhas se
    // acumulam, sujando exatamente a saída que este script existe para encurtar.
    const mostrar = !opcoes.json && process.stdout.isTTY
    if (mostrar) process.stdout.write(c.cinza(`  … ${passo.nome}\r`))
    const r = await executar(passo, raiz)
    if (mostrar) process.stdout.write(`${' '.repeat(40)}\r`)
    resultados.push({
      nome: passo.nome,
      estado: r.estado,
      codigo: r.codigo ?? null,
      dica: passo.dica,
      duracaoMs: r.duracaoMs ?? 0,
      erros: r.estado === 'passou' ? { total: 0, mostradas: [] } : extrairErros(passo, r.saida),
    })
  }

  const veredito = {
    resultados, naoRodaram, parcial,
    declarados: passos.length,
    duracaoMs: Date.now() - inicio,
  }

  // Ordem de precedência, e ela não é arbitrária: QUEBROU domina REPROVOU
  // porque não se acusa um repositório com uma régua que não rodou. REPROVOU
  // domina PARCIAL porque um passo que rodou e disse não é veredito de verdade,
  // e escondê-lo atrás do 3 perderia informação. PARCIAL domina o 0 sempre —
  // é a porta trancada do FURO 2.
  const quebrou = resultados.some((r) => r.estado === 'quebrou')
  const reprovou = resultados.some((r) => r.estado === 'reprovou')
  const codigo = quebrou ? 127 : reprovou ? 1 : parcial ? 3 : 0

  if (opcoes.json) {
    console.log(JSON.stringify({
      resultado: quebrou ? 'quebrou' : reprovou ? 'reprovado' : parcial ? 'parcial' : 'aprovado',
      parcial,
      quando: new Date().toISOString().slice(0, 16).replace('T', ' '),
      duracaoMs: veredito.duracaoMs,
      passosDeclarados: passos.length,
      passosExecutados: resultados.length,
      naoRodaram,
      codigoSaida: codigo,
      passos: resultados.map((r) => ({
        nome: r.nome, estado: r.estado, codigo: r.codigo,
        duracaoMs: r.duracaoMs, totalErros: r.erros.total, erros: r.erros.mostradas,
      })),
    }, null, 2))
  } else {
    relatar(veredito)
  }

  process.exitCode = codigo
}

principal().catch((e) => {
  const titulo = e instanceof ErroDeConfiguracao ? 'ERRO DE CONFIGURAÇÃO' : 'ERRO INTERNO'
  console.error(`\n${c.vermelho(`VERIFICAR — ${titulo}`)}\n\n  ${e.message}\n`)
  // Config quebrada nunca é aprovação nem reprovação do repositório.
  process.exitCode = e instanceof ErroDeConfiguracao ? 2 : 127
})
