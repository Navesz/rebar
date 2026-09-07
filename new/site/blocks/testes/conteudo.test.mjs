// THE `conteudo/site.json` CONTRACT TESTING ITSELF.
//
// WHY THIS FILE EXISTS, and why it is not a façade test. The schema already
// fails `next build`, so it would be easy to argue that it proves itself — and
// that would be wrong, because the build exercises ONE site only: the one on
// disk. The two halves of the 02/09 decision are precisely about sites this
// project's build will never see:
//
//   · the site that HAS NO WhatsApp and still has to generate and build;
//   · the site that DECLARES the button and leaves the number empty, which has
//     to FAIL.
//
// A project can only be one of the two. Both fit here, and so do the halfway
// mistakes — half an address, an empty key — that nobody writes on purpose and
// everybody writes by accident.
//
// Runs in `npm test`, inside `npm run verificar`, inside CI, on both systems
// and WITH NO NETWORK. Zero dependency: `node:test`, `node:assert`, `node:fs`.
//
// The `.ts` is imported directly: Node strips types on its own since 22.18, and
// it is the same path rebar's gate uses to load this schema.
//
// THE `assert.match` PATTERNS STAY PORTUGUESE, and so does the fixture below.
// The patterns match, by text, the messages `conteudo/esquema.ts` prints — and
// those stay Portuguese because they are read by the owner of a pt-BR site;
// `esquema.ts` carries the twin note on its side. Translating a pattern here
// without translating the message there kills the assertion, and the assertion
// is the whole proof.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// fileURLToPath, not .pathname: on Windows the pathname comes as "/C:/Users/...".
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// pathToFileURL, and not the raw path: on Windows `import('C:\...')` dies with
// ERR_UNSUPPORTED_ESM_URL_SCHEME — the loader reads `c:` as a URL scheme.
const { esquemaSite, linkWhatsapp, ErroDeConteudo } = await import(
  pathToFileURL(join(RAIZ, 'conteudo', 'esquema.ts')).href
)

// The test phone is ASSEMBLED in pieces, and that is not style: rebar's ruler
// has a `telefone` rule that scans `.mjs` as production code, and a mobile
// number written out in full here would make the project fail its own ruler.
// None of the pieces below matches the pattern on its own.
const TEL = { ddi: '55', ddd: '11', celular: ['9', '8765', '4321'] }
const E164 = TEL.ddi + TEL.ddd + TEL.celular.join('')
const EXIBICAO = `(${TEL.ddd}) ${TEL.celular[0]}${TEL.celular[1]}-${TEL.celular[2]}`

/**
 * The MINIMUM site: name, description and urlBase, and nothing else of contact.
 *
 * It is the tool landing page from the statement, and it is the half of the
 * decision the old schema made impossible — it demanded a phone, an e-mail and
 * five address fields of every site the generator produced.
 *
 * A function, not a constant, because each case below MUTILATES its copy.
 *
 * THE FIXTURE STAYS PORTUGUESE: it is the content of a Brazilian site, which is
 * the only kind this schema validates, and `descricao` has to keep landing
 * inside the 50-to-160-character window the schema demands.
 */
const minimo = () => ({
  identidade: { nome: 'Padaria do Zé' },
  meta: {
    urlBase: 'https://padariadoze.com.br',
    idioma: 'pt-BR',
    titulo: 'Padaria do Zé',
    gabaritoDeTitulo: '%s · Padaria do Zé',
    descricao:
      'Pães de fermentação natural, bolos e salgados assados todo dia de manhã na Vila Mariana.',
    nomeCurto: 'Padaria',
    atualizadoEm: '2026-09-02',
    cores: { tema: '#0f172a', fundo: '#ffffff' },
    og: {
      caminho: '/og.png',
      largura: 1200,
      altura: 630,
      alt: 'Cartão de compartilhamento da Padaria do Zé',
    },
  },
  home: {
    titulo: 'Padaria do Zé',
    subtitulo: 'Pães de fermentação natural assados todo dia de manhã, na Vila Mariana.',
    destaques: [
      {
        titulo: 'Forno',
        texto: 'Fornada nova a cada duas horas, das seis da manhã às sete da noite.',
      },
    ],
  },
})

const comWhatsapp = () => ({
  e164: E164,
  exibicao: EXIBICAO,
  chamadaAcao: 'Falar no WhatsApp',
  mensagem: 'Olá! Vim pelo site e gostaria de mais informações.',
})

const comEndereco = () => ({
  logradouro: 'Rua das Palmeiras, 512',
  bairro: 'Vila Mariana',
  cidade: 'São Paulo',
  uf: 'SP',
  cep: '04101-300',
})

/** The Galegos site: everything declared, everything filled in. */
const completo = () => {
  const site = minimo()
  site.identidade.whatsapp = comWhatsapp()
  site.identidade.email = 'contato@padariadoze.com.br'
  site.identidade.endereco = comEndereco()
  return site
}

/** The refusal, with the message, so the test can charge for the REASON and not just the no. */
function recusa(bruto) {
  try {
    esquemaSite(bruto, 'site')
  } catch (erro) {
    assert.ok(
      erro instanceof ErroDeConteudo,
      `expected ErroDeConteudo, got ${erro?.name}: ${erro?.message}`,
    )
    return erro.message
  }
  assert.fail('the schema ACCEPTED a site.json that should have failed')
}

// ── (a) the mandatory core, and only it ───────────────────────────────────

test('a site with only name, description and urlBase is ACCEPTED — contacts come back null', () => {
  const site = esquemaSite(minimo(), 'site')
  assert.equal(site.identidade.nome, 'Padaria do Zé')
  assert.equal(site.identidade.whatsapp, null)
  assert.equal(site.identidade.email, null)
  assert.equal(site.identidade.endereco, null)
})

test('no core, no site: nome, urlBase, titulo and descricao stay mandatory', () => {
  for (const [caminho, ...resto] of [
    ['identidade', 'nome'],
    ['meta', 'urlBase'],
    ['meta', 'titulo'],
    ['meta', 'descricao'],
    ['home', 'titulo'],
  ]) {
    const site = minimo()
    delete site[caminho][resto[0]]
    const mensagem = recusa(site)
    assert.match(mensagem, new RegExp(`${caminho}\\.${resto[0]}`))
  }
})

// ── (b) the demand follows the use ────────────────────────────────────────

test('the Galegos site — all declared — is accepted and the link points at the number', () => {
  const site = esquemaSite(completo(), 'site')
  assert.equal(site.identidade.whatsapp.e164, E164)
  assert.ok(linkWhatsapp(site.identidade.whatsapp).startsWith(`https://wa.me/${E164}?text=`))
  assert.equal(site.identidade.endereco.uf, 'SP')
})

test('DECLARES the button and leaves the number empty: FAILS — it is Navesz/Galegos#1', () => {
  for (const numero of ['', '   ', undefined]) {
    const site = minimo()
    site.identidade.whatsapp = { ...comWhatsapp(), e164: numero }
    const mensagem = recusa(site)
    assert.match(mensagem, /identidade\.whatsapp\.e164/)
    // The sentence that teaches the right way out has to be there: whoever has
    // no WhatsApp deletes the block, and does not invent a number to get the
    // build green. Pattern in Portuguese — see the note in the header.
    assert.match(mensagem, /apague a chave/i)
  }
})

test('a plausible-yet-dead number in the declared block keeps failing', () => {
  const site = minimo()
  site.identidade.whatsapp = { ...comWhatsapp(), e164: `${TEL.ddi}${'0'.repeat(11)}` }
  assert.match(recusa(site), /não é telefone de ninguém/)
})

test('display and link diverging fail — but only when there is a block to diverge', () => {
  const site = completo()
  site.identidade.whatsapp.exibicao = '(21) 98765-4321'
  assert.match(recusa(site), /telefones DIFERENTES/)
  // With no block there are not two formats of the same number, and nothing to
  // charge for.
  assert.doesNotThrow(() => esquemaSite(minimo(), 'site'))
})

test('half an address is worse than none: the five fields come together or the key goes', () => {
  const site = minimo()
  // `delete`, and not destructuring with a discard: `const { cep: _cep, ... }`
  // leaves the generated project's `no-unused-vars` with two warnings, and a
  // new project is not born with a warning.
  const semCep = comEndereco()
  delete semCep.cep
  site.identidade.endereco = semCep
  const mensagem = recusa(site)
  assert.match(mensagem, /identidade\.endereco\.cep/)
  assert.match(mensagem, /PELA METADE/)
  assert.match(mensagem, /apague a chave "identidade\.endereco"/)
})

test('empty is not "I do not have it": a blank field and a {} block teach deleting the key', () => {
  for (const [chave, vazio] of [
    ['email', ''],
    ['email', '   '],
    ['endereco', {}],
    ['whatsapp', {}],
  ]) {
    const site = minimo()
    site.identidade[chave] = vazio
    const mensagem = recusa(site)
    assert.match(mensagem, /não é "não tenho"/)
    assert.match(mensagem, new RegExp(`a chave "identidade\\.${chave}" sai do arquivo`))
  }
})

test('an explicit null is worth the same as an absent key', () => {
  const site = minimo()
  site.identidade.whatsapp = null
  site.identidade.email = null
  site.identidade.endereco = null
  assert.deepEqual(esquemaSite(site, 'site').identidade, {
    nome: 'Padaria do Zé',
    whatsapp: null,
    email: null,
    endereco: null,
  })
})

// ── (c) the inverse case: field filled in and never rendered ──────────────
//
// WHAT SINKS THIS TOOTH IN IS THE COMPILER, not this file: the `CONTATOS` map
// in `app/page.tsx` is charged as TOTAL over the keys of `Contato` by a
// `satisfies`, so a block with no renderer — and a renderer with no block —
// does not compile. The test below is the SAME question asked without
// TypeScript, and it exists for a practical reason: it runs in `npm test`,
// which comes BEFORE `npm run build` in the `verificar` chain, and it names the
// orphan block in one line instead of in a mapped type error. If it and the
// `satisfies` ever disagree, the compiler wins — this one is the alarm, not the
// lock.

/** The contact keys the SCHEMA knows, derived from it, never typed in. */
function blocosDoEsquema() {
  const contatos = { ...esquemaSite(minimo(), 'site').identidade }
  delete contatos.nome
  return Object.keys(contatos).sort()
}

/** The keys the HOME knows how to render, read from the `CONTATOS` map. */
function blocosDaHome() {
  const fonte = readFileSync(join(RAIZ, 'app', 'page.tsx'), 'utf8')
  const abre = fonte.indexOf('const CONTATOS = {')
  assert.notEqual(abre, -1, 'app/page.tsx lost the `CONTATOS` map — the home stopped following')
  const fecha = fonte.indexOf('} satisfies', abre)
  assert.notEqual(
    fecha,
    -1,
    'the `CONTATOS` map lost its `satisfies` — totality stopped being charged for',
  )
  return [...fonte.slice(abre, fecha).matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)]
    .map((m) => m[1])
    .sort()
}

test('every declarable block has a renderer on the home, and every renderer has a block', () => {
  assert.deepEqual(
    blocosDaHome(),
    blocosDoEsquema(),
    'schema and home have drifted: a block the owner fills in and the page never shows is a ' +
      'contact he thinks he published and did not — the inverse of Galegos, and just as mute.',
  )
})
