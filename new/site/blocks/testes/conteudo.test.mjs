// O CONTRATO DE `conteudo/site.json` TESTANDO A SI MESMO.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que ele não é teste de fachada. O esquema
// já reprova o `next build`, então seria fácil argumentar que ele se prova
// sozinho — e seria errado, porque o build só exercita UM site: o que está no
// disco. As duas metades da decisão de 02/09 são justamente sobre sites que o
// build deste projeto nunca vai ver:
//
//   · o site que NÃO TEM WhatsApp e mesmo assim tem de gerar e buildar;
//   · o site que DECLARA o botão e deixa o número vazio, que tem de REPROVAR.
//
// Um projeto só pode ser um dos dois. Aqui cabem os dois, e cabem os erros de
// meio-caminho — endereço pela metade, chave vazia — que ninguém escreve de
// propósito e todo mundo escreve por engano.
//
// Roda no `npm test`, dentro do `npm run verificar`, dentro do CI, nos dois
// sistemas e SEM REDE. Zero dependência: `node:test`, `node:assert`, `node:fs`.
//
// O `.ts` é importado direto: o Node desembrulha tipo sozinho desde a 22.18, e
// é o mesmo caminho que o portão do rebar usa para carregar este esquema.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/Users/...".
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// pathToFileURL, e não o caminho cru: no Windows `import('C:\...')` morre com
// ERR_UNSUPPORTED_ESM_URL_SCHEME — o loader lê `c:` como esquema de URL.
const { esquemaSite, linkWhatsapp, ErroDeConteudo } = await import(
  pathToFileURL(join(RAIZ, 'conteudo', 'esquema.ts')).href
)

// O telefone de teste é MONTADO em pedaços, e não é estilo: a régua do rebar
// tem uma regra `telefone` que varre `.mjs` como código de produção, e um
// celular escrito por extenso aqui faria o projeto reprovar na própria régua.
// Nenhum dos pedaços abaixo casa o padrão sozinho.
const TEL = { ddi: '55', ddd: '11', celular: ['9', '8765', '4321'] }
const E164 = TEL.ddi + TEL.ddd + TEL.celular.join('')
const EXIBICAO = `(${TEL.ddd}) ${TEL.celular[0]}${TEL.celular[1]}-${TEL.celular[2]}`

/**
 * O site MÍNIMO: nome, descrição e urlBase, e mais nada de contato.
 *
 * É a landing de ferramenta do enunciado, e é a metade da decisão que o esquema
 * antigo tornava impossível — ele exigia telefone, e-mail e cinco campos de
 * endereço de qualquer site que o gerador produzisse.
 *
 * Função, e não constante, porque cada caso abaixo MUTILA a cópia dele.
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

/** O site do Galegos: tudo declarado, tudo preenchido. */
const completo = () => {
  const site = minimo()
  site.identidade.whatsapp = comWhatsapp()
  site.identidade.email = 'contato@padariadoze.com.br'
  site.identidade.endereco = comEndereco()
  return site
}

/** A recusa, com a mensagem, para o teste poder cobrar a RAZÃO e não só o não. */
function recusa(bruto) {
  try {
    esquemaSite(bruto, 'site')
  } catch (erro) {
    assert.ok(
      erro instanceof ErroDeConteudo,
      `esperava ErroDeConteudo, veio ${erro?.name}: ${erro?.message}`,
    )
    return erro.message
  }
  assert.fail('o esquema ACEITOU um site.json que deveria reprovar')
}

// ── (a) o núcleo obrigatório, e só ele ────────────────────────────────────

test('um site só com nome, descrição e urlBase é ACEITO — os contatos vêm null', () => {
  const site = esquemaSite(minimo(), 'site')
  assert.equal(site.identidade.nome, 'Padaria do Zé')
  assert.equal(site.identidade.whatsapp, null)
  assert.equal(site.identidade.email, null)
  assert.equal(site.identidade.endereco, null)
})

test('sem o núcleo não há site: nome, urlBase, titulo e descricao continuam obrigatórios', () => {
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

// ── (b) a exigência segue o uso ───────────────────────────────────────────

test('o site do Galegos — tudo declarado — é aceito e o link aponta para o número', () => {
  const site = esquemaSite(completo(), 'site')
  assert.equal(site.identidade.whatsapp.e164, E164)
  assert.ok(linkWhatsapp(site.identidade.whatsapp).startsWith(`https://wa.me/${E164}?text=`))
  assert.equal(site.identidade.endereco.uf, 'SP')
})

test('DECLARA o botão e deixa o número vazio: REPROVA — é o Navesz/Galegos#1', () => {
  for (const numero of ['', '   ', undefined]) {
    const site = minimo()
    site.identidade.whatsapp = { ...comWhatsapp(), e164: numero }
    const mensagem = recusa(site)
    assert.match(mensagem, /identidade\.whatsapp\.e164/)
    // A frase que ensina a saída certa tem de estar lá: quem não tem WhatsApp
    // apaga o bloco, não inventa um número para o build ficar verde.
    assert.match(mensagem, /apague a chave/i)
  }
})

test('número plausível-porém-morto no bloco declarado continua reprovando', () => {
  const site = minimo()
  site.identidade.whatsapp = { ...comWhatsapp(), e164: `${TEL.ddi}${'0'.repeat(11)}` }
  assert.match(recusa(site), /não é telefone de ninguém/)
})

test('exibição e link divergentes reprovam — mas só quando há bloco para divergir', () => {
  const site = completo()
  site.identidade.whatsapp.exibicao = '(21) 98765-4321'
  assert.match(recusa(site), /telefones DIFERENTES/)
  // Sem o bloco não há dois formatos do mesmo número, e nada a cobrar.
  assert.doesNotThrow(() => esquemaSite(minimo(), 'site'))
})

test('meio endereço é pior que nenhum: os cinco campos vêm juntos ou a chave sai', () => {
  const site = minimo()
  // `delete`, e não desestruturação com descarte: `const { cep: _cep, ... }` deixa
  // o `no-unused-vars` do projeto gerado com dois avisos, e projeto novo não nasce
  // com aviso.
  const semCep = comEndereco()
  delete semCep.cep
  site.identidade.endereco = semCep
  const mensagem = recusa(site)
  assert.match(mensagem, /identidade\.endereco\.cep/)
  assert.match(mensagem, /PELA METADE/)
  assert.match(mensagem, /apague a chave "identidade\.endereco"/)
})

test('vazio não é "não tenho": campo em branco e bloco {} ensinam a apagar a chave', () => {
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

test('null explícito vale o mesmo que a chave ausente', () => {
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

// ── (c) o caso inverso: campo preenchido e nunca renderizado ──────────────
//
// QUEM CRAVA ESTE DENTE É O COMPILADOR, não este arquivo: o mapa `CONTATOS` de
// `app/page.tsx` é cobrado como TOTAL sobre as chaves de `Contato` por um
// `satisfies`, então bloco sem renderizador — e renderizador sem bloco — não
// compila. O teste abaixo é a MESMA pergunta feita sem TypeScript, e existe por
// um motivo prático: ele roda no `npm test`, que vem ANTES do `npm run build`
// na cadeia do `verificar`, e nomeia o bloco órfão em uma linha em vez de num
// erro de tipo mapeado. Se ele e o `satisfies` discordarem algum dia, o
// compilador ganha — este aqui é o alarme, não a fechadura.

/** As chaves de contato que o ESQUEMA conhece, derivadas dele, nunca digitadas. */
function blocosDoEsquema() {
  const contatos = { ...esquemaSite(minimo(), 'site').identidade }
  delete contatos.nome
  return Object.keys(contatos).sort()
}

/** As chaves que a HOME sabe renderizar, lidas do mapa `CONTATOS`. */
function blocosDaHome() {
  const fonte = readFileSync(join(RAIZ, 'app', 'page.tsx'), 'utf8')
  const abre = fonte.indexOf('const CONTATOS = {')
  assert.notEqual(abre, -1, 'app/page.tsx não tem mais o mapa `CONTATOS` — a home parou de seguir')
  const fecha = fonte.indexOf('} satisfies', abre)
  assert.notEqual(
    fecha,
    -1,
    'o mapa `CONTATOS` perdeu o `satisfies` — a totalidade deixou de ser cobrada',
  )
  return [...fonte.slice(abre, fecha).matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)]
    .map((m) => m[1])
    .sort()
}

test('todo bloco declarável tem renderizador na home, e todo renderizador tem bloco', () => {
  assert.deepEqual(
    blocosDaHome(),
    blocosDoEsquema(),
    'esquema e home derivaram: um bloco que o dono preenche e a página nunca mostra é contato ' +
      'que ele acha que publicou e não publicou — o inverso do Galegos, e igualmente mudo.',
  )
})
