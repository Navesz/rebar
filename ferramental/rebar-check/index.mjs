#!/usr/bin/env node
// rebar-check — roda contra QUALQUER repositório e imprime um placar.
//
// Por que isto existe antes do gerador: o alicerce morreu porque a imposição
// nunca encostou num projeto. Checar é retroativo e funciona nos repositórios
// que já existem; gerar só serve para o próximo. A inversão certa não é
// gerador-primeiro, é CONSUMIDOR-primeiro.
//
// Zero dependência: só built-ins do Node. O que confere o build não pode
// depender do build, e assim `npx github:Navesz/rebar` funciona sem instalar.
//
// Nunca escreve nada. Lê o repositório e sai.
//
// Uso:
//   node index.mjs [caminho...]        placar por repositório
//   node index.mjs --json [caminho]    saída para CI
//   node index.mjs --regra=<id> [dir]  uma regra só (é o que as provas usam)
//   node index.mjs --heuristicas       heurísticas também derrubam o exit code
//
// Códigos de saída — três coisas diferentes, três códigos diferentes:
//   0    tudo que se aplica passou
//   1    REPROVOU: violação real
//   2    alvo inválido (não é repositório git) ou invocação errada
//   127  QUEBROU: uma regra lançou exceção. Defeito do rebar-check, não do alvo.
//
// A distinção do 1 contra o 127 é a §8.2 do plano ("verificar.mjs:124 →
// distinguir reprovou de quebrou"). Sem ela o bug do verificador entra na
// conta como se fosse defeito do repositório auditado.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

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
 * "Não se aplica" é um TERCEIRO estado, e criá-lo foi o conserto mais caro
 * deste arquivo. Antes, regra sem objeto para checar devolvia `null` — o mesmo
 * que "passou". Consequência medida: uma pasta VAZIA com um `.git/` vazio
 * tirava 8 de 14, empatando com o próprio rebar e tirando o DOBRO do alicerce.
 * O nada não conforma; o nada não se aplica. N/A sai do DENOMINADOR.
 */
const na = (motivo) => ({ na: motivo })

/**
 * Roda git. Distingue as duas coisas que antes eram a mesma:
 *   { ok: true,  saida }  — rodou, pode ter saído vazio (repo sem commit é válido)
 *   { ok: false, erro }   — o git falhou ou não existe
 * O `catch { return '' }` de antes engolia "fatal: not a git repository" e
 * devolvia string vazia, então `coautoria-ia` e `identidade-git` aprovavam um
 * diretório que nem era repositório. Crash virava aprovação.
 */
function git(dir, args) {
  try {
    const saida = execFileSync('git', args, {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, saida: saida.trim() }
  } catch (e) {
    return { ok: false, erro: (e.stderr || e.message || '').toString().trim().split('\n')[0] }
  }
}

function lerJson(dir, rel) {
  try { return JSON.parse(readFileSync(join(dir, rel), 'utf8')) } catch { return null }
}

function ler(dir, rel) {
  try { return readFileSync(join(dir, rel), 'utf8') } catch { return null }
}

function existe(dir, rel) {
  try { return existsSync(join(dir, rel)) } catch { return false }
}

const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|astro)$/i
const IGNORAR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|vendor)\//

/**
 * Um arquivo é teste se um SEGMENTO do caminho for pasta de teste, ou se o
 * NOME for de teste. Por segmento, não por substring: "aprovar/" contém
 * "provar" e não é pasta de teste.
 *
 * O português entra aqui porque a versão anterior era cega a ele. Medido no
 * alicerce: 43 arquivos rastreados com "prova" no nome, e a regra enxergava
 * ZERO — um checker escrito em português que não reconhece teste nomeado em
 * português. Era um dos dois falsos positivos determinísticos provados.
 */
const PASTA_TESTE = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs',
  'teste', 'testes', 'prova', 'provas',
])
const NOME_TESTE = /(\.|^)(test|spec|teste|prova)\.|^(provar|testar)[-.]/i

function ehTeste(rel) {
  const partes = rel.split('/')
  if (partes.slice(0, -1).some((p) => PASTA_TESTE.has(p.toLowerCase()))) return true
  return NOME_TESTE.test(partes[partes.length - 1])
}

/** Conteúdo dos arquivos de código rastreados, com teto de tamanho. */
function fontes(dir, arquivos) {
  const out = []
  for (const a of arquivos) {
    if (!CODIGO.test(a) || IGNORAR.test(a) || ehTeste(a)) continue
    try {
      if (statSync(join(dir, a)).size > 512 * 1024) continue
      out.push([a, readFileSync(join(dir, a), 'utf8')])
    } catch { /* arquivo sumiu entre o ls-files e a leitura */ }
  }
  return out
}

/**
 * Expande o que o CI de fato executa. Um workflow que roda `npm run verificar`
 * está rodando o corpo de `verificar` — e, se aquele corpo chamar outro script,
 * está rodando aquele também.
 *
 * Sem isto, `ci-gateia` procurava as palavras lint/typecheck/test literais no
 * YAML e reprovava todo repositório que agrega a verificação num comando só.
 * Era o segundo falso positivo determinístico provado.
 */
function textoEfetivoDoCi(yml, scripts, profundidade = 3) {
  let texto = yml
  const vistos = new Set()
  for (let i = 0; i < profundidade; i++) {
    let cresceu = false
    for (const [nome, corpo] of Object.entries(scripts)) {
      if (vistos.has(nome)) continue
      // `npm run x`, `pnpm x`, `yarn x`, `run-s x`, `run-p x`
      const invocado = new RegExp(`(?:npm\\s+run|pnpm\\s+(?:run\\s+)?|yarn\\s+(?:run\\s+)?|run-[sp])\\s+${nome}\\b`)
      if (invocado.test(texto)) { texto += '\n' + corpo; vistos.add(nome); cresceu = true }
    }
    if (!cresceu) break
  }
  return texto
}

// ──────────────────────────────────────────────────────────────── as regras
//
// classe: 'determinística' derruba o exit code · 'heurística' só informa.
// A distinção não é estética: a regra de cor literal, quando medida no herz,
// deu SETE ocorrências e ZERO verdadeiros positivos — cinco eram comentários
// documentando a própria regra. Regra automática errada custa mais que regra
// ausente, e heurística que barra ensina a desligar a saída inteira.
//
// `checar` devolve UMA de quatro coisas:
//   null            passou
//   'motivo'        reprovou
//   na('motivo')    não se aplica — sai do denominador
//   (lança)         quebrou — exit 127, defeito do rebar-check

const REGRAS = [

  // ── determinísticas ─────────────────────────────────────────────────────

  { id: 'editorconfig', classe: 'determinística', nivel: 'N1',
    titulo: 'tem .editorconfig',
    checar: (r) => existe(r.dir, '.editorconfig') ? null : 'ausente' },

  { id: 'dependabot', classe: 'determinística', nivel: 'N4',
    titulo: 'atualização de dependência automatizada',
    checar: (r) => {
      if (!r.pkg) return na('não é projeto npm')
      return (existe(r.dir, '.github/dependabot.yml') || existe(r.dir, '.github/dependabot.yaml') ||
              existe(r.dir, 'renovate.json') || existe(r.dir, '.github/renovate.json'))
        ? null : 'sem dependabot nem renovate'
    } },

  { id: 'ci', classe: 'determinística', nivel: 'N4',
    titulo: 'tem CI',
    checar: (r) => r.workflows.length ? null : 'nenhum workflow em .github/workflows/' },

  { id: 'ci-gateia', classe: 'determinística', nivel: 'N4',
    titulo: 'o CI alcança a verificação que o repositório tem',
    checar: (r) => {
      if (!r.workflows.length) return na('sem CI — quem cobra isso é a regra `ci`')
      const scripts = r.pkg?.scripts || {}
      // Só cobra o que o repositório POSSUI. Exigir `lint` de um repo sem lint
      // é exigir que ele adote uma ferramenta — decisão de outro nível.
      const alvos = ['lint', 'typecheck', 'test'].filter((g) => scripts[g])
      if (!alvos.length) return na('package.json não tem script lint, typecheck nem test')
      const yml = r.workflows.map((w) => ler(r.dir, w) || '').join('\n')
      const efetivo = textoEfetivoDoCi(yml, scripts)
      const faltam = alvos.filter((g) => !new RegExp(`\\b${g}\\b`).test(efetivo))
      return faltam.length ? `o CI não alcança: ${faltam.join(', ')}` : null
    } },

  { id: 'testes', classe: 'determinística', nivel: 'N3',
    titulo: 'tem teste',
    checar: (r) => r.arquivos.some(ehTeste) ? null : 'zero arquivo de teste' },

  { id: 'typecheck', classe: 'determinística', nivel: 'N0',
    titulo: 'tem script de typecheck',
    checar: (r) => {
      if (!r.pkg) return na('não é projeto npm')
      if (!r.arquivos.some((a) => /\.(ts|tsx)$/i.test(a))) return na('não tem TypeScript')
      return r.pkg.scripts?.typecheck ? null : 'package.json sem script "typecheck"'
    } },

  { id: 'formatter', classe: 'determinística', nivel: 'N1',
    titulo: 'tem formatador',
    checar: (r) => {
      if (!r.pkg) return na('não é projeto npm')
      const d = { ...r.pkg.dependencies, ...r.pkg.devDependencies }
      return (d.prettier || d['@biomejs/biome'] || d.dprint) ? null : 'sem prettier, biome ou dprint'
    } },

  { id: 'env-example', classe: 'determinística', nivel: 'N2',
    titulo: 'lê env e documenta em .env.example',
    checar: (r) => {
      if (!r.varsEnv.size) return na('não lê variável de ambiente')
      if (!r.envExample) return `lê ${r.varsEnv.size} variável(is) de ambiente e não tem .env.example`
      const faltando = [...r.varsEnv].filter((v) => !new RegExp(`^${v}\\s*=`, 'm').test(r.envExample))
      return faltando.length ? `não documentadas: ${faltando.slice(0, 4).join(', ')}` : null
    } },

  { id: 'licenca', classe: 'determinística', nivel: 'N7',
    titulo: 'tem LICENSE',
    checar: (r) => r.arquivos.some((a) => /^LICEN[CS]E/i.test(a)) ? null : 'ausente' },

  { id: 'notice', classe: 'determinística', nivel: 'N7',
    titulo: 'Apache-2.0 acompanhado de NOTICE',
    checar: (r) => {
      const lic = r.arquivos.find((a) => /^LICEN[CS]E/i.test(a))
      if (!lic) return na('sem LICENSE — quem cobra isso é a regra `licenca`')
      if (!/Apache License/i.test(ler(r.dir, lic) || '')) return na('a licença não é Apache')
      return r.arquivos.some((a) => /^NOTICE/i.test(a)) ? null : 'licença Apache sem NOTICE'
    } },

  { id: 'coautoria-ia', classe: 'determinística', nivel: 'N5',
    titulo: 'nenhum commit com coautoria de IA',
    checar: (r) => {
      if (!r.commits.length) return na('repositório sem commit')
      const n = r.commits.filter((m) =>
        /^co-authored-by:.*(claude|anthropic|cursor|copilot|codex|devin|aider|gemini|noreply@anthropic)/im.test(m)
      ).length
      // A queixa original era "o Claude". Medido: o Cursor é 6x mais frequente,
      // e o trailer tem casing diferente. Regex que só pega Claude cobre 15%.
      return n ? `${n} de ${r.commits.length} commits` : null
    } },

  { id: 'identidade-git', classe: 'determinística', nivel: 'N4',
    titulo: 'identidade de autor consistente',
    checar: (r) => {
      if (!r.autores.length) return na('repositório sem commit')
      const ids = new Set(r.autores)
      if (ids.size <= 1) return null
      const pessoal = [...ids].filter((i) => !/@users\.noreply\.github\.com>/.test(i))
      const extra = pessoal.length ? ` (e-mail pessoal exposto: ${pessoal.length})` : ''
      return `${ids.size} combinações de nome/e-mail${extra}`
    } },

  { id: 'ui-falso', classe: 'determinística', nivel: 'N1',
    titulo: 'components/ui/ acompanhado de components.json',
    checar: (r) => {
      const temUi = r.arquivos.some((a) => /(^|\/)components\/ui\//.test(a))
      if (!temUi) return na('não tem pasta components/ui/')
      return existe(r.dir, 'components.json') ? null
        : 'pasta components/ui/ imitando a convenção, sem components.json'
    } },

  { id: 'schema-orfao', classe: 'determinística', nivel: 'N1',
    titulo: 'nenhum JSON Schema órfão',
    checar: (r) => {
      const schemas = r.arquivos.filter((a) => /\.schema\.json$/.test(a))
      if (!schemas.length) return na('nenhum .schema.json no repositório')
      const todo = r.fontes.map(([, t]) => t).join('\n')
      const orfaos = schemas.filter((s) => !todo.includes(basename(s)))
      return orfaos.length ? `definido e nunca lido: ${orfaos.slice(0, 3).join(', ')}` : null
    } },

  // ── heurísticas ─────────────────────────────────────────────────────────

  { id: 'shadcn-completo', classe: 'heurística', nivel: 'N1',
    titulo: 'shadcn com o aparato, não só a pasta',
    checar: (r) => {
      if (!existe(r.dir, 'components.json')) return na('não usa shadcn')
      const d = { ...r.pkg?.dependencies, ...r.pkg?.devDependencies }
      // ATENÇÃO: @radix-ui sozinho reprova o único repo que acertou. O Galegos
      // usa shadcn correto no estilo base-nova, com @base-ui/react e ZERO Radix.
      const primitiva = Object.keys(d).some((k) => k.startsWith('@radix-ui/') || k === '@base-ui/react')
      const faltam = []
      if (!primitiva) faltam.push('primitiva (@radix-ui/* ou @base-ui/react)')
      if (!d['class-variance-authority']) faltam.push('cva')
      if (!d['tailwind-merge']) faltam.push('tailwind-merge')
      return faltam.length ? `components.json sem ${faltam.join(', ')}` : null
    } },

  { id: 'telefone', classe: 'heurística', nivel: 'N1',
    titulo: 'sem telefone brasileiro no código',
    checar: (r) => {
      const re = /\(?\d{2}\)?\s?9\d{4}-?\d{4}|\b55\d{2}9\d{8}\b|wa\.me\/\d+/
      const hits = r.fontes.filter(([, t]) => re.test(t)).map(([a]) => a)
      return hits.length ? `${hits.length} arquivo(s): ${hits.slice(0, 3).join(', ')}` : null
    } },

  { id: 'url-producao', classe: 'heurística', nivel: 'N2',
    titulo: 'sem URL de produção fora de configuração',
    checar: (r) => {
      const re = /https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|json-schema\.org|fonts\.(?:googleapis|gstatic)\.com|registry\.npmjs)[a-z0-9.-]+\.(?:com|com\.br|br|app|dev|io|net|site)/i
      const hits = r.fontes.filter(([a, t]) => !/config|\.d\.ts$/i.test(a) && re.test(t)).map(([a]) => a)
      return hits.length ? `${hits.length} arquivo(s): ${hits.slice(0, 3).join(', ')}` : null
    } },

  { id: 'hex-cru', classe: 'heurística', nivel: 'N1',
    titulo: 'sem hex duplicando token do CSS',
    checar: (r) => {
      // Só acusa hex que JÁ EXISTE como token no CSS. Hex solto tem contexto
      // legítimo demais — material de three.js, véu de overlay — e a versão
      // ingênua desta regra deu 100% de falso positivo quando medida.
      const css = r.arquivos.filter((a) => /\.css$/.test(a))
      if (!css.length) return na('nenhum .css no repositório')
      const noCss = new Set()
      for (const a of css) for (const m of (ler(r.dir, a) || '').matchAll(/#[0-9a-f]{6}/gi)) noCss.add(m[0].toLowerCase())
      if (!noCss.size) return na('nenhuma cor hex no CSS')
      const dup = new Set()
      for (const [, t] of r.fontes) for (const m of t.matchAll(/#[0-9a-f]{6}/gi)) {
        if (noCss.has(m[0].toLowerCase())) dup.add(m[0].toLowerCase())
      }
      return dup.size ? `${dup.size} cor(es) definidas nos dois lugares: ${[...dup].slice(0, 3).join(', ')}` : null
    } },

  { id: 'idioma-unico', classe: 'heurística', nivel: 'N1',
    titulo: 'um idioma só no repositório',
    checar: (r) => {
      const pt = /\b(não|para|então|função|usuário|configuração|arquivo)\b/i
      const en = /\b(the|this|should|configuration|file|user)\b/i
      let ptN = 0, enN = 0
      for (const [, t] of r.fontes) {
        const com = t.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []
        const txt = com.join('\n')
        if (pt.test(txt)) ptN++
        if (en.test(txt)) enN++
      }
      const menor = Math.min(ptN, enN)
      return menor >= 3 ? `comentários em pt (${ptN}) e en (${enN}) no mesmo repositório` : null
    } },
]

// ────────────────────────────────────────────────────────── leitura do repo

function lerRepo(dir) {
  // Não basta existir `.git/`: uma pasta `.git/` VAZIA passa no existsSync e
  // faz todo comando git falhar. Pergunte ao git, não ao disco.
  const raiz = git(dir, ['rev-parse', '--git-dir'])
  if (!raiz.ok) return { erro: raiz.erro || 'git indisponível' }

  const ls = git(dir, ['ls-files'])
  if (!ls.ok) return { erro: ls.erro }
  const arquivos = ls.saida ? ls.saida.split('\n').filter(Boolean) : []

  const pkg = lerJson(dir, 'package.json')
  const fs_ = fontes(dir, arquivos)

  const varsEnv = new Set()
  for (const [, t] of fs_) {
    for (const m of t.matchAll(/(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g)) varsEnv.add(m[1])
  }

  // \x00 separa commits: mensagem de commit contém \n à vontade.
  // Repositório sem nenhum commit faz `git log` sair 128 — é estado válido,
  // e vira lista vazia, que as regras tratam como N/A.
  const logBruto = git(dir, ['log', '--format=%B%x00'])
  const commits = logBruto.ok && logBruto.saida
    ? logBruto.saida.split('\x00').map((s) => s.trim()).filter(Boolean) : []
  const logAutores = git(dir, ['log', '--format=%an <%ae>'])
  const autores = logAutores.ok && logAutores.saida ? logAutores.saida.split('\n').filter(Boolean) : []

  return {
    dir, nome: basename(dir) || dir, arquivos, pkg, fontes: fs_, varsEnv, commits, autores,
    envExample: ler(dir, '.env.example'),
    workflows: arquivos.filter((a) => /^\.github\/workflows\/.+\.ya?ml$/.test(a)),
  }
}

function avaliar(dir, filtro) {
  if (!existsSync(dir)) return { dir, nome: basename(dir) || dir, erro: 'caminho não existe' }
  const r = lerRepo(dir)
  if (r.erro) return { dir, nome: basename(dir) || dir, erro: r.erro }

  const aRodar = filtro ? REGRAS.filter((x) => x.id === filtro) : REGRAS
  const resultados = aRodar.map((regra) => {
    const base = { id: regra.id, titulo: regra.titulo, classe: regra.classe, nivel: regra.nivel }
    let saida
    try {
      saida = regra.checar(r)
    } catch (e) {
      // QUEBROU é defeito do rebar-check. Nunca entra na nota do alvo.
      return { ...base, estado: 'quebrou', motivo: `${e.message}` }
    }
    if (saida === null || saida === undefined) return { ...base, estado: 'passou' }
    if (typeof saida === 'object' && saida.na) return { ...base, estado: 'na', motivo: saida.na }
    return { ...base, estado: 'reprovou', motivo: String(saida) }
  })
  return { dir, nome: r.nome, resultados }
}

// ────────────────────────────────────────────────────────────────── saída

const MARCA = {
  passou: () => c.verde('✓'),
  reprovou: () => c.vermelho('✗'),
  na: () => c.fraco('–'),
  quebrou: () => c.amarelo('⚠'),
}

function nota(resultados) {
  const det = resultados.filter((x) => x.classe === 'determinística')
  const aplicaveis = det.filter((x) => x.estado === 'passou' || x.estado === 'reprovou')
  return {
    ok: aplicaveis.filter((x) => x.estado === 'passou').length,
    total: aplicaveis.length,
    na: det.filter((x) => x.estado === 'na').length,
    quebrou: resultados.filter((x) => x.estado === 'quebrou').length,
  }
}

function imprimir(a) {
  if (a.erro) { console.log(`\n${c.forte(a.nome)}\n  ${c.vermelho('✗')} ${a.erro}`); return }

  const det = a.resultados.filter((x) => x.classe === 'determinística')
  const heu = a.resultados.filter((x) => x.classe === 'heurística')

  console.log(`\n${c.forte('rebar-check')} · ${c.forte(a.nome)}`)
  for (const x of det) {
    const detalhe = x.motivo ? c.fraco(`  ${x.motivo}`) : ''
    const titulo = x.estado === 'na' ? c.fraco(x.titulo) : x.titulo
    console.log(`  ${MARCA[x.estado]()} ${x.id.padEnd(18)} ${titulo}${detalhe}`)
  }
  const heuVisiveis = heu.filter((x) => x.estado === 'reprovou' || x.estado === 'quebrou')
  if (heuVisiveis.length) {
    console.log(c.fraco('  ── heurísticas (não entram na nota, não derrubam o CI)'))
    for (const x of heuVisiveis) {
      console.log(`  ${MARCA[x.estado]()} ${x.id.padEnd(18)} ${c.fraco(x.motivo)}`)
    }
  }

  const n = nota(a.resultados)
  if (n.total === 0) {
    console.log(`  ${c.fraco('nada avaliável neste repositório')}`)
  } else {
    const txt = `${n.ok} de ${n.total}`
    console.log(`  ${n.ok === n.total ? c.verde(txt) : c.vermelho(txt)}` +
      (n.na ? c.fraco(`  ·  ${n.na} não se aplica`) : '') +
      (heuVisiveis.length ? c.fraco(`  ·  ${heuVisiveis.length} aviso(s)`) : ''))
  }
  if (n.quebrou) {
    console.log(`  ${c.amarelo(`⚠ ${n.quebrou} regra(s) QUEBRARAM — defeito do rebar-check, fora da nota`)}`)
  }
}

// ─────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
const json = args.includes('--json')
const heuristicasBarram = args.includes('--heuristicas')
const regraArg = args.find((a) => a.startsWith('--regra='))
const filtro = regraArg ? regraArg.slice('--regra='.length) : null

const desconhecidas = args.filter((a) => a.startsWith('--') && !/^--(json|heuristicas|regra=)/.test(a))
if (desconhecidas.length) {
  console.error(`rebar-check: opção desconhecida: ${desconhecidas.join(', ')}`)
  process.exit(2)
}

if (filtro && !REGRAS.some((x) => x.id === filtro)) {
  console.error(`rebar-check: regra desconhecida: ${filtro}`)
  console.error(`disponíveis: ${REGRAS.map((x) => x.id).join(', ')}`)
  process.exit(2)
}

const alvos = args.filter((a) => !a.startsWith('--'))
if (!alvos.length) alvos.push(process.cwd())

const avaliacoes = alvos.map((d) => avaliar(d, filtro))

if (json) {
  console.log(JSON.stringify(
    avaliacoes.map((a) => (a.erro ? a : { ...a, nota: nota(a.resultados) })), null, 2))
} else {
  for (const a of avaliacoes) imprimir(a)
  if (avaliacoes.length > 1) {
    console.log(`\n${c.forte('resumo')}`)
    for (const a of avaliacoes) {
      if (a.erro) { console.log(`  ${a.nome.padEnd(24)} ${c.vermelho(a.erro)}`); continue }
      const n = nota(a.resultados)
      if (!n.total) { console.log(`  ${a.nome.padEnd(24)} ${c.fraco('nada avaliável')}`); continue }
      // Barra de LARGURA FIXA. Com o N/A saindo do denominador cada repositório
      // tem um total diferente, e uma barra de comprimento variável faria 2/6
      // parecer pior que 3/11 — comparação que a régua não sustenta.
      const pct = n.ok / n.total
      const cheio = Math.round(pct * 10)
      const barra = '█'.repeat(cheio) + '·'.repeat(10 - cheio)
      console.log(`  ${a.nome.padEnd(24)} ${pct === 1 ? c.verde(barra) : c.vermelho(barra)}` +
        ` ${String(Math.round(pct * 100)).padStart(3)}%` +
        c.fraco(` ${n.ok}/${n.total}`) +
        (n.na ? c.fraco(` · ${n.na} n/a`) : ''))
    }
  }
}

// Ordem dos códigos: QUEBROU domina REPROVOU. Um defeito no verificador
// invalida o veredito — não se acusa um repositório com uma régua que quebrou.
const quebrou = avaliacoes.some((a) => a.resultados?.some((x) => x.estado === 'quebrou'))
const alvoInvalido = avaliacoes.some((a) => a.erro)
const reprovou = avaliacoes.some((a) => a.resultados?.some((x) =>
  x.estado === 'reprovou' && (x.classe === 'determinística' || heuristicasBarram)))

if (quebrou) process.exit(127)
if (alvoInvalido) process.exit(2)
process.exit(reprovou ? 1 : 0)
