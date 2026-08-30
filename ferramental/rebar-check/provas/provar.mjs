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

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
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

function ambienteGit(iCommit) {
  const carimbo = `${EPOCA_FIXA + iCommit * 60} +0000`
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: SEM_CONFIG,
    GIT_CONFIG_SYSTEM: SEM_CONFIG,
    GIT_AUTHOR_DATE: carimbo,
    GIT_COMMITTER_DATE: carimbo,
    GIT_TERMINAL_PROMPT: '0',
  }
}

function git(dir, args, iCommit = 0) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: ambienteGit(iCommit) })
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`)
  if (r.status !== 0) {
    const detalhe = `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n')[0]
    throw new Error(`git ${args.join(' ')} saiu ${r.status}: ${detalhe}`)
  }
  return (r.stdout || '').trim()
}

/**
 * Diretórios montados e ainda não apagados. Existe por causa do Ctrl+C: o
 * `finally` de cada lado cobre erro e sucesso, mas não cobre morte por sinal —
 * medido, 4 diretórios `rebar-prova-*` ficaram para trás de uma execução
 * interrompida no meio. Set, e não variável, porque o mesmo processo pode ter
 * mais de um lado montado se um dia isto rodar em paralelo.
 */
const emVoo = new Set()

function apagar(dir) {
  emVoo.delete(dir)
  // maxRetries porque no Windows o git deixa objeto em .git/objects somente
  // leitura e o antivírus segura o handle por alguns milissegundos.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    /* é temporário; o SO limpa */
  }
}

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    for (const d of [...emVoo]) apagar(d)
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
    lados[lado] = { dir, estado, commits: lerCommits(bloco, lado, erros) }
  }

  return {
    regra,
    erros,
    porque: typeof bruto.porque === 'string' ? bruto.porque.trim() : '',
    lados,
  }
}

// ─────────────────────────────────────────────────────── execução de um lado

function montarLado(origem, commits) {
  const tmp = mkdtempSync(join(tmpdir(), 'rebar-prova-'))
  emVoo.add(tmp)
  try {
    cpSync(origem, tmp, { recursive: true })
    git(tmp, ['init', '-b', 'principal'])
    // LOCAIS, nunca --global: a prova não encosta na identidade da máquina.
    git(tmp, ['config', 'user.name', 'Prova'])
    git(tmp, ['config', 'user.email', 'prova@rebar.local'])
    // `git add` UMA vez e fora do laço. A árvore é copiada inteira antes do
    // primeiro commit e não muda mais entre eles, então repetir o add por
    // commit não acrescentava nada; e com `commits: []` não há iteração
    // nenhuma, de modo que o add lá dentro deixaria o índice vazio — o
    // `git ls-files` do index.mjs veria um repositório SEM ARQUIVO, que é
    // outro alvo, não o que o caso declarou.
    git(tmp, ['add', '-A'])
    commits.forEach((commit, i) => {
      // --allow-empty porque um lado legítimo pode não ter arquivo nenhum (a
      // árvore vazia é o `reprovar` natural de `licenca`) e porque o 2º commit
      // declarado costuma não mudar a árvore — o caso de `coautoria-ia` só
      // muda a MENSAGEM. Sem isto o git sai 1 e a prova morre por acidente.
      git(tmp, ['commit', '--allow-empty', '--author', commit.autor, '-m', commit.mensagem], i)
    })
    return tmp
  } catch (e) {
    apagar(tmp)
    throw e
  }
}

function rodarRegra(id, dir) {
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
  const r = spawnSync(process.execPath, [INDEX, `--regra=${id}`, '--heuristicas', '--json', dir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: SEM_CONFIG,
      GIT_CONFIG_SYSTEM: SEM_CONFIG,
      NO_COLOR: '1',
    },
  })
  if (r.error) throw new Error(`não consegui rodar o index.mjs: ${r.error.message}`)
  return { codigo: r.status, stdout: r.stdout || '', stderr: (r.stderr || '').trim() }
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

function provarLado(id, lado, spec) {
  let tmp = null
  try {
    tmp = montarLado(spec.dir, spec.commits)
    const obs = observar(rodarRegra(id, tmp))
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
    if (tmp) apagar(tmp)
  }
}

// ──────────────────────────────────────────────── inventário e apresentação

/**
 * Descobre os ids que o index.mjs conhece sem importá-lo (ele é um CLI que
 * chama process.exit) e sem duplicar a lista aqui — lista duplicada envelhece.
 * Um id impossível faz o index.mjs sair 2 imprimindo "disponíveis: ...".
 * Se um dia a mensagem mudar, devolve null e a validação prévia só some.
 */
function regrasConhecidas() {
  const r = spawnSync(process.execPath, [INDEX, '--regra=__inexistente__'], {
    encoding: 'utf8',
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

const regras = regrasConhecidas()

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

for (const id of ids) {
  const caso = lerCaso(id)
  // Id que o index.mjs não conhece é prova mal formada. Pegar aqui evita montar
  // duas fixtures inteiras só para o index.mjs sair 2 nas duas.
  if (regras && caso.regra && !regras.includes(caso.regra))
    caso.erros.push(`o index.mjs não conhece a regra "${caso.regra}"`)

  if (caso.erros.length) {
    malformados++
    console.log(`  ${c.amarelo('⚠')} ${id.padEnd(largura)} ${c.amarelo('MAL FORMADA')}`)
    for (const e of caso.erros) console.log(`      ${c.fraco(e)}`)
    continue
  }

  if (!provadas.includes(caso.regra)) provadas.push(caso.regra)
  const resultados = LADOS.map((lado) => provarLado(caso.regra, lado, caso.lados[lado]))
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
    continue
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
