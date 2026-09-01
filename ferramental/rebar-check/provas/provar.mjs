#!/usr/bin/env node
// provar.mjs — as provas do rebar-check.
//
// A regra-mãe do alicerce diz: toda regra que sobe para N1 nasce com dois casos,
// um que aprova e um que reprova. O rebar-check subiu com 19 regras e ZERO casos,
// violando a regra que o próprio repositório transcreve e negrita. Duas regras já
// tiveram falso positivo PROVADO — `testes` era cega a arquivo nomeado em português
// (43 arquivos rastreados com "prova" no nome, zero enxergados) e `ci-gateia`
// procurava as palavras lint/typecheck/test literais no YAML. As duas foram
// consertadas. Isto existe para que a terceira não passe despercebida.
//
// Uso:
//   node provar.mjs                 roda todos os casos de provas/casos/
//   node provar.mjs <id-da-regra>   roda só aquele caso
//
// Um caso é a pasta provas/casos/<regra>[__<variante>]/ com:
//
//   caso.json     { "regra", "porque", "aprovar"?, "reprovar"? }
//   aprovar/      a árvore de um lado
//   reprovar/     a árvore do outro
//
// Cada bloco de lado aceita:
//
//   "estado"   o que a regra tem de devolver ali: "passou" · "reprovou" · "na".
//              Omitido, vale aprovar=passou e reprovar=reprovou. É o campo que
//              torna os ramos N/A traváveis — ver ESTADO_PADRAO.
//   "commits"  lista de { mensagem, autor }. Omitida, um commit padrão.
//              LISTA VAZIA significa "sem nenhum commit", que é o único jeito
//              de alcançar os ramos N/A de `coautoria-ia` e `identidade-git`.
//
// Códigos de saída — mesma disciplina do index.mjs, três coisas, três códigos:
//   0    todo lado bateu com o esperado
//   1    algum lado DIVERGIU, ou o index.mjs QUEBROU nele. Crash nunca conta
//        como "reprovar bateu": um index.mjs que sequer compila faz o node
//        sair 1, e o formato antigo — que lia exit code — dava os 15 lados
//        `reprovar` por bons, deixando a suíte meio verde com o checker morto.
//   2    a própria PROVA está mal formada — e isso domina o 1, pelo mesmo
//        motivo que no index.mjs o 127 domina o 1: não se acusa ninguém com
//        um instrumento que está torto.
//
// NUNCA escreve no repositório. Cada lado é montado num diretório novo de
// os.tmpdir() e apagado no finally. O provar-portao.mjs do alicerce fazia
// writeFileSync + git add DENTRO do repo vivo — defeito conhecido que este
// arquivo se recusa a herdar.
//
// ─────────────────────────────────────────────────────────────── desempenho
//
// Esta suíte já foi SERIAL e era o passo mais caro do `verificar` — 47 casos ×
// 2 lados = 94 repositórios git montados um a um, ~660 processos em fila. Nesta
// máquina (Windows, 20 núcleos) a versão serial levava 41,3 · 42,0 · 51,9 s em
// três rodadas. Instrumentei cada spawn dela para saber ONDE ia o tempo — a
// medição sai numa rodada de 64,4 s, e o que importa dela é a PROPORÇÃO:
//
//   index.mjs   n= 94  total= 18346 ms  médio=195,2 ms  28,5%
//   git commit  n=103  total= 16245 ms  médio=157,7 ms  25,2%
//   git init    n= 94  total= 13127 ms  médio=139,6 ms  20,4%
//   git add     n= 94  total=  7736 ms  médio= 82,3 ms  12,0%
//   git config  n=188  total=  6977 ms  médio= 37,1 ms  10,8%
//   rmSync      n= 94  total=  1515 ms                   2,4%
//   cpSync      n= 94  total=   445 ms                   0,7%
//   mkdtemp     n= 94  total=    48 ms                   0,1%
//
// Ou seja: montar a fixture custava 44,1 s (68%) e rodar o que está sob prova
// custava 18,3 s (28%). O gargalo NÃO era o checker; era o git. Daí as três
// mudanças, nesta ordem de retorno:
//
//   1. CORTAR TRABALHO. Os 188 `git config` viraram ZERO: a identidade do
//      committer vai por GIT_COMMITTER_NAME/EMAIL no ambiente, e o autor já
//      vinha por `--author` em cada commit. Os 94 `git init` viraram UM: o
//      molde é inicializado uma vez e o `.git` é COPIADO para cada lado —
//      cópia de ~20 arquivinhos contra um processo de 140 ms. O molde nasce
//      dentro do MESMO os.tmpdir() das fixtures de propósito: o `git init`
//      grava em .git/config o que detectou do sistema de arquivos (filemode,
//      symlinks, ignorecase), e um molde criado noutro volume levaria essa
//      detecção errada junto.
//   2. PARALELIZAR POR CASO. Cada caso já era independente por construção —
//      tmpdir próprio, git próprio, nada compartilhado —, mas `spawnSync`
//      travava o laço de eventos e servia um processo por vez. Agora é `spawn`
//      assíncrono com uma piscina de tamanho fixo (ver TETO).
//   3. A ORDEM DA SAÍDA NÃO MUDA. Os casos terminam fora de ordem; o relatório
//      sai em ordem alfabética do mesmo jeito, porque cada caso escreve num
//      balde indexado e a impressão só escoa o próximo índice quando ele fica
//      pronto. Suíte cujo diff entre duas execuções vira ruído é suíte em que
//      ninguém confia.
//
// O que os `git` restantes ganharam: `commit --quiet --no-verify` (nada de
// resumo de commit que a gente joga fora, nada de hook de terceiro) e `init
// --quiet` no molde.
//
// RESULTADO, os mesmos 47 casos, máquina ociosa:
//
//   antes, em série                        41,3 · 42,0 · 51,9 s
//   só cortando trabalho, ainda em série            29,9 s
//   cortando + piscina                       6,3 · 6,7 · 7,1 s
//
// ~6,5× no relógio, dos quais o corte de trabalho responde por 41 → 30 s e a
// piscina por 30 → 6 s. Com a máquina em carga (outro agente rodando a suíte no
// mesmo minuto), um A/B intercalado deu 107–201 s em série contra 13–21 s em
// paralelo — de 4,8× a 10,3×, nunca menos.
//
// E o veredito não mudou: 15 saídas guardadas — série e paralelo, TETO de 1 a
// 20, rodadas repetidas — batem no MESMO md5, byte a byte, incluindo a rodada
// com um caso mal formado e outra com um caso divergente de propósito.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const INDEX = join(AQUI, '..', 'index.mjs')
const CASOS = join(AQUI, 'casos')

// ─────────────────────────────────────────────────────────────── utilitários

const cor = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  verde: (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s),
  vermelho: (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s),
  amarelo: (s) => (cor ? `\x1b[33m${s}\x1b[0m` : s),
  fraco: (s) => (cor ? `\x1b[2m${s}\x1b[0m` : s),
  forte: (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s),
}

/**
 * Quantos casos em voo ao mesmo tempo.
 *
 * Piscina de tamanho fixo, nunca `Promise.all` sobre os 47 casos: cada caso é
 * I/O de disco (montar dois repositórios) muito mais do que CPU, e no Windows
 * um enxame de gits briga pelo mesmo volume. Medido nesta máquina de 20
 * núcleos, os 47 casos, relógio de ponta a ponta:
 *
 *   1 (esta versão, em série)  29,9 s       10   6,7 s
 *   4                           9,3 s       12   6,3 s
 *   6                           7,8 s       16   5,6 s
 *   8                           7,2 s       20   6,7 s
 *
 * O ganho grosso vem até 8; de 8 a 16 ainda cai; em 20 volta a subir, que é a
 * briga por disco aparecendo. Daí o teto de 16.
 *
 * O teto só morde em máquina grande — o `min` com os núcleos garante que um
 * runner de 2 ou 4 vCPU pegue 2 ou 4, não 16. `availableParallelism` respeita
 * o cgroup do contêiner do CI, coisa que `cpus().length` não faz; o fallback
 * existe para Node antigo.
 */
const NUCLEOS = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length
const TETO = Math.max(2, Math.min(16, NUCLEOS))

/**
 * O ESTADO que cada lado tem de produzir, por omissão.
 *
 * Isto era `{ aprovar: 0, reprovar: 1 }` — exit code —, e a escolha furava a
 * suíte por construção: o index.mjs colapsa "passou" e "na" no MESMO exit 0,
 * então nenhum dos ramos N/A podia ser travado, por mais casos que se
 * escrevesse. Medido: das 70 mutações que a auditoria aplicou ao index.mjs,
 * 30 sobreviveram com a suíte 15 de 15 verde — e entre as sobreviventes
 * estavam o helper `na()` e o `catch` do `git()`, os dois consertos que o
 * index.mjs documenta como os mais caros que recebeu. Agora cada lado declara
 * um estado e o runner o lê do `--json`.
 *
 * O default reproduz o contrato antigo, para que os casos já escritos
 * continuem valendo sem uma linha de reescrita.
 *
 * `quebrou` não aparece aqui e nunca pode ser esperado: crash é defeito do
 * instrumento, não resultado dele.
 */
const ESTADO_PADRAO = { aprovar: 'passou', reprovar: 'reprovou' }
const LADOS = Object.keys(ESTADO_PADRAO)
const ESTADOS_ESPERAVEIS = new Set(['passou', 'reprovou', 'na'])

const COMMIT_PADRAO = { mensagem: 'caso de prova', autor: 'Prova <prova@rebar.local>' }

/**
 * 2026-01-01T00:00:00Z em segundos. Vai no formato cru "<unix> <fuso>" porque
 * uma data ISO sem fuso o git lê como hora LOCAL — a prova rodaria diferente em
 * São Paulo e no runner do CI. Cada commit anda 60s para o histórico ficar em
 * ordem legível sem depender de desempate por hash.
 */
const EPOCA_FIXA = 1767225600

/**
 * Config global e de sistema neutralizadas apontando para um caminho que não
 * existe (o git trata arquivo de config ausente como vazio). Sem isto a prova
 * herda o gitconfig da máquina: commit.gpgsign trava o commit, core.hooksPath
 * dispara hook de terceiro, init.templateDir injeta arquivo na árvore e
 * core.autocrlf muda o conteúdo do que a regra vai ler. Fixture que depende da
 * máquina não é fixture.
 */
const SEM_CONFIG = join(tmpdir(), 'rebar-provas-gitconfig-inexistente')

/**
 * A identidade do committer vem por AMBIENTE, não por `git config` local.
 *
 * Eram dois `git config` por lado — 188 processos, 7,0 s dos 64,4 s medidos —
 * para gravar exatamente o que estas quatro variáveis dizem. O autor de cada
 * commit continua vindo do `--author`, que tem precedência sobre GIT_AUTHOR_*,
 * então o `%an <%ae>` que a regra `identidade-git` lê sai idêntico. O index.mjs
 * nunca lê `git config` do alvo — só `git log` e `git ls-files` —, de modo que
 * a ausência da config local não é observável por regra nenhuma.
 */
function ambienteGit(iCommit) {
  const carimbo = `${EPOCA_FIXA + iCommit * 60} +0000`
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: SEM_CONFIG,
    GIT_CONFIG_SYSTEM: SEM_CONFIG,
    GIT_AUTHOR_NAME: 'Prova',
    GIT_AUTHOR_EMAIL: 'prova@rebar.local',
    GIT_COMMITTER_NAME: 'Prova',
    GIT_COMMITTER_EMAIL: 'prova@rebar.local',
    GIT_AUTHOR_DATE: carimbo,
    GIT_COMMITTER_DATE: carimbo,
    GIT_TERMINAL_PROMPT: '0',
  }
}

/**
 * Filhos vivos — git e index.mjs. Só serve ao handler de sinal, e é a peça que
 * faltava quando a suíte virou paralela: MEDIDO, disparando o handler no meio
 * de uma rodada, 10 pastas `rebar-prova-*` sobraram mesmo com o rmSync do
 * handler rodando em todas elas. O motivo é o Windows: um `git` ainda vivo
 * segura handle dentro do diretório que se está apagando, o rmSync falha, o
 * catch engole, e o process.exit mata o filho DEPOIS, tarde demais. Matar
 * primeiro e apagar depois derruba as 10 para 0.
 */
const filhos = new Set()

/**
 * spawn assíncrono, nunca spawnSync: é a peça que torna a piscina possível.
 * Com spawnSync o laço de eventos fica parado dentro do processo filho e a
 * "paralelização" serviria um caso por vez, exatamente como antes.
 *
 * Nada de shell. `git` e `process.execPath` são executáveis de verdade nos dois
 * sistemas; o que a casa proíbe é `npx` sem shell, e npx não aparece aqui.
 */
function rodar(cmd, args, opcoes) {
  return new Promise((resolve) => {
    let filho
    try {
      filho = spawn(cmd, args, { ...opcoes, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ erro: e, codigo: null, stdout: '', stderr: '' })
      return
    }
    // Registrado para o handler de sinal poder MATAR os filhos antes de tentar
    // apagar as pastas — ver o handler de sinal.
    filhos.add(filho)
    let saida = ''
    let erroSaida = ''
    let erro = null
    filho.stdout.setEncoding('utf8')
    filho.stderr.setEncoding('utf8')
    filho.stdout.on('data', (d) => {
      saida += d
    })
    filho.stderr.on('data', (d) => {
      erroSaida += d
    })
    // 'error' (ENOENT, por exemplo) ainda dispara 'close' depois; guardo e
    // resolvo uma vez só, no close, para não vazar promessa pendente.
    filho.on('error', (e) => {
      erro = e
    })
    filho.on('close', (codigo) => {
      filhos.delete(filho)
      resolve({ erro, codigo, stdout: saida, stderr: erroSaida })
    })
  })
}

async function git(dir, args, iCommit = 0) {
  const r = await rodar('git', args, { cwd: dir, env: ambienteGit(iCommit) })
  if (r.erro) throw new Error(`git ${args[0]}: ${r.erro.message}`)
  if (r.codigo !== 0) {
    const detalhe = `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n')[0]
    throw new Error(`git ${args.join(' ')} saiu ${r.codigo}: ${detalhe}`)
  }
  return (r.stdout || '').trim()
}

/**
 * TODA pasta temporária desta rodada nasce com este prefixo, que carrega o PID.
 *
 * O PID não é enfeite: é o que torna a limpeza por VARREDURA segura. Sem ele,
 * varrer `rebar-prova-*` do os.tmpdir() apagaria a fixture de outra rodada
 * acontecendo ao mesmo tempo — a matriz do CI roda Windows e Linux, e nesta
 * máquina há mais de um agente mexendo no repositório no mesmo minuto.
 */
const PREFIXO_TMP = `rebar-prova-${process.pid}-`

/**
 * Apagar no caminho normal é assíncrono para não travar os outros casos da
 * piscina — 1,5 s da rodada instrumentada eram rmSync bloqueando o laço.
 * maxRetries porque no Windows o git deixa objeto em .git/objects somente
 * leitura e o antivírus segura o handle por alguns milissegundos.
 */
async function apagar(dir) {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    /* é temporário; o SO limpa */
  }
}

/**
 * A varredura: apaga TUDO que esta rodada criou e ainda está no os.tmpdir().
 *
 * O caminho normal já apaga cada lado no `finally` dele, mas apagar pode
 * falhar em silêncio — medido, com a máquina em carga um `rm` do molde não
 * pegou e a pasta ficou. Uma leitura de diretório no fim da rodada custa
 * milissegundos e fecha esse buraco. O filtro é por PREFIXO_TMP, então uma
 * rodada nunca apaga a fixture de outra.
 */
async function varrerRestos() {
  let restos = []
  try {
    restos = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO_TMP))
  } catch {
    /* sem tmpdir legível não há o que varrer */
  }
  for (const nome of restos) await apagar(join(tmpdir(), nome))
}

/**
 * A limpeza do Ctrl+C. Três passos, nesta ordem, e cada um saiu de uma medição.
 *
 * A versão serial guardava as pastas em voo num Set e apagava esse Set. Com a
 * piscina isso passou a MENTIR de dois jeitos, os dois medidos disparando o
 * handler no meio da rodada:
 *
 *   1. 10 de 10 pastas sobravam porque o `git` daquele lado ainda estava vivo
 *      segurando handle dentro dela — no Windows o rmSync falha, o catch
 *      engole, e o process.exit mata o filho só depois, tarde demais. Daí
 *      matar os filhos ANTES, e esperar 100 ms para o SO soltar os handles.
 *      Atomics.wait é o sleep bloqueante de fábrica do Node; não dá para
 *      `await` aqui, porque o handler tem de terminar no mesmo tique.
 *   2. Ainda sobravam pastas que o Set NUNCA CHEGOU A CONHECER: `mkdtemp`
 *      assíncrono cria o diretório no disco antes de o callback rodar em JS, e
 *      os 100 ms de espera são exatamente a janela em que os `mkdtemp` das
 *      outras N linhas da piscina terminam sem nunca serem registrados. Um
 *      registro em memória não tem como cobrir isso.
 *
 * Por isso a limpeza é uma VARREDURA do os.tmpdir() por PREFIXO_TMP, e não uma
 * lista: o disco é a única fonte que sabe de tudo que foi criado, e o prefixo
 * com PID garante que só se apaga o que é desta rodada. Medido depois: 0
 * pastas esquecidas em 8 interrupções em pontos aleatórios da rodada, contra
 * 10 na primeira tentativa de conserto.
 */
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    for (const f of [...filhos]) {
      try {
        f.kill()
      } catch {
        /* já morreu entre o Set e aqui */
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    let restos = []
    try {
      restos = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO_TMP))
    } catch {
      /* sem tmpdir legível não há o que varrer */
    }
    for (const nome of restos) {
      try {
        rmSync(join(tmpdir(), nome), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        })
      } catch {
        /* é temporário; o SO limpa */
      }
    }
    process.exit(130)
  })
}

// ───────────────────────────────────────────────────── leitura de um caso

/**
 * Um "lado" mal declarado é prova mal formada, não reprovação. Empilha em
 * `erros` em vez de lançar para que uma rodada mostre TODOS os defeitos do
 * caso de uma vez, e não um por execução.
 */
function lerCommits(bloco, lado, erros) {
  if (bloco === undefined || bloco === null) return [COMMIT_PADRAO]
  if (typeof bloco !== 'object' || Array.isArray(bloco)) {
    erros.push(`"${lado}" tem de ser objeto`)
    return [COMMIT_PADRAO]
  }
  if (bloco.commits === undefined) return [COMMIT_PADRAO]
  if (!Array.isArray(bloco.commits)) {
    erros.push(`"${lado}.commits" tem de ser lista`)
    return [COMMIT_PADRAO]
  }
  // Lista VAZIA é declaração deliberada de "git init e para aí", não descuido.
  // Existe porque `coautoria-ia` e `identidade-git` têm um ramo N/A que só se
  // alcança em repositório sem NENHUM commit, e sem isto esse ramo era
  // inalcançável pela prova. Os arquivos ainda vão para o índice, então o
  // `git ls-files` continua enxergando a árvore: o alvo é um repositório com
  // conteúdo e sem histórico, que é exatamente o objeto do ramo.
  if (!bloco.commits.length) return []
  const saida = []
  bloco.commits.forEach((cm, i) => {
    const onde = `${lado}.commits[${i}]`
    if (!cm || typeof cm !== 'object' || Array.isArray(cm)) {
      erros.push(`${onde} não é objeto`)
      return
    }
    if (typeof cm.mensagem !== 'string' || !cm.mensagem.length) erros.push(`${onde} sem "mensagem"`)
    const autor = typeof cm.autor === 'string' ? cm.autor.trim() : ''
    // O git recusa o commit inteiro se o --author vier torto. Reprovar a prova
    // aqui dá mensagem melhor do que ver "fatal: malformed --author" lá.
    if (!/^[^<>]+<[^<>]*>$/.test(autor)) {
      erros.push(`${onde} com autor fora do formato "Nome <email>": ${JSON.stringify(cm.autor)}`)
    }
    saida.push({ mensagem: typeof cm.mensagem === 'string' ? cm.mensagem : '', autor })
  })
  return saida.length ? saida : [COMMIT_PADRAO]
}

/**
 * `"modos": { "hooks/pre-commit": "100755" }` — modo de arquivo no índice.
 *
 * Existe porque `git add` no Windows grava tudo como 100644, e sem isto a regra
 * `hooks-executaveis` seria improvável na única plataforma onde este
 * repositório é escrito. Só os dois modos que o git conhece para arquivo comum.
 */
function lerModos(bloco, lado, erros) {
  if (!bloco || typeof bloco !== 'object' || bloco.modos === undefined) return {}
  const m = bloco.modos
  if (typeof m !== 'object' || Array.isArray(m) || m === null) {
    erros.push(`"${lado}.modos" tem de ser objeto de caminho para modo`)
    return {}
  }
  for (const [caminho, modo] of Object.entries(m)) {
    if (modo !== '100755' && modo !== '100644') {
      erros.push(
        `"${lado}.modos[${caminho}]" só aceita "100755" ou "100644", veio ${JSON.stringify(modo)}`,
      )
    }
  }
  return m
}

function lerCaso(id) {
  const base = join(CASOS, id)
  const arquivo = join(base, 'caso.json')
  if (!existsSync(arquivo)) return { erros: ['sem caso.json'] }

  let bruto
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch (e) {
    return { erros: [`caso.json ilegível: ${e.message}`] }
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { erros: ['caso.json não é um objeto'] }
  }

  const erros = []
  // A pasta pode ser `<regra>` ou `<regra>__<variante>`. Variante existe porque
  // uma regra pode ter mais de um jeito de ser satisfeita, e um caso que
  // satisfaz por VÁRIOS caminhos ao mesmo tempo não prova nenhum deles.
  // Medido: o caso `testes` original tinha três arquivos de teste — pasta em
  // português, nome em português e um arquivo comum. Restaurando à mão o bug
  // de cegueira ao português, a prova continuou VERDE, porque o nome ainda
  // casava. Uma prova que sobrevive à volta do defeito que ela existe para
  // travar não é prova. Cada variante isola UM caminho.
  const regraDaPasta = id.includes('__') ? id.slice(0, id.indexOf('__')) : id
  if (bruto.regra !== regraDaPasta) {
    erros.push(`caso.json diz regra ${JSON.stringify(bruto.regra)} e a pasta se chama "${id}"`)
  }
  const regra = regraDaPasta
  if (typeof bruto.porque !== 'string' || !bruto.porque.trim()) {
    erros.push('caso.json sem "porque" — a prova tem de dizer que falha real ela impede')
  }

  const lados = {}
  for (const lado of LADOS) {
    const dir = join(base, lado)
    if (!existsSync(dir)) {
      erros.push(`falta a pasta ${lado}/`)
      continue
    }
    if (!statSync(dir).isDirectory()) {
      erros.push(`${lado}/ existe e não é pasta`)
      continue
    }
    const bloco = bruto[lado]
    // O campo é opcional: sem ele vale o default, e as pastas se chamam
    // `aprovar`/`reprovar` porque é isso que a esmagadora maioria dos casos
    // declara. Um caso que declara `na` nos dois lados usa as duas pastas para
    // dois ramos N/A DIFERENTES da mesma regra — daí o `porque` ter de dizer
    // qual ramo cada lado alcança.
    let estado = ESTADO_PADRAO[lado]
    const pedido =
      bloco && typeof bloco === 'object' && !Array.isArray(bloco) ? bloco.estado : undefined
    if (pedido !== undefined) {
      if (!ESTADOS_ESPERAVEIS.has(pedido)) {
        erros.push(
          `"${lado}.estado" é ${JSON.stringify(pedido)} — só vale ${[...ESTADOS_ESPERAVEIS].join(', ')}`,
        )
      } else {
        estado = pedido
      }
    }
    lados[lado] = {
      dir,
      estado,
      commits: lerCommits(bloco, lado, erros),
      modos: lerModos(bloco, lado, erros),
    }
  }

  return {
    regra,
    erros,
    porque: typeof bruto.porque === 'string' ? bruto.porque.trim() : '',
    lados,
  }
}

// ─────────────────────────────────────────────────────── execução de um lado

/**
 * O `.git` recém-inicializado que todos os lados copiam, em vez de rodar
 * `git init` 94 vezes (13,1 s dos 64,4 s medidos). Nasce em os.tmpdir(), o
 * mesmo volume das fixtures, porque o `.git/config` que o init escreve carrega
 * a detecção do sistema de arquivos: um molde de outro volume levaria filemode
 * e ignorecase errados para dentro de toda fixture.
 */
let MOLDE_GIT = null

async function prepararMolde() {
  const dir = await mkdtemp(join(tmpdir(), `${PREFIXO_TMP}molde-`))
  await git(dir, ['init', '--quiet', '-b', 'principal'])
  MOLDE_GIT = { raiz: dir, git: join(dir, '.git') }
}

async function montarLado(origem, commits, modos) {
  const tmp = await mkdtemp(join(tmpdir(), PREFIXO_TMP))
  try {
    await cp(origem, tmp, { recursive: true })
    // O `.git` entra DEPOIS da árvore, na mesma ordem em que o `git init`
    // entrava: se um dia uma fixture trouxer um `.git` próprio, o molde
    // continua vencendo, como o init vencia.
    await cp(MOLDE_GIT.git, join(tmp, '.git'), { recursive: true })
    // `git add` UMA vez e fora do laço. A árvore é copiada inteira antes do
    // primeiro commit e não muda mais entre eles, então repetir o add por
    // commit não acrescentava nada; e com `commits: []` não há iteração
    // nenhuma, de modo que o add lá dentro deixaria o índice vazio — o
    // `git ls-files` do index.mjs veria um repositório SEM ARQUIVO, que é
    // outro alvo, não o que o caso declarou.
    await git(tmp, ['add', '-A'])
    // MODO DE ARQUIVO NO ÍNDICE. `git add` no Windows grava tudo como 100644
    // porque o sistema não tem bit de execução — então sem isto NENHUMA fixture
    // consegue declarar um hook executável, e a regra `hooks-executaveis` fica
    // improvável na única plataforma onde este repositório é escrito. O
    // `--chmod` age no índice, que é exatamente a camada que a regra lê e a
    // única que viaja no clone.
    for (const [caminho, modo] of Object.entries(modos || {})) {
      await git(tmp, ['update-index', `--chmod=${modo === '100755' ? '+x' : '-x'}`, caminho])
    }
    for (const [i, commit] of commits.entries()) {
      // --allow-empty porque um lado legítimo pode não ter arquivo nenhum (a
      // árvore vazia é o `reprovar` natural de `licenca`) e porque o 2º commit
      // declarado costuma não mudar a árvore — o caso de `coautoria-ia` só
      // muda a MENSAGEM. Sem isto o git sai 1 e a prova morre por acidente.
      // --quiet corta o resumo que a gente descarta; --no-verify é cinto de
      // segurança contra hook que venha de um core.hooksPath futuro.
      await git(
        tmp,
        [
          'commit',
          '--quiet',
          '--no-verify',
          '--allow-empty',
          '--author',
          commit.autor,
          '-m',
          commit.mensagem,
        ],
        i,
      )
    }
    return tmp
  } catch (e) {
    await apagar(tmp)
    throw e
  }
}

async function rodarRegra(id, dir) {
  // --heuristicas SEMPRE. Medido nas quatro combinações: com `--regra=` apontando
  // para regra determinística a flag é no-op (editorconfig sai 1 com e sem ela,
  // porque nenhuma heurística chega a rodar sob o filtro); com `--regra=` numa
  // heurística é a ÚNICA forma do lado `reprovar` sair 1 — sem a flag `telefone`
  // acusa o telefone e ainda assim sai 0, e a prova seria impossível de escrever.
  // Sem isto as 5 heurísticas ficariam para sempre sem caso.
  //
  // process.execPath + caminho do script: nada de `npx`, que sem shell:true
  // não existe como executável no Windows. Foi o bug que quebrou o alicerce.
  //
  // --json porque exit code não distingue "passou" de "na": os dois saem 0.
  // Enquanto o veredito vinha do código de saída, TODO ramo N/A do index.mjs
  // era intravável por construção do formato — 13 quando a auditoria contou,
  // 17 depois que as guardas de leitura entraram. `stdout` e `stderr` vêm
  // SEPARADOS — juntá-los, como esta função fazia, destruía a única evidência
  // barata de que o checker morreu: qualquer coisa em stderr suja o JSON.
  const r = await rodar(
    process.execPath,
    [INDEX, `--regra=${id}`, '--heuristicas', '--json', dir],
    {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: SEM_CONFIG,
        GIT_CONFIG_SYSTEM: SEM_CONFIG,
        NO_COLOR: '1',
      },
    },
  )
  if (r.erro) throw new Error(`não consegui rodar o index.mjs: ${r.erro.message}`)
  return { codigo: r.codigo, stdout: r.stdout || '', stderr: (r.stderr || '').trim() }
}

const primeiraLinha = (t) => t.split('\n').filter((l) => l.trim())[0] || ''

/**
 * Traduz uma execução do index.mjs em UM estado observado.
 *
 * Tudo que não for um estado de regra legível vira `quebrou`, e `quebrou`
 * nunca bate com lado nenhum. É o conserto do furo mais grosseiro do formato
 * antigo: um index.mjs com erro de sintaxe faz o node sair 1, e como o lado
 * `reprovar` esperava exatamente 1, os 15 casos marcavam metade verde com o
 * checker morto. Aqui, três sinais independentes denunciam o instrumento
 * torto: exit 127, qualquer byte em stderr, e stdout que não é JSON.
 */
function observar(exec) {
  const { codigo, stdout, stderr } = exec
  if (codigo === 2)
    return { estado: 'malformada', detalhe: 'exit 2 — alvo inválido ou invocação errada' }
  if (codigo === null) return { estado: 'quebrou', detalhe: 'o processo morreu por sinal' }
  if (codigo === 127) return { estado: 'quebrou', detalhe: 'exit 127 — a regra LANÇOU' }
  if (stderr) return { estado: 'quebrou', detalhe: `escreveu em stderr: ${primeiraLinha(stderr)}` }

  let dados
  try {
    dados = JSON.parse(stdout)
  } catch (e) {
    return {
      estado: 'quebrou',
      detalhe: `não produziu JSON parseável (exit ${codigo}): ${primeiraLinha(e.message)}`,
    }
  }
  if (!Array.isArray(dados) || dados.length !== 1)
    return { estado: 'quebrou', detalhe: 'o --json não devolveu exatamente uma avaliação' }
  if (dados[0].erro)
    return { estado: 'malformada', detalhe: `o index.mjs recusou o alvo: ${dados[0].erro}` }

  const res = dados[0].resultados
  if (!Array.isArray(res) || res.length !== 1) {
    const quantos = Array.isArray(res) ? res.length : 'nenhum'
    return { estado: 'quebrou', detalhe: `--regra= devolveu ${quantos} resultado(s), esperava 1` }
  }
  const { estado, motivo } = res[0]
  if (typeof estado !== 'string') return { estado: 'quebrou', detalhe: 'resultado sem "estado"' }
  if (estado === 'quebrou') return { estado: 'quebrou', detalhe: `a regra LANÇOU: ${motivo}` }

  // Trava também o CONTRATO do exit code, que era a única coisa que o formato
  // antigo checava e que o novo perderia de vista se só olhasse o JSON. Com
  // `--heuristicas` ligado, reprovou tem de sair 1 e passou/na têm de sair 0,
  // inclusive para regra heurística.
  const codigoDevido = estado === 'reprovou' ? 1 : 0
  if (codigo !== codigoDevido) {
    return {
      estado: 'quebrou',
      detalhe: `estado "${estado}" e exit ${codigo} não combinam — devia sair ${codigoDevido}`,
    }
  }
  return { estado, detalhe: motivo || '' }
}

async function provarLado(id, lado, spec) {
  let tmp = null
  try {
    tmp = await montarLado(spec.dir, spec.commits, spec.modos)
    const obs = observar(await rodarRegra(id, tmp))
    const veredito =
      obs.estado === spec.estado
        ? 'bateu'
        : obs.estado === 'quebrou' || obs.estado === 'malformada'
          ? obs.estado
          : 'divergiu'
    return { lado, veredito, esperado: spec.estado, obtido: obs.estado, detalhe: obs.detalhe }
  } catch (e) {
    // Falhou montando a fixture: é a prova que está torta, não a regra.
    return {
      lado,
      veredito: 'malformada',
      esperado: spec.estado,
      obtido: null,
      detalhe: e.message,
    }
  } finally {
    if (tmp) await apagar(tmp)
  }
}

/**
 * Os dois lados de um caso rodam em SÉRIE dentro do caso, e são os casos que
 * correm em paralelo. É de propósito: assim a piscina inteira tem no máximo
 * TETO fixtures montadas ao mesmo tempo, e o número de gits simultâneos é o
 * que foi medido, não o dobro dele.
 */
async function provarCaso(caso) {
  const saidas = []
  for (const lado of LADOS) saidas.push(await provarLado(caso.regra, lado, caso.lados[lado]))
  return saidas
}

// ──────────────────────────────────────────────── inventário e apresentação

/**
 * Descobre os ids que o index.mjs conhece sem importá-lo (ele é um CLI que
 * chama process.exit) e sem duplicar a lista aqui — lista duplicada envelhece.
 * Um id impossível faz o index.mjs sair 2 imprimindo "disponíveis: ...".
 * Se um dia a mensagem mudar, devolve null e a validação prévia só some.
 */
async function regrasConhecidas() {
  const r = await rodar(process.execPath, [INDEX, '--regra=__inexistente__'], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  const linha = `${r.stderr || ''}`.split('\n').find((l) => l.startsWith('disponíveis:'))
  if (!linha) return null
  return linha
    .slice('disponíveis:'.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const MARCA = {
  bateu: () => c.verde('✓'),
  divergiu: () => c.vermelho('✗'),
  quebrou: () => c.amarelo('⚠'),
  malformada: () => c.amarelo('⚠'),
}

function morrer(mensagem) {
  console.error(`${c.vermelho('provar:')} ${mensagem}`)
  process.exit(2)
}

// ───────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
if (args.some((a) => a === '-h' || a === '--ajuda' || a === '--help')) {
  console.log('uso: node provar.mjs [id-da-regra]')
  process.exit(0)
}
const flags = args.filter((a) => a.startsWith('-'))
if (flags.length)
  morrer(`opção desconhecida: ${flags.join(', ')} — uso: node provar.mjs [id-da-regra]`)
if (args.length > 1) morrer('um id de regra por vez')
const soEste = args[0] || null

if (!existsSync(INDEX)) morrer(`index.mjs não está em ${INDEX}`)
if (!existsSync(CASOS))
  morrer(
    `${CASOS} não existe — 19 regras e nenhum caso é exatamente o buraco que estas provas fecham`,
  )

const regras = await regrasConhecidas()

let ids = readdirSync(CASOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort()

if (soEste) {
  // Aceita o id da regra (roda todas as variantes dela) ou o nome exato da
  // pasta (roda uma variante só).
  const escolhidos = ids.filter((i) => i === soEste || i.startsWith(`${soEste}__`))
  if (!escolhidos.length) morrer(`não existe caso para "${soEste}" em ${CASOS}`)
  ids = escolhidos
}
if (!ids.length) morrer(`nenhum caso em ${CASOS}`)

const largura = Math.max(...ids.map((i) => i.length), 12)
console.log(`\n${c.forte('rebar-check')} · ${c.forte('provas')} · ${ids.length} caso(s)`)

let bateram = 0
let divergiram = 0
let quebrados = 0
let malformados = 0
// Caso mal formado NÃO conta como regra provada. Contar a pasta em vez do caso
// deixaria a cobertura subir sozinha só porque alguém criou um diretório.
const provadas = []

// Ler os casos é síncrono e barato (JSON pequeno); fica FORA da piscina, na
// ordem alfabética, para que "prova mal formada" seja decidida antes de gastar
// processo com ela.
const trabalhos = ids.map((id) => {
  const caso = lerCaso(id)
  // Id que o index.mjs não conhece é prova mal formada. Pegar aqui evita montar
  // duas fixtures inteiras só para o index.mjs sair 2 nas duas.
  if (regras && caso.regra && !regras.includes(caso.regra))
    caso.erros.push(`o index.mjs não conhece a regra "${caso.regra}"`)
  return { id, caso }
})

/**
 * A impressão de UM caso. Só é chamada pelo escoador, e o escoador só chama em
 * ordem de índice — é aqui que a saída volta a ser determinística depois de os
 * casos terem terminado em qualquer ordem. Os contadores também sobem aqui,
 * pelo mesmo motivo: contador que sobe na ordem de término é contador que
 * ninguém consegue reproduzir.
 */
function imprimirCaso({ id, caso }, resultados) {
  if (caso.erros.length) {
    malformados++
    console.log(`  ${c.amarelo('⚠')} ${id.padEnd(largura)} ${c.amarelo('MAL FORMADA')}`)
    for (const e of caso.erros) console.log(`      ${c.fraco(e)}`)
    return
  }

  if (!provadas.includes(caso.regra)) provadas.push(caso.regra)
  const pior = resultados.find((x) => x.veredito !== 'bateu')

  const resumoLados = resultados
    .map((x) => {
      // Imprime o estado, não o exit code: era o exit code que escondia a
      // diferença entre "passou" e "na", e placar que esconde não confere.
      const txt = `${x.lado} ${x.obtido || '—'}`
      return x.veredito === 'bateu' ? c.verde(txt) : c.vermelho(txt)
    })
    .join(c.fraco(' · '))
  console.log(`  ${MARCA[pior ? pior.veredito : 'bateu']()} ${id.padEnd(largura)} ${resumoLados}`)

  if (!pior) {
    bateram++
    return
  }
  if (resultados.some((x) => x.veredito === 'malformada')) malformados++
  else if (resultados.some((x) => x.veredito === 'quebrou')) quebrados++
  else divergiram++

  console.log(`      ${c.fraco(`porque: ${caso.porque}`)}`)
  for (const x of resultados) {
    if (x.veredito === 'bateu') continue
    const explica = {
      divergiu: `esperava "${x.esperado}", observei "${x.obtido}"`,
      quebrou: `o index.mjs QUEBROU — instrumento torto, não achado sobre o alvo`,
      malformada: 'não consegui montar ou rodar a fixture',
    }[x.veredito]
    console.log(`      ${c.vermelho(`${x.lado}/`)} ${explica}`)
    for (const l of String(x.detalhe).split('\n').filter(Boolean).slice(0, 6))
      console.log(`        ${c.fraco(`│ ${l}`)}`)
  }
}

// O balde indexado + o escoador: cada caso deposita o resultado no SEU índice e
// a impressão anda enquanto o próximo índice estiver pronto. Quem termina fora
// de ordem espera; quem termina na vez imprime na hora, e a rodada continua
// mostrando progresso em vez de cuspir tudo no fim.
const feitos = new Array(trabalhos.length)
let aImprimir = 0
function escoar() {
  while (aImprimir < trabalhos.length && feitos[aImprimir] !== undefined) {
    imprimirCaso(trabalhos[aImprimir], feitos[aImprimir])
    aImprimir++
  }
}

// O molde é a única coisa que a rodada inteira depende antes de começar. Se
// ele não sobe — git ausente do PATH, tmpdir sem permissão — isto tem de sair
// 2, e não morrer com stack trace: a versão serial dava 47 casos "MAL FORMADA"
// e exit 2 nesse cenário, e o código de saída não pode mudar por causa da
// piscina.
try {
  await prepararMolde()
} catch (e) {
  morrer(`não consegui preparar o molde git em ${tmpdir()}: ${e.message}`)
}

// A piscina: TETO trabalhadores dividindo uma fila por índice. Nada de
// `Promise.all` sobre os 47 casos — 94 gits simultâneos brigam pelo disco e a
// rodada fica MAIS lenta, além de deixar 47 fixtures montadas de uma vez.
let proximo = 0
await Promise.all(
  Array.from({ length: Math.min(TETO, trabalhos.length) }, async () => {
    for (;;) {
      const i = proximo++
      if (i >= trabalhos.length) return
      const { caso } = trabalhos[i]
      // `null` marca "sem lados rodados" e ainda é diferente de `undefined`,
      // que é o que o escoador usa para saber que o índice não chegou.
      feitos[i] = caso.erros.length ? null : await provarCaso(caso)
      escoar()
    }
  }),
)
escoar()

// Varredura em vez de `apagar(MOLDE_GIT.raiz)`: o molde é só uma das pastas
// desta rodada, e a varredura pega ele e qualquer lado cujo `rm` tenha falhado.
await varrerRestos()

const total = ids.length
const placar = `${bateram} de ${total} caso(s) bateram`
console.log(
  `\n  ${bateram === total ? c.verde(placar) : c.vermelho(placar)}` +
    (divergiram ? c.vermelho(`  ·  ${divergiram} divergiu`) : '') +
    (quebrados ? c.amarelo(`  ·  ${quebrados} com o index.mjs QUEBRADO`) : '') +
    (malformados ? c.amarelo(`  ·  ${malformados} mal formada(s)`) : ''),
)
// Linha própria, e não uma contagem a mais na linha de cima: quando o checker
// está quebrado o placar de casos não quer dizer nada, e o leitor tem de ver
// isso antes de tirar qualquer conclusão sobre as regras.
if (quebrados) {
  console.log(
    c.amarelo(
      `  ⚠ o instrumento está torto: o index.mjs quebrou em ${quebrados} caso(s). ` +
        'Nenhum veredito desta rodada vale sobre regra nenhuma.',
    ),
  )
}

// Cobertura só informa. Fazer ela derrubar o exit code deixaria a suíte vermelha
// até a 19ª regra ganhar caso, e suíte que nasce vermelha ninguém olha.
if (regras && !soEste) {
  const sem = regras.filter((r) => !provadas.includes(r))
  console.log(
    c.fraco(`  ${regras.length - sem.length} de ${regras.length} regras com prova`) +
      (sem.length ? c.fraco(`  ·  sem prova: ${sem.join(', ')}`) : ''),
  )
}

console.log('')
if (malformados) process.exit(2)
process.exit(divergiram || quebrados ? 1 : 0)
