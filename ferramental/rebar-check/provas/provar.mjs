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
// Códigos de saída — mesma disciplina do index.mjs, três coisas, três códigos:
//   0    todo lado bateu com o esperado
//   1    algum lado DIVERGIU (inclui regra que QUEBROU dentro do index.mjs:
//        exit 127 é achado legítimo da prova, não defeito dela)
//   2    a própria PROVA está mal formada — e isso domina o 1, pelo mesmo
//        motivo que no index.mjs o 127 domina o 1: não se acusa ninguém com
//        um instrumento que está torto.
//
// NUNCA escreve no repositório. Cada lado é montado num diretório novo de
// os.tmpdir() e apagado no finally. O provar-portao.mjs do alicerce fazia
// writeFileSync + git add DENTRO do repo vivo — defeito conhecido que este
// arquivo se recusa a herdar.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
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

/** aprovar/ tem de sair 0. reprovar/ tem de sair 1. Não há terceiro lado. */
const ESPERADO = { aprovar: 0, reprovar: 1 }

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
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* é temporário; o SO limpa */ }
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
  if (!Array.isArray(bloco.commits) || !bloco.commits.length) {
    erros.push(`"${lado}.commits" tem de ser lista não vazia`)
    return [COMMIT_PADRAO]
  }
  const saida = []
  bloco.commits.forEach((cm, i) => {
    const onde = `${lado}.commits[${i}]`
    if (!cm || typeof cm !== 'object' || Array.isArray(cm)) { erros.push(`${onde} não é objeto`); return }
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
  try { bruto = JSON.parse(readFileSync(arquivo, 'utf8')) }
  catch (e) { return { erros: [`caso.json ilegível: ${e.message}`] } }
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
  for (const lado of Object.keys(ESPERADO)) {
    const dir = join(base, lado)
    if (!existsSync(dir)) { erros.push(`falta a pasta ${lado}/`); continue }
    if (!statSync(dir).isDirectory()) { erros.push(`${lado}/ existe e não é pasta`); continue }
    lados[lado] = { dir, commits: lerCommits(bruto[lado], lado, erros) }
  }

  return { regra, erros, porque: typeof bruto.porque === 'string' ? bruto.porque.trim() : '', lados }
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
    commits.forEach((commit, i) => {
      git(tmp, ['add', '-A'], i)
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
  const r = spawnSync(process.execPath, [INDEX, `--regra=${id}`, '--heuristicas', dir], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: SEM_CONFIG, GIT_CONFIG_SYSTEM: SEM_CONFIG, NO_COLOR: '1' },
  })
  if (r.error) throw new Error(`não consegui rodar o index.mjs: ${r.error.message}`)
  return { codigo: r.status, saida: `${r.stdout || ''}${r.stderr || ''}`.trim() }
}

function provarLado(id, lado, spec) {
  let tmp = null
  try {
    tmp = montarLado(spec.dir, spec.commits)
    const { codigo, saida } = rodarRegra(id, tmp)
    const esperado = ESPERADO[lado]
    let estado = 'divergiu'
    if (codigo === esperado) estado = 'bateu'
    else if (codigo === 2) estado = 'malformada'   // alvo inválido ou regra que o index.mjs não conhece
    else if (codigo === 127) estado = 'quebrou'    // a regra lançou: achado da prova, não defeito dela
    return { lado, estado, codigo, esperado, saida }
  } catch (e) {
    // Falhou montando a fixture: é a prova que está torta, não a regra.
    return { lado, estado: 'malformada', codigo: null, esperado: ESPERADO[lado], saida: e.message }
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
    encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  })
  const linha = `${r.stderr || ''}`.split('\n').find((l) => l.startsWith('disponíveis:'))
  if (!linha) return null
  return linha.slice('disponíveis:'.length).split(',').map((s) => s.trim()).filter(Boolean)
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
if (flags.length) morrer(`opção desconhecida: ${flags.join(', ')} — uso: node provar.mjs [id-da-regra]`)
if (args.length > 1) morrer('um id de regra por vez')
const soEste = args[0] || null

if (!existsSync(INDEX)) morrer(`index.mjs não está em ${INDEX}`)
if (!existsSync(CASOS)) morrer(`${CASOS} não existe — 19 regras e nenhum caso é exatamente o buraco que estas provas fecham`)

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
let malformados = 0
// Caso mal formado NÃO conta como regra provada. Contar a pasta em vez do caso
// deixaria a cobertura subir sozinha só porque alguém criou um diretório.
const provadas = []

for (const id of ids) {
  const caso = lerCaso(id)
  // Id que o index.mjs não conhece é prova mal formada. Pegar aqui evita montar
  // duas fixtures inteiras só para o index.mjs sair 2 nas duas.
  if (regras && caso.regra && !regras.includes(caso.regra)) caso.erros.push(`o index.mjs não conhece a regra "${caso.regra}"`)

  if (caso.erros.length) {
    malformados++
    console.log(`  ${c.amarelo('⚠')} ${id.padEnd(largura)} ${c.amarelo('MAL FORMADA')}`)
    for (const e of caso.erros) console.log(`      ${c.fraco(e)}`)
    continue
  }

  if (!provadas.includes(caso.regra)) provadas.push(caso.regra)
  const resultados = Object.keys(ESPERADO).map((lado) => provarLado(caso.regra, lado, caso.lados[lado]))
  const pior = resultados.find((x) => x.estado !== 'bateu')

  const resumoLados = resultados
    .map((x) => `${x.lado} ${x.estado === 'bateu' ? c.verde(`exit ${x.codigo}`) : c.vermelho(`exit ${x.codigo}`)}`)
    .join(c.fraco(' · '))
  console.log(`  ${MARCA[pior ? pior.estado : 'bateu']()} ${id.padEnd(largura)} ${resumoLados}`)

  if (!pior) { bateram++; continue }
  if (resultados.some((x) => x.estado === 'malformada')) malformados++
  else divergiram++

  console.log(`      ${c.fraco(`porque: ${caso.porque}`)}`)
  for (const x of resultados) {
    if (x.estado === 'bateu') continue
    const explica = {
      divergiu: `esperava exit ${x.esperado}, saiu ${x.codigo}`,
      quebrou: `exit 127 — a regra LANÇOU: defeito do index.mjs, não do alvo`,
      malformada: x.codigo === 2 ? 'exit 2 — alvo inválido ou invocação errada' : 'não consegui montar a fixture',
    }[x.estado]
    console.log(`      ${c.vermelho(`${x.lado}/`)} ${explica}`)
    for (const l of x.saida.split('\n').filter(Boolean).slice(0, 6)) console.log(`        ${c.fraco(`│ ${l}`)}`)
  }
}

const total = ids.length
const placar = `${bateram} de ${total} caso(s) bateram`
console.log(`\n  ${bateram === total ? c.verde(placar) : c.vermelho(placar)}` +
  (divergiram ? c.vermelho(`  ·  ${divergiram} divergiu`) : '') +
  (malformados ? c.amarelo(`  ·  ${malformados} mal formada(s)`) : ''))

// Cobertura só informa. Fazer ela derrubar o exit code deixaria a suíte vermelha
// até a 19ª regra ganhar caso, e suíte que nasce vermelha ninguém olha.
if (regras && !soEste) {
  const sem = regras.filter((r) => !provadas.includes(r))
  console.log(c.fraco(`  ${regras.length - sem.length} de ${regras.length} regras com prova`) +
    (sem.length ? c.fraco(`  ·  sem prova: ${sem.join(', ')}`) : ''))
}

console.log('')
if (malformados) process.exit(2)
process.exit(divergiram ? 1 : 0)
