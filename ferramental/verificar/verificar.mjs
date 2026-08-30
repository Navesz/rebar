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
//
// FURO 3 — a forja de config. Auditoria de 2026-08-30: escrevi em
// $TEMP/forja.config.mjs seis passos com `funcao: () => ({ codigo: 0 })` e rodei
// `verificar.mjs --config=$TEMP/forja.config.mjs`. Saída: "VERIFICAR — APROVADO
// 6 de 6 passos · 1 ms", exit 0 — byte-indistinguível de uma aprovação real,
// porque NENHUM campo, nem no texto nem no --json, dizia qual config tinha
// rodado. Duas trancas aqui: (1) o caminho do config e a raiz resolvida são
// SEMPRE impressos, em toda saída, aprovada ou não; (2) config que não é um
// arquivo rastreado dentro da árvore de trabalho do git vira CONFIG EXTERNO e
// nunca sai 0 — cai no 3, a mesma lógica do PARCIAL. `--config=` vazio, que
// antes caía em silêncio na busca automática, agora é exit 2.
//
// FURO 4 — o portão emudecia o único canal que denuncia bypass. `extrairErros`
// só rodava quando o passo NÃO passava, então a stdout de um passo aprovado era
// descartada inteira — inclusive as linhas "⚠ N arquivo(s) escondidos por
// .rebarignore" do rebar-check, que são justamente o aviso de que alguém
// escondeu arquivo da régua. Daí o campo `avisar`: uma RegExp por passo, extraída
// e impressa MESMO quando o passo passa, numa seção "avisos" abaixo do placar.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIMITE_LINHAS_PADRAO = 6
const LARGURA_MAXIMA_LINHA = 160
const TEMPO_LIMITE_PADRAO = 5 * 60 * 1000

// ── invocação ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
// `?.slice()` devolvia '' para `--config=`, e '' é falsy: o executor caía na
// busca automática e rodava OUTRO config sem dizer nada. A presença do flag e o
// valor dele são duas perguntas diferentes, então são duas variáveis.
const argConfig = args.find((a) => a.startsWith('--config='))
const opcoes = {
  json: args.includes('--json'),
  passo: args.find((a) => a.startsWith('--passo='))?.slice('--passo='.length),
  config: argConfig === undefined ? undefined : argConfig.slice('--config='.length),
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

// Separada de ErroDeConfiguracao porque o código de saída é outro, e a diferença
// importa: config torto é exit 2 ("conserte a invocação"); config adulterado é
// exit 1, uma REPROVAÇÃO do repositório — alguém escondeu uma alteração do git.
class ErroDeIntegridade extends Error {}

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
  'nome',
  'comando',
  'funcao',
  'dica',
  'extrair',
  'limite',
  'tempoLimite',
  'exige',
  'avisar',
])

// git é o único juiz de "este arquivo pertence a este repositório". Silencioso
// porque toda falha aqui (git ausente, diretório fora de repositório, arquivo
// não rastreado) tem o mesmo significado para quem chama: não deu para provar a
// procedência. Quem chama decide o que fazer com o null.
function gitSilencioso(argumentos, cwd) {
  try {
    const saida = execFileSync('git', argumentos, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return saida.trim()
  } catch {
    return null
  }
}

// No Windows o tmpdir costuma vir em nome 8.3 (C:\Users\LEONA~1\...) enquanto o
// git devolve o nome longo. Comparar as duas formas dá "fora da raiz" para
// caminho que está dentro. realpathSync normaliza as duas pontas; se o caminho
// não existir mais, o resolve cru já serve.
function caminhoReal(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

// O repositório do PRÓPRIO verificar.mjs, resolvido a partir do diretório do
// script e nunca do cwd — mesma razão do instalar.mjs: rodar de dentro de outro
// clone não pode mudar qual repositório está em jogo.
const DIRETORIO_DESTE_SCRIPT = dirname(fileURLToPath(import.meta.url))

function topoGit(dir) {
  const bruto = gitSilencioso(['rev-parse', '--show-toplevel'], dir)
  // git devolve barra normal mesmo no Windows; resolve() põe no formato do SO.
  return bruto === null ? null : caminhoReal(resolve(bruto))
}

function mesmoCaminho(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Prova que a régua veio do repositório que a régua diz verificar.
 *
 * Três condições, e nenhuma sobra. Auditei as duas primeiras sozinhas e as duas
 * furam: "estar dentro de uma árvore de trabalho do git" cai com um `git init`
 * no $TEMP, e "ser rastreado" cai com um `git add` + `git commit` nesse mesmo
 * repositório de mentira — medido, o forjado voltou a imprimir "APROVADO 8 de 8
 * · exit 0". A condição que fecha é a terceira: a raiz do config tem de ser a
 * MESMA raiz do verificar.mjs que está executando. O commit forjado do atacante
 * é revisável, sim — só que num histórico que ninguém deste projeto lê.
 */
function procedenciaDoConfig(arquivo) {
  const topo = topoGit(dirname(arquivo))
  if (topo === null) {
    return { raizGit: null, externo: true, motivo: 'não está dentro de árvore de trabalho do git' }
  }
  const real = caminhoReal(arquivo)
  const dentro =
    process.platform === 'win32'
      ? real.toLowerCase().startsWith(topo.toLowerCase() + sep)
      : real.startsWith(topo + sep)
  if (!dentro) {
    return { raizGit: topo, externo: true, motivo: `está fora da raiz do git (${topo})` }
  }

  const topoDoScript = topoGit(DIRETORIO_DESTE_SCRIPT)
  if (topoDoScript === null) {
    return {
      raizGit: topo,
      externo: true,
      motivo: 'não consegui achar o repositório do próprio verificar.mjs para comparar',
    }
  }
  if (!mesmoCaminho(topo, topoDoScript)) {
    return {
      raizGit: topo,
      externo: true,
      motivo: `vem de outro repositório (${topo}); este verificar.mjs pertence a ${topoDoScript}`,
    }
  }

  const rel = relative(topo, real).split(sep).join('/')
  if (gitSilencioso(['ls-files', '--error-unmatch', '--', rel], topo) === null) {
    return { raizGit: topo, externo: true, motivo: `"${rel}" não é rastreado por este repositório` }
  }
  return { raizGit: topo, externo: false, motivo: null, rel }
}

/**
 * Integridade do config, e por que esta checagem mora AQUI e não num passo.
 *
 * Tentei primeiro botá-la no passo `higiene` do verificar.config.mjs. Medido no
 * clone de teste: `git update-index --skip-worktree verificar.config.mjs` +
 * reescrever o arquivo com oito passos `() => ({codigo:0})` ⇒ "APROVADO 8 de 8
 * · exit 0". Óbvio em retrospecto — o passo que detectaria a troca é declarado
 * pelo arquivo trocado. Régua não confere a si mesma quando é a régua que foi
 * substituída. Então quem confere o config é o executor, antes de acreditar
 * numa linha dele.
 *
 * O que ISTO não cobre, e é honesto dizer: quem consegue reescrever
 * verificar.mjs apaga esta função. Contra esse, a defesa não é código — é o
 * arquivo estar no HEAD, passar por revisão, e o caminho do config aparecer
 * impresso em toda execução.
 */
function integridadeDoConfig(topo, rel) {
  // 1 — bit de rastreio. `git status`, `git diff` e `git diff HEAD` são todos
  // cegos a skip-worktree e a assume-unchanged; `ls-files -v` é o único que vê.
  const marca = gitSilencioso(['ls-files', '-v', '--', rel], topo)
  if (marca && !marca.startsWith('H ')) {
    const letra = marca[0]
    const nome =
      letra === 'S'
        ? 'skip-worktree'
        : letra >= 'a' && letra <= 'z'
          ? 'assume-unchanged'
          : `estado de índice "${letra}"`
    return {
      adulterado: true,
      motivo:
        `${rel} está marcado como ${nome} no índice: o git parou de olhar o disco ` +
        `para este arquivo, então status e diff mentem sobre ele.\n` +
        `  Desfaça: git update-index --no-skip-worktree --no-assume-unchanged ${rel}`,
    }
  }

  // 2 — o disco contra o HEAD. Divergir é normal (é o que edição é). Divergir
  // SEM aparecer no status é a assinatura da adulteração: quem edita de boa fé
  // aparece no status.
  const noHead = gitSilencioso(['rev-parse', `HEAD:${rel}`], topo)
  if (noHead === null) return { adulterado: false, motivo: null }
  // `hash-object` com caminho aplica o mesmo filtro de limpeza do commit (o
  // .gitattributes normaliza fim de linha), então é comparação de igual para igual.
  const noDisco = gitSilencioso(['hash-object', '--', rel], topo)
  if (noDisco === null || noDisco === noHead) return { adulterado: false, motivo: null }
  const visivel = gitSilencioso(['status', '--porcelain', '--', rel], topo)
  if (visivel) return { adulterado: false, motivo: null }
  return {
    adulterado: true,
    motivo:
      `${rel} no disco (${noDisco.slice(0, 12)}) difere do HEAD (${noHead.slice(0, 12)}) ` +
      `e NÃO aparece em git status. Uma alteração invisível ao status não é edição, é ocultação.`,
  }
}

function auditarConfig(arquivo) {
  const p = procedenciaDoConfig(arquivo)
  if (p.externo) return { ...p, adulterado: false, motivoAdulteracao: null }
  const i = integridadeDoConfig(p.raizGit, p.rel)
  return { ...p, adulterado: i.adulterado, motivoAdulteracao: i.motivo }
}

async function carregarConfig() {
  let arquivo
  if (opcoes.config !== undefined) {
    // `--config=` sem valor não é "use o padrão": é comando pela metade. Aceitá-lo
    // como padrão era um jeito de rodar um config e acreditar que rodou outro.
    if (opcoes.config.trim() === '') {
      throw new ErroDeConfiguracao('--config= veio vazio. Passe um caminho ou omita o flag.')
    }
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
      if (existsSync(tentativa)) {
        arquivo = tentativa
        break
      }
      const pai = dirname(dir)
      if (pai === dir) break
      dir = pai
    }
    if (!arquivo) {
      throw new ErroDeConfiguracao(
        `Nenhum verificar.config.mjs de ${process.cwd()} até a raiz do disco.`,
      )
    }
  }

  // A auditoria vem ANTES do import, e não depois: `import` executa o topo do
  // módulo. Config adulterado não roda nem uma linha — nem para depois ser
  // reprovado.
  const procedencia = auditarConfig(arquivo)
  if (procedencia.adulterado) {
    throw new ErroDeIntegridade(`${arquivo}\n\n  ${procedencia.motivoAdulteracao}`)
  }

  let modulo
  try {
    modulo = await import(pathToFileURL(arquivo).href)
  } catch (e) {
    throw new ErroDeConfiguracao(`${arquivo} não carregou:\n  ${e.message}`)
  }
  const passos = modulo.default
  if (!Array.isArray(passos) || passos.length === 0) {
    throw new ErroDeConfiguracao(
      `${arquivo} precisa exportar como default um array não vazio de passos.`,
    )
  }
  return { passos, arquivo, raiz: dirname(arquivo), procedencia }
}

function validarPassos(passos, arquivo) {
  const problemas = []
  const nomes = new Set()

  passos.forEach((p, i) => {
    const onde = `passo #${i + 1}${p?.nome ? ` (${p.nome})` : ''}`
    if (typeof p !== 'object' || p === null) {
      problemas.push(`${onde}: não é objeto.`)
      return
    }

    // FURO 1. A checagem é pelo NOME da chave, antes de qualquer outra coisa,
    // porque o objetivo não é ignorar o campo — é impedir que alguém o escreva
    // achando que funciona e saia daqui com um portão desligado e verde.
    if ('opcional' in p) {
      problemas.push(
        `${onde}: o campo "opcional" não existe no rebar. No alicerce ele fazia um ` +
          `passo FALHAR e mesmo assim imprimir APROVADO com exit 0. Passo que não ` +
          `bloqueia não é passo do verificar: tire-o da lista.`,
      )
    }
    if ('pulado' in p || 'grupo' in p) {
      problemas.push(`${onde}: "pulado"/"grupo" não existem — todo passo selecionado sempre roda.`)
    }
    for (const k of Object.keys(p)) {
      if (!CHAVES_VALIDAS.has(k) && k !== 'opcional' && k !== 'pulado' && k !== 'grupo') {
        problemas.push(
          `${onde}: chave desconhecida "${k}". Válidas: ${[...CHAVES_VALIDAS].join(', ')}.`,
        )
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
      if (
        !Array.isArray(p.comando) ||
        p.comando.length === 0 ||
        p.comando.some((a) => typeof a !== 'string' || a.length === 0)
      ) {
        problemas.push(
          `${onde}: "comando" precisa ser array de strings não vazias, ex.: [process.execPath, "x.mjs"].`,
        )
      }
    }
    if (temFuncao && typeof p.funcao !== 'function') {
      problemas.push(`${onde}: "funcao" precisa ser função.`)
    }
    for (const k of ['extrair', 'avisar']) {
      if (k in p && !(p[k] instanceof RegExp)) problemas.push(`${onde}: "${k}" precisa ser RegExp.`)
    }
    if ('exige' in p && (!Array.isArray(p.exige) || p.exige.some((a) => typeof a !== 'string'))) {
      problemas.push(`${onde}: "exige" precisa ser array de caminhos relativos à raiz.`)
    }
    for (const k of ['limite', 'tempoLimite']) {
      if (k in p && (!Number.isInteger(p[k]) || p[k] <= 0)) {
        problemas.push(`${onde}: "${k}" precisa ser inteiro positivo.`)
      }
    }
    if ('dica' in p && typeof p.dica !== 'string')
      problemas.push(`${onde}: "dica" precisa ser string.`)
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
    const acumular = (pedaco) => {
      if (saida.length < 1_000_000) saida += String(pedaco)
    }
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
    const t = setTimeout(
      () =>
        res({
          estado: 'quebrou',
          saida: `[verificar] tempo limite de ${tempoLimite} ms estourado`,
        }),
      tempoLimite,
    )
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
      return {
        estado: 'quebrou',
        saida: `[verificar] arquivo exigido ausente: ${rel}`,
        duracaoMs: 0,
      }
    }
  }
  return passo.comando ? executarComando(passo, raiz) : executarFuncao(passo, raiz)
}

// ── extração de erro ────────────────────────────────────────────────────────

// A diferença entre 300 e 15 mil tokens por ciclo de correção está aqui. Uma
// ferramenta que reprova despejando 400 linhas de rastro de pilha custa uma
// leitura inteira de contexto; as mesmas 6 linhas certas custam quase nada.
const PADRAO_ERRO = /(^|\s)(error|erro|✗|✘|⚠|FAIL|failed|falhou)\b|error TS\d+|:\d+:\d+/i

// RegExp com flag /g carrega lastIndex entre chamadas de .test(), o que faz o
// filtro casar linha sim, linha não. Como as regexes vêm do config e o autor não
// tem por que saber disso, a cópia sem /g é feita aqui em vez de recusar a flag.
function semGlobal(re) {
  return re.flags.includes('g') ? new RegExp(re.source, re.flags.replace(/g/g, '')) : re
}

function linhasUteis(saida) {
  return String(saida)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
}

function encurtar(l) {
  return l.length > LARGURA_MAXIMA_LINHA ? `${l.slice(0, LARGURA_MAXIMA_LINHA - 1)}…` : l
}

// FURO 4. Roda para TODO passo, inclusive o que passou: um aviso só serve se
// aparece justamente quando nada mais está gritando.
function extrairAvisos(passo, saida) {
  if (!passo.avisar) return []
  const re = semGlobal(passo.avisar)
  const unicas = [
    ...new Set(
      linhasUteis(saida)
        .filter((l) => re.test(l))
        .map((l) => l.trim()),
    ),
  ]
  return unicas.slice(0, passo.limite ?? LIMITE_LINHAS_PADRAO).map(encurtar)
}

function extrairErros(passo, saida) {
  const linhas = linhasUteis(saida)

  const re = passo.extrair ? semGlobal(passo.extrair) : null
  let candidatas = re ? linhas.filter((l) => re.test(l)) : linhas.filter((l) => PADRAO_ERRO.test(l))

  // Sem padrão reconhecido, as últimas linhas costumam ser o resumo da
  // ferramenta — mais úteis que as primeiras, que são banner.
  if (candidatas.length === 0) candidatas = linhas.slice(-LIMITE_LINHAS_PADRAO)

  const unicas = [...new Set(candidatas.map((l) => l.trim()))]
  const limite = passo.limite ?? LIMITE_LINHAS_PADRAO
  return { total: unicas.length, mostradas: unicas.slice(0, limite).map(encurtar) }
}

// ── relatório ───────────────────────────────────────────────────────────────

function duracao(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function relatar(veredito) {
  const { resultados, naoRodaram, parcial, declarados, duracaoMs, arquivo, raiz, procedencia } =
    veredito
  const quebrados = resultados.filter((r) => r.estado === 'quebrou')
  const reprovados = resultados.filter((r) => r.estado === 'reprovou')
  const aprovados = resultados.filter((r) => r.estado === 'passou')

  let titulo
  if (quebrados.length) titulo = c.amarelo('QUEBROU')
  else if (reprovados.length) titulo = c.vermelho('REPROVADO')
  else if (procedencia.externo) titulo = c.amarelo('CONFIG EXTERNO')
  else if (parcial) titulo = c.amarelo('PARCIAL')
  else titulo = c.verde('APROVADO')

  const placar = `${resultados.length} de ${declarados} passos`
  console.log(
    `\n${c.forte('VERIFICAR')} — ${titulo}  ${c.cinza(`${placar} · ${duracao(duracaoMs)}`)}`,
  )

  // FURO 3: sem estas duas linhas, "APROVADO 6 de 6" de um config forjado no
  // $TEMP é byte-por-byte igual ao de um config real. Impressas SEMPRE — um
  // campo que só aparece quando há problema é um campo que ninguém aprende a ler.
  console.log(`  ${c.cinza('config')}  ${arquivo}`)
  console.log(`  ${c.cinza('raiz')}    ${raiz}`)

  if (procedencia.externo) {
    console.log(
      `\n  ${c.amarelo(c.forte('CONFIG EXTERNO'))} — ${procedencia.motivo}. ${c.forte('NÃO É APROVAÇÃO.')}`,
    )
    console.log(
      `  ${c.cinza('os passos rodaram, mas quem escreveu a régua não está sob revisão deste repositório.')}`,
    )
  }

  // FURO 2: a linha que o alicerce não imprimia. Ela vem ANTES dos detalhes
  // porque é a informação que muda a leitura de tudo o que vem depois.
  if (parcial) {
    console.log(
      `\n  ${c.amarelo(c.forte(`PARCIAL — ${resultados.length} de ${declarados} passos. NÃO É APROVAÇÃO.`))}`,
    )
    console.log(`  ${c.cinza(`não rodaram (${naoRodaram.length}): ${naoRodaram.join(' · ')}`)}`)
    console.log(
      `  ${c.cinza('recorte serve para consertar, não para liberar. Rode sem --passo= antes de commitar.')}`,
    )
  }
  console.log('')

  for (const r of [...quebrados, ...reprovados]) {
    const marca = r.estado === 'quebrou' ? c.amarelo('⚠') : c.vermelho('✗')
    const rotulo =
      r.estado === 'quebrou'
        ? c.amarelo('NÃO EXECUTOU')
        : r.erros.total === 1
          ? '1 erro'
          : `${r.erros.total} erros`
    console.log(`  ${marca} ${r.nome.padEnd(10)} ${rotulo}  ${c.cinza(duracao(r.duracaoMs))}`)
    for (const linha of r.erros.mostradas) console.log(`      ${linha}`)
    if (r.erros.total > r.erros.mostradas.length) {
      console.log(
        c.cinza(
          `      … mais ${r.erros.total - r.erros.mostradas.length} · node ferramental/verificar/verificar.mjs --passo=${r.nome}`,
        ),
      )
    }
    console.log('')
  }

  if (aprovados.length)
    console.log(`  ${c.verde('✓')} ${aprovados.map((r) => r.nome).join(' · ')}\n`)

  // FURO 4: seção própria, abaixo do placar, alimentada também pelos passos que
  // PASSARAM. É por aqui que "⚠ N arquivo(s) escondidos por .rebarignore" chega
  // a quem lê — antes, a stdout de um passo aprovado era descartada inteira.
  const comAviso = resultados.filter((r) => r.avisos.length)
  if (comAviso.length) {
    const n = comAviso.reduce((s, r) => s + r.avisos.length, 0)
    console.log(
      `  ${c.amarelo(c.forte(`avisos (${n})`))} ${c.cinza('— não reprovam, mas são reais')}`,
    )
    for (const r of comAviso) {
      for (const linha of r.avisos) console.log(`      ${c.cinza(r.nome.padEnd(8))} ${linha}`)
    }
    console.log('')
  }

  // O config declara do mais barato ao mais caro, então o primeiro da ordem que
  // caiu é o que se conserta primeiro — e consertar costuma apagar os de baixo.
  const primeiro = resultados.find((r) => r.estado !== 'passou')
  if (primeiro) {
    const restantes = resultados.filter((r) => r.estado !== 'passou').length - 1
    console.log(
      `  ${c.forte('Primeiro:')} ${primeiro.nome}.${primeiro.dica ? ` ${primeiro.dica}` : ''}`,
    )
    if (restantes === 1) console.log(c.cinza('  O outro pode sumir junto.'))
    else if (restantes > 1) console.log(c.cinza(`  Os outros ${restantes} podem sumir junto.`))
    console.log('')
  }
}

// ── principal ───────────────────────────────────────────────────────────────

async function principal() {
  const { passos, arquivo, raiz, procedencia } = await carregarConfig()
  validarPassos(passos, arquivo)

  const selecionados = opcoes.passo ? passos.filter((p) => p.nome === opcoes.passo) : passos
  if (opcoes.passo && selecionados.length === 0) {
    throw new ErroDeConfiguracao(
      `Passo "${opcoes.passo}" não existe em ${arquivo}.\n  ` +
        `Disponíveis: ${passos.map((p) => p.nome).join(', ')}`,
    )
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
      avisos: extrairAvisos(passo, r.saida),
    })
  }

  const veredito = {
    resultados,
    naoRodaram,
    parcial,
    declarados: passos.length,
    duracaoMs: Date.now() - inicio,
    arquivo,
    raiz,
    procedencia,
  }

  // Ordem de precedência, e ela não é arbitrária: QUEBROU domina REPROVOU
  // porque não se acusa um repositório com uma régua que não rodou. REPROVOU
  // domina PARCIAL porque um passo que rodou e disse não é veredito de verdade,
  // e escondê-lo atrás do 3 perderia informação. PARCIAL domina o 0 sempre —
  // é a porta trancada do FURO 2.
  //
  // CONFIG EXTERNO entra na mesma faixa do PARCIAL, e pela mesma razão: os
  // passos podem ter todos passado, mas quem escolheu os passos não está sob
  // revisão. Isso não acusa o repositório (não é 1) nem absolve (nunca é 0).
  const quebrou = resultados.some((r) => r.estado === 'quebrou')
  const reprovou = resultados.some((r) => r.estado === 'reprovou')
  const externo = procedencia.externo
  const codigo = quebrou ? 127 : reprovou ? 1 : parcial || externo ? 3 : 0

  if (opcoes.json) {
    console.log(
      JSON.stringify(
        {
          resultado: quebrou
            ? 'quebrou'
            : reprovou
              ? 'reprovado'
              : externo
                ? 'config-externo'
                : parcial
                  ? 'parcial'
                  : 'aprovado',
          // FURO 3: o consumidor de --json precisa poder responder "qual régua
          // produziu este veredito?" sem confiar na palavra de quem rodou.
          config: {
            arquivo,
            raiz,
            raizGit: procedencia.raizGit,
            externo,
            motivoExterno: procedencia.motivo,
          },
          parcial,
          quando: new Date().toISOString().slice(0, 16).replace('T', ' '),
          duracaoMs: veredito.duracaoMs,
          passosDeclarados: passos.length,
          passosExecutados: resultados.length,
          naoRodaram,
          codigoSaida: codigo,
          passos: resultados.map((r) => ({
            nome: r.nome,
            estado: r.estado,
            codigo: r.codigo,
            duracaoMs: r.duracaoMs,
            totalErros: r.erros.total,
            erros: r.erros.mostradas,
            avisos: r.avisos,
          })),
        },
        null,
        2,
      ),
    )
  } else {
    relatar(veredito)
  }

  process.exitCode = codigo
}

principal().catch((e) => {
  if (e instanceof ErroDeIntegridade) {
    if (opcoes.json) {
      console.log(
        JSON.stringify(
          { resultado: 'config-adulterado', codigoSaida: 1, motivo: e.message.trim() },
          null,
          2,
        ),
      )
    } else {
      console.error(`\n${c.vermelho('VERIFICAR — CONFIG ADULTERADO')}\n\n  ${e.message}\n`)
      console.error(
        `  ${c.cinza('nenhum passo rodou: a régua que diria se está tudo bem é a peça trocada.')}\n`,
      )
    }
    process.exitCode = 1
    return
  }
  const titulo = e instanceof ErroDeConfiguracao ? 'ERRO DE CONFIGURAÇÃO' : 'ERRO INTERNO'
  console.error(`\n${c.vermelho(`VERIFICAR — ${titulo}`)}\n\n  ${e.message}\n`)
  // Config quebrada nunca é aprovação nem reprovação do repositório.
  process.exitCode = e instanceof ErroDeConfiguracao ? 2 : 127
})
