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
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
    '.mcp.json',
  ]) {
    assert.ok(tem(arquivo), `faltando: ${arquivo}`)
  }
})

// ────────────────────────────────────── o ponteiro para as regras, e o frescor dele
//
// ESTE PROJETO NÃO GUARDA CÓPIA DAS REGRAS, e isso é a decisão, não um
// esquecimento. As regras são as do `rebar`; o que mora aqui é um PONTEIRO para
// elas. A consequência boa é que nada aqui envelhece quando uma regra muda — não
// há artefato para regenerar, então não há portão de frescor a construir.
//
// A consequência ruim, e é a única, é que ponteiro quebra calado: um `.mcp.json`
// que aponta para um arquivo inexistente aparece no cliente de IA como uma linha
// cinza que ninguém lê, e o agente segue sem as regras SEM SABER DISSO. É a
// mesma classe do defeito que este repositório inteiro existe para não repetir.
//
// Então o que estes três testes aferem é o ponteiro: que ele aponta para algo
// que existe, que o que ele aponta não corrompe o protocolo, e que ele roda de
// verdade. Rodam no `npm test`, dentro do `npm run verificar`, dentro do CI, nos
// dois sistemas.

/** O caminho do lançador é LIDO do `.mcp.json`, nunca repetido aqui. */
function lancadorDeclarado() {
  const conf = JSON.parse(ler('.mcp.json'))
  const servidor = conf?.mcpServers?.rebar
  assert.ok(servidor, '.mcp.json não declara o servidor `rebar`')
  const alvo = (servidor.args || []).find((a) => a.endsWith('.mjs'))
  assert.ok(alvo, '.mcp.json declara o servidor `rebar` sem apontar para nenhum .mjs')
  return alvo
}

test('o .mcp.json aponta para um lançador que existe', () => {
  const conf = JSON.parse(ler('.mcp.json'))
  // `node` e não `npx`: no Windows o `npx` é `npx.cmd`, um roteiro de lote, e o
  // cliente de MCP sobe o servidor SEM shell — daria ENOENT em toda máquina
  // Windows e em nenhuma Linux. É o defeito que matou o projeto anterior, e ele
  // volta na hora em que alguém "simplifica" este arquivo.
  assert.equal(conf.mcpServers.rebar.command, 'node', '.mcp.json tem de chamar `node`')
  const alvo = lancadorDeclarado()
  assert.ok(tem(alvo), `.mcp.json aponta para ${alvo}, que não está no disco`)
})

test('o lançador não escreve no stdout, que é o canal do JSON-RPC', () => {
  // O transporte stdio do MCP é JSON-RPC puro no stdout. Uma linha de prosa lá
  // não vira aviso: vira mensagem malformada, e o cliente derruba a sessão sem
  // dizer por quê. Um `console.log` de depuração esquecido é o jeito mais fácil
  // de quebrar isso, e o mais difícil de diagnosticar depois.
  const fonte = ler(lancadorDeclarado())
  // `assert.ok` sobre um booleano, e não `assert.doesNotMatch` sobre o texto: o
  // segundo despeja o arquivo INTEIRO na saída quando reprova, e a mensagem que
  // interessa fica soterrada. A régua tem de ser legível na hora em que fecha.
  const escreveNoStdout = /console\.log|process\.stdout\.write/.test(fonte)
  assert.ok(!escreveNoStdout, 'o lançador escreve no stdout, e isso corrompe o JSON-RPC do MCP')
  assert.ok(fonte.includes('github:Navesz/rebar'), 'o lançador não nomeia a fonte das regras')
})

test('o lançador repassa a bandeira --mcp e devolve o código de saída do rebar', () => {
  // POR QUE ESTE TESTE EXECUTA, em vez de só ler o arquivo. Um lançador que
  // nunca rodou é exatamente o que o requisito nº 5 do rebar reclama: código no
  // disco que nenhuma máquina executou. A bandeira `--rebar` existe para isto —
  // ela aponta para um checkout em disco, então a prova roda SEM REDE.
  const base = mkdtempSync(join(tmpdir(), 'rebar-mcp-'))
  const pasta = join(base, 'ferramental', 'rebar-check')
  mkdirSync(pasta, { recursive: true })
  // O dublê imita a única coisa que o contrato promete: o rebar responde à
  // bandeira `--mcp`. Ele grita o que recebeu no stderr — nunca no stdout, que
  // é o canal do JSON-RPC — e sai com um código que não é 0 nem 1, para que a
  // asserção do código de saída não passe por acaso.
  writeFileSync(
    join(pasta, 'index.mjs'),
    [
      'process.stderr.write(`duble:${process.argv.slice(2).join(",")}\\n`)',
      'process.exit(42)',
      '',
    ].join('\n'),
    'utf8',
  )

  const r = spawnSync(process.execPath, [join(RAIZ, lancadorDeclarado()), '--rebar', base], {
    encoding: 'utf8',
  })
  assert.match(r.stderr, /duble:--mcp/, `o lançador não repassou a bandeira \`--mcp\`: ${r.stderr}`)
  assert.equal(r.status, 42, 'o lançador não devolveu o código de saída do rebar')
  // Falha barulhenta: saída não-zero tem de nomear o comando tentado e a saída
  // que não depende de MCP nenhum. Atalho que morre calado é pior que atalho
  // nenhum.
  assert.match(r.stderr, /--json/, 'a falha do lançador não nomeia a alternativa sem MCP')
})

test('o AGENTS.md manda derivar as regras, e não repete nenhuma', () => {
  const agents = ler('AGENTS.md')
  assert.match(agents, /npx --yes github:Navesz\/rebar \./, 'AGENTS.md não traz a régua derivada')
  assert.match(agents, /\.mcp\.json/, 'AGENTS.md não menciona o ponteiro de MCP')
  // Comparação por texto, e não por regex montada na hora: o caminho tem ponto
  // e barra, e uma regex mal escapada aqui casaria por acaso e não provaria nada.
  const alvo = lancadorDeclarado()
  assert.ok(agents.includes(alvo), `AGENTS.md não cita ${alvo}, que é o que o .mcp.json executa`)
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
