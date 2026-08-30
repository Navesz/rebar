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
//   node index.mjs --heuristicas       heurísticas também derrubam o exit code

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

/** Roda git no repositório. Devolve '' em vez de lançar: repo sem commit é caso válido. */
function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch { return '' }
}

/** Só o que o Git rastreia. Arquivo ignorado não faz parte do produto. */
function rastreados(dir) {
  const saida = git(dir, ['ls-files'])
  return saida ? saida.split('\n').filter(Boolean) : []
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
const TESTE = /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//i
const IGNORAR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|vendor)\//

/** Conteúdo dos arquivos de código rastreados, com teto de tamanho. */
function fontes(dir, arquivos) {
  const out = []
  for (const a of arquivos) {
    if (!CODIGO.test(a) || IGNORAR.test(a) || TESTE.test(a)) continue
    try {
      if (statSync(join(dir, a)).size > 512 * 1024) continue
      out.push([a, readFileSync(join(dir, a), 'utf8')])
    } catch { /* arquivo sumiu entre o ls-files e a leitura */ }
  }
  return out
}

// ──────────────────────────────────────────────────────────────── as regras
//
// classe: 'determinística' derruba o exit code · 'heurística' só informa.
// A distinção não é estética: a regra de cor literal, quando medida no herz,
// deu SETE ocorrências e ZERO verdadeiros positivos — cinco eram comentários
// documentando a própria regra. Regra automática errada custa mais que regra
// ausente, e heurística que barra ensina a desligar a saída inteira.

const REGRAS = [

  // ── determinísticas ─────────────────────────────────────────────────────

  { id: 'editorconfig', classe: 'determinística', nivel: 'N1',
    titulo: 'tem .editorconfig',
    checar: (r) => existe(r.dir, '.editorconfig') ? null : 'ausente' },

  { id: 'dependabot', classe: 'determinística', nivel: 'N4',
    titulo: 'atualização de dependência automatizada',
    checar: (r) => (existe(r.dir, '.github/dependabot.yml') || existe(r.dir, '.github/dependabot.yaml') ||
                    existe(r.dir, 'renovate.json') || existe(r.dir, '.github/renovate.json'))
      ? null : 'sem dependabot nem renovate' },

  { id: 'ci', classe: 'determinística', nivel: 'N4',
    titulo: 'tem CI',
    checar: (r) => r.workflows.length ? null : 'nenhum workflow em .github/workflows/' },

  { id: 'ci-gateia', classe: 'determinística', nivel: 'N4',
    titulo: 'o CI roda lint, tipos e teste',
    checar: (r) => {
      if (!r.workflows.length) return 'sem CI'
      const yml = r.workflows.map((w) => ler(r.dir, w) || '').join('\n')
      const faltam = ['lint', 'typecheck', 'test'].filter((g) => !new RegExp(`\\b${g}\\b`).test(yml))
      return faltam.length ? `CI não roda: ${faltam.join(', ')}` : null
    } },

  { id: 'testes', classe: 'determinística', nivel: 'N3',
    titulo: 'tem teste',
    checar: (r) => r.arquivos.some((a) => TESTE.test(a)) ? null : 'zero arquivo de teste' },

  { id: 'typecheck', classe: 'determinística', nivel: 'N0',
    titulo: 'tem script de typecheck',
    checar: (r) => {
      if (!r.pkg) return null                       // não é projeto npm
      return r.pkg.scripts?.typecheck ? null : 'package.json sem script "typecheck"'
    } },

  { id: 'formatter', classe: 'determinística', nivel: 'N1',
    titulo: 'tem formatador',
    checar: (r) => {
      if (!r.pkg) return null
      const d = { ...r.pkg.dependencies, ...r.pkg.devDependencies }
      return (d.prettier || d['@biomejs/biome'] || d.dprint) ? null : 'sem prettier, biome ou dprint'
    } },

  { id: 'env-example', classe: 'determinística', nivel: 'N2',
    titulo: 'lê env e documenta em .env.example',
    checar: (r) => {
      if (!r.varsEnv.size) return null              // não lê env: nada a documentar
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
      if (!lic || !/Apache License/i.test(ler(r.dir, lic) || '')) return null
      return r.arquivos.some((a) => /^NOTICE/i.test(a)) ? null : 'licença Apache sem NOTICE'
    } },

  { id: 'coautoria-ia', classe: 'determinística', nivel: 'N5',
    titulo: 'nenhum commit com coautoria de IA',
    checar: (r) => {
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
      if (!temUi) return null
      return existe(r.dir, 'components.json') ? null
        : 'pasta components/ui/ imitando a convenção, sem components.json'
    } },

  { id: 'schema-orfao', classe: 'determinística', nivel: 'N1',
    titulo: 'nenhum JSON Schema órfão',
    checar: (r) => {
      const schemas = r.arquivos.filter((a) => /\.schema\.json$/.test(a))
      if (!schemas.length) return null
      const todo = r.fontes.map(([, t]) => t).join('\n')
      const orfaos = schemas.filter((s) => !todo.includes(basename(s)))
      return orfaos.length ? `definido e nunca lido: ${orfaos.slice(0, 3).join(', ')}` : null
    } },

  // ── heurísticas ─────────────────────────────────────────────────────────

  { id: 'shadcn-completo', classe: 'heurística', nivel: 'N1',
    titulo: 'shadcn com o aparato, não só a pasta',
    checar: (r) => {
      if (!existe(r.dir, 'components.json')) return null
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
      if (!css.length) return null
      const noCss = new Set()
      for (const a of css) for (const m of (ler(r.dir, a) || '').matchAll(/#[0-9a-f]{6}/gi)) noCss.add(m[0].toLowerCase())
      if (!noCss.size) return null
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
  const arquivos = rastreados(dir)
  const pkg = lerJson(dir, 'package.json')
  const fs_ = fontes(dir, arquivos)

  const varsEnv = new Set()
  for (const [, t] of fs_) {
    for (const m of t.matchAll(/(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g)) varsEnv.add(m[1])
  }

  // \x00 separa commits: mensagem de commit contém \n à vontade.
  const bruto = git(dir, ['log', '--format=%B%x00'])
  const commits = bruto ? bruto.split('\x00').map((s) => s.trim()).filter(Boolean) : []
  const autores = (git(dir, ['log', '--format=%an <%ae>']) || '').split('\n').filter(Boolean)

  return {
    dir, nome: basename(dir), arquivos, pkg, fontes: fs_, varsEnv, commits, autores,
    envExample: ler(dir, '.env.example'),
    workflows: arquivos.filter((a) => /^\.github\/workflows\/.+\.ya?ml$/.test(a)),
  }
}

function avaliar(dir) {
  if (!existsSync(join(dir, '.git'))) return { dir, erro: 'não é repositório git' }
  const r = lerRepo(dir)
  const resultados = REGRAS.map((regra) => {
    let falha
    try { falha = regra.checar(r) } catch (e) { falha = `a checagem quebrou: ${e.message}` }
    return { id: regra.id, titulo: regra.titulo, classe: regra.classe, nivel: regra.nivel, falha }
  })
  return { dir, nome: r.nome, resultados }
}

// ────────────────────────────────────────────────────────────────── saída

function imprimir(a) {
  if (a.erro) { console.log(`\n${c.forte(a.dir)}\n  ${c.vermelho('✗')} ${a.erro}`); return }

  const det = a.resultados.filter((x) => x.classe === 'determinística')
  const heu = a.resultados.filter((x) => x.classe === 'heurística')
  const okDet = det.filter((x) => !x.falha).length

  console.log(`\n${c.forte('rebar-check')} · ${c.forte(a.nome)}`)
  for (const x of det) {
    const marca = x.falha ? c.vermelho('✗') : c.verde('✓')
    const detalhe = x.falha ? c.fraco(`  ${x.falha}`) : ''
    console.log(`  ${marca} ${x.id.padEnd(18)} ${x.titulo}${detalhe}`)
  }
  const heuFalhas = heu.filter((x) => x.falha)
  if (heuFalhas.length) {
    console.log(c.fraco('  ── heurísticas (não entram na nota, não derrubam o CI)'))
    for (const x of heuFalhas) {
      console.log(`  ${c.amarelo('!')} ${x.id.padEnd(18)} ${c.fraco(x.falha)}`)
    }
  }
  const nota = `${okDet} de ${det.length}`
  console.log(`  ${okDet === det.length ? c.verde(nota) : c.vermelho(nota)}` +
    (heuFalhas.length ? c.fraco(`  ·  ${heuFalhas.length} aviso(s)`) : ''))
}

// ─────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
const json = args.includes('--json')
const heuristicasBarram = args.includes('--heuristicas')
const alvos = args.filter((a) => !a.startsWith('--'))
if (!alvos.length) alvos.push(process.cwd())

const avaliacoes = alvos.map(avaliar)

if (json) {
  console.log(JSON.stringify(avaliacoes, null, 2))
} else {
  for (const a of avaliacoes) imprimir(a)
  if (avaliacoes.length > 1) {
    console.log(`\n${c.forte('resumo')}`)
    for (const a of avaliacoes) {
      if (a.erro) { console.log(`  ${a.dir.padEnd(24)} ${c.vermelho(a.erro)}`); continue }
      const det = a.resultados.filter((x) => x.classe === 'determinística')
      const ok = det.filter((x) => !x.falha).length
      const barra = '█'.repeat(ok) + '·'.repeat(det.length - ok)
      const t = `${ok}/${det.length}`
      console.log(`  ${a.nome.padEnd(24)} ${ok === det.length ? c.verde(barra) : c.vermelho(barra)} ${t}`)
    }
  }
}

const reprovou = avaliacoes.some((a) => a.erro ||
  a.resultados.some((x) => x.falha && (x.classe === 'determinística' || heuristicasBarram)))
process.exit(reprovou ? 1 : 0)
