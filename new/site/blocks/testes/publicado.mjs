/**
 * THE GATE THAT LOOKS AT WHAT WAS PUBLISHED, not at what was written.
 *
 * A GitHub Pages project site lives in a FOLDER — `user.github.io/repo` — and
 * an absolute path without that folder in front of it points OUTSIDE the site.
 * What reading a built `out/` showed, with all four `verificar` steps green:
 *
 *   · `next/image` with `images.unoptimized` writes the `src` RAW. The header's
 *     logo came out at `/marca.svg`.
 *   · `app/manifest.ts` emitted `"start_url": "/"` and icons at
 *     `/icone-192.png`.
 *
 * Neither is a compile, type or lint error: they are 404s on the published
 * site, and only whoever OPENS THE PAGE sees them. So the rule of this file,
 * which runs AFTER `next build`:
 *
 *   every absolute path emitted into `out/` starts with the site's folder.
 *
 * Two cases, like every rule in this house: `--provar` plants a document with
 * the defect and demands failure, and plants the right document and demands a
 * pass. Without the case that passes, a rule that failed everything would look
 * correct.
 *
 * For a site at the ROOT of a domain there is no folder, and the rule does not
 * apply — it reports `n/a` instead of handing out a free green.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const SAIDA = join(RAIZ, 'out')

/** The folder comes from the SAME `urlBase` `next.config.ts` derives `basePath` from. */
export function pastaDoSite(urlBase) {
  return new URL(urlBase).pathname.replace(/\/$/, '')
}

const ABSOLUTO = (valor) => valor.startsWith('/') && !valor.startsWith('//')

/**
 * The absolute paths in a document that do NOT start with the folder.
 *
 * Works for HTML — the `src`, `href` and `srcset` attributes — and for JSON,
 * where any string that looks like a path counts: that is how the manifest's
 * `start_url` and icons get in.
 */
export function caminhosForaDaPasta(texto, pasta, tipo) {
  const dentro = (v) => v === pasta || v.startsWith(`${pasta}/`)
  const candidatos = []

  if (tipo === 'json') {
    const recolher = (v) => {
      if (typeof v === 'string') candidatos.push(v)
      else if (Array.isArray(v)) v.forEach(recolher)
      else if (v && typeof v === 'object') Object.values(v).forEach(recolher)
    }
    recolher(JSON.parse(texto))
  } else {
    for (const [, valor] of texto.matchAll(/\b(?:src|href)="([^"]*)"/g)) candidatos.push(valor)
    // `srcset` is a comma-separated list of "path descriptor".
    for (const [, lista] of texto.matchAll(/\bsrcset="([^"]*)"/g))
      for (const item of lista.split(',')) candidatos.push(item.trim().split(/\s+/)[0] ?? '')
  }

  return [...new Set(candidatos.filter((v) => ABSOLUTO(v) && !dentro(v)))]
}

function documentos(pasta) {
  const achados = []
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) achados.push(...documentos(caminho))
    else if (/\.html$/.test(nome)) achados.push([caminho, 'html'])
    else if (/\.webmanifest$/.test(nome)) achados.push([caminho, 'json'])
  }
  return achados
}

// ── the two cases ─────────────────────────────────────────────────────────

const HTML_ERRADO = '<img src="/marca.svg"/><link rel="icon" href="/sitio/marca.svg"/>'
const HTML_CERTO = '<img src="/sitio/marca.svg"/><a href="https://exemplo.com.br">fonte</a>'
const JSON_ERRADO = '{"start_url":"/","icons":[{"src":"/icone-192.png"}]}'
const JSON_CERTO = '{"start_url":"/sitio/","icons":[{"src":"/sitio/icone-192.png"}]}'

function provar() {
  const casos = [
    ['html que reprova', HTML_ERRADO, 'html', ['/marca.svg']],
    ['html que aprova', HTML_CERTO, 'html', []],
    ['json que reprova', JSON_ERRADO, 'json', ['/', '/icone-192.png']],
    ['json que aprova', JSON_CERTO, 'json', []],
  ]
  let quebrou = false
  for (const [nome, texto, tipo, esperado] of casos) {
    const obtido = caminhosForaDaPasta(texto, '/sitio', tipo)
    const bate = JSON.stringify(obtido) === JSON.stringify(esperado)
    console.log(
      `  ${bate ? '✓' : '✗'} ${nome}${bate ? '' : ` — esperava ${esperado}, veio ${obtido}`}`,
    )
    if (!bate) quebrou = true
  }
  return quebrou ? 1 : 0
}

// ── the gate ──────────────────────────────────────────────────────────────

function verificar() {
  const { meta } = JSON.parse(readFileSync(join(RAIZ, 'conteudo', 'site.json'), 'utf8'))
  const pasta = pastaDoSite(meta.urlBase)

  if (!pasta) {
    console.log('publicado · n/a — o site mora na raiz do domínio')
    return 0
  }

  const achados = []
  for (const [caminho, tipo] of documentos(SAIDA)) {
    const fora = caminhosForaDaPasta(readFileSync(caminho, 'utf8'), pasta, tipo)
    if (fora.length) achados.push([relative(RAIZ, caminho), fora])
  }

  if (achados.length) {
    console.error(`publicado · ✗ caminho absoluto fora de ${pasta}:`)
    for (const [arquivo, fora] of achados) console.error(`  ${arquivo}: ${fora.join(', ')}`)
    console.error(
      '\nO build passa e a página publicada dá 404. Passe o caminho por `naPasta`\n' +
        'em `conteudo/carregar.ts`.',
    )
    return 1
  }

  console.log(`publicado · ✓ todo caminho absoluto começa em ${pasta}`)
  return 0
}

process.exit(process.argv.includes('--provar') ? provar() : verificar())
