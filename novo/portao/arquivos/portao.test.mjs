// O portão testando a si mesmo.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que ele não é teste de fachada. A régua do
// rebar tem uma regra `testes` que só pergunta se existe arquivo de teste, e
// seria trivial satisfazê-la com um `assert.ok(true)`. Isso é exatamente a
// fraude que a regra `ui-falso` existe para pegar em outra forma: o aparato sem
// a coisa.
//
// O que ele afere é o único invariante que este repositório não pode perder sem
// avisar: as peças do portão continuam no lugar. Apagar o .gitattributes,
// remover o hook, tirar o script `verificar` do package.json — cada uma dessas
// coisas passa despercebida num diff grande e só aparece meses depois, como
// ruído de CRLF ou como segredo commitado. Aqui elas viram vermelho na hora.
//
// Roda com built-in do Node, sem uma dependência: node --test testes/

import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/Users/...".
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8')
const tem = (rel) => existsSync(join(RAIZ, rel))

test('os arquivos do portão estão no lugar', () => {
  for (const arquivo of [
    '.editorconfig',
    '.gitattributes',
    '.rebar-coautores',
    '.github/workflows/verificar.yml',
    '.github/dependabot.yml',
    '.githooks/pre-commit',
    '.githooks/commit-msg',
    '.githooks/instalar.mjs',
    'LICENSE',
    'NOTICE',
    'README.md',
    'AGENTS.md',
  ]) {
    assert.ok(tem(arquivo), `faltando: ${arquivo}`)
  }
})

test('o AGENTS.md fala deste projeto, e não só do framework', () => {
  // POR QUE ESTE TESTE. O `shadcn create` entrega um AGENTS.md de 5 linhas em
  // inglês, que só avisa sobre breaking change do Next. Ele atravessa as 22
  // regras do rebar-check sem encostar em nenhuma — a `idioma-unico` só lê
  // comentário de CÓDIGO, e a `readme` só olha o README. A forense original
  // catalogou "AGENTS.md ausente ou só boilerplate" com frequência 5 em 6.
  // Sem este teste, desfazer a decisão do portão não acende nada.
  const agents = ler('AGENTS.md')
  assert.match(agents, /<!-- rebar:agentes -->/, 'AGENTS.md não passou pelo portão')
  // As duas âncoras que a decisão prometeu: para onde o agente é mandado ler, e
  // onde está a allowlist que diz que ele não assina o commit.
  assert.match(agents, /README\.md/, 'AGENTS.md não aponta para o README')
  assert.match(agents, /\.rebar-coautores/, 'AGENTS.md não aponta para a allowlist de coautores')
  assert.match(agents, /português do Brasil/i, 'AGENTS.md não declara o idioma do projeto')
})

test('o bloco do shadcn no AGENTS.md fica intacto, se ele veio', () => {
  // Informação de terceiro sobre a versão do Next instalada AQUI. Ela envelhece
  // com o Next e não é nossa para reescrever; o portão a extrai pelos
  // marcadores e a recoloca. Se o bloco existe, tem de estar fechado — meio
  // bloco é bloco truncado pela reescrita, e é o defeito que este teste caça.
  const agents = ler('AGENTS.md')
  const abre = agents.includes('BEGIN:nextjs-agent-rules')
  const fecha = agents.includes('END:nextjs-agent-rules')
  assert.equal(abre, fecha, 'o bloco `nextjs-agent-rules` ficou pela metade no AGENTS.md')
  if (abre) {
    assert.match(
      agents,
      /node_modules\/next\/dist\/docs/,
      'o bloco do shadcn perdeu o conteúdo dele na reescrita',
    )
  }
})

test('o fim de linha está normalizado em LF', () => {
  const attrs = ler('.gitattributes')
  assert.match(attrs, /^\*\s+text=auto\s+eol=lf$/m, '.gitattributes sem `* text=auto eol=lf`')
  // Os dois hooks são lidos pelo /bin/sh. CRLF no shebang faz o interpretador
  // não ser encontrado, e a mensagem de erro não diz isso.
  assert.match(attrs, /\.githooks\/pre-commit\s+text\s+eol=lf/)
  assert.match(attrs, /\.githooks\/commit-msg\s+text\s+eol=lf/)
})

test('o package.json declara o que o CI invoca', () => {
  const pkg = JSON.parse(ler('package.json'))
  const scripts = pkg.scripts || {}
  for (const nome of ['verificar', 'typecheck', 'test', 'build']) {
    assert.ok(scripts[nome], `package.json sem script \`${nome}\``)
  }
  // A regra `ci-gateia` do rebar cobra que o CI ALCANCE o que o repositório
  // tem. O CI roda um comando só, `npm run verificar`; se este script deixar
  // de encadear os outros, o CI passa a aprovar sem ter olhado.
  for (const nome of ['lint', 'typecheck', 'test']) {
    if (!scripts[nome]) continue
    // Dentro de template literal, `\b` é o caractere BACKSPACE, não a borda de
    // palavra — a regex vira /<bs>lint<bs>/ e nunca casa. Custou uma execução
    // vermelha para aparecer, e é exatamente o tipo de defeito que só a
    // execução acha: o código lê certo e faz outra coisa. String comum, com a
    // barra dobrada, é o conserto.
    assert.match(
      scripts.verificar,
      new RegExp('\\b' + nome + '\\b'),
      `o script \`verificar\` não alcança \`${nome}\``,
    )
  }
})

test('a licença Apache vem acompanhada do NOTICE', () => {
  assert.match(ler('LICENSE'), /Apache License/)
  assert.ok(ler('NOTICE').trim().length > 0, 'NOTICE vazio')
})

test('a allowlist de coautores tem ao menos um humano', () => {
  const linhas = ler('.rebar-coautores')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  assert.ok(linhas.length >= 1, '.rebar-coautores sem nenhuma identidade')
  assert.ok(
    linhas.every((l) => /@/.test(l)),
    'toda linha da allowlist precisa de e-mail — o que é comparado é o e-mail',
  )
})

test('o site exporta estático, que é o que o GitHub Pages publica', () => {
  // A §12.2 do plano fechou: preset `site` é Next App Router com
  // output:"export". Sem isto o `next build` gera servidor, e o Pages publica
  // uma pasta vazia — falha que só aparece no deploy, nunca no build.
  const config = ler('next.config.ts')
  assert.match(config, /output:\s*['"]export['"]/, 'next.config.ts sem output: "export"')
  assert.match(
    config,
    /unoptimized:\s*true/,
    'next.config.ts sem images.unoptimized — o otimizador exige servidor',
  )
})
