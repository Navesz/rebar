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

// ─────────────────────────────────────── o MCP deste projeto, e o frescor dele
//
// ESTE PROJETO NÃO GUARDA CÓPIA DAS REGRAS, e isso é a decisão, não um
// esquecimento. Ele tem um SERVIDOR MCP próprio — `.rebar/mcp.mjs`, zero
// dependência — e esse servidor não recita nada de dentro de si: cada resposta é
// DERIVADA dos arquivos deste projeto no disco, na hora da chamada. Não há
// artefato para regenerar, então não há portão de frescor a construir.
//
// A consequência ruim, e são duas, é que as duas quebram CALADAS. Um `.mcp.json`
// que aponta para um arquivo inexistente aparece no cliente de IA como uma linha
// cinza que ninguém lê. E um servidor que recita a regra depois de o arquivo que
// a impõe ter sumido soa exatamente igual a um portão em vigor. Nas duas o
// agente segue SEM SABER, que é a classe de defeito que este repositório inteiro
// existe para não repetir.
//
// Então os quatro testes abaixo aferem, nesta ordem: que o `.mcp.json` aponta
// para algo que existe; que o que ele aponta não corrompe o canal do protocolo;
// que o servidor SOBE de verdade, faz o handshake e publica as cinco ferramentas
// que o `AGENTS.md` manda chamar; e que ele responde DESARMADA em vez de recitar
// regra sem guarda. Rodam no `npm test`, dentro do `npm run verificar`, dentro do
// CI, nos dois sistemas, e SEM REDE.

/** O caminho do servidor é LIDO do `.mcp.json`, nunca repetido aqui. */
function lancadorDeclarado() {
  const conf = JSON.parse(ler('.mcp.json'))
  const servidor = conf?.mcpServers?.rebar
  assert.ok(servidor, '.mcp.json não declara o servidor `rebar`')
  const alvo = (servidor.args || []).find((a) => a.endsWith('.mjs'))
  assert.ok(alvo, '.mcp.json declara o servidor `rebar` sem apontar para nenhum .mjs')
  return alvo
}

test('o .mcp.json aponta para um servidor que existe', () => {
  const conf = JSON.parse(ler('.mcp.json'))
  // `node` e não `npx`: no Windows o `npx` é `npx.cmd`, um roteiro de lote, e o
  // cliente de MCP sobe o servidor SEM shell — daria ENOENT em toda máquina
  // Windows e em nenhuma Linux. É o defeito que matou o projeto anterior, e ele
  // volta na hora em que alguém "simplifica" este arquivo.
  assert.equal(conf.mcpServers.rebar.command, 'node', '.mcp.json tem de chamar `node`')
  const alvo = lancadorDeclarado()
  assert.ok(tem(alvo), `.mcp.json aponta para ${alvo}, que não está no disco`)
})

test('o servidor escreve no stdout por UM caminho só, que é o do JSON-RPC', () => {
  // O transporte stdio do MCP é JSON-RPC puro no stdout. Uma linha de prosa lá
  // não vira aviso: vira mensagem malformada, e o cliente derruba a sessão sem
  // dizer por quê. Um `console.log` de depuração esquecido é o jeito mais fácil
  // de quebrar isso, e o mais difícil de diagnosticar depois.
  //
  // A régua NÃO é "zero escrita no stdout" — o servidor precisa escrever, é o
  // canal dele. É "uma escrita só", concentrada na função de envio, para que
  // não exista um segundo lugar de onde prosa possa sair.
  const fonte = ler(lancadorDeclarado())
  const escritas = (fonte.match(/process\.stdout\.write/g) || []).length
  // `assert.equal` sobre o número, e não `assert.doesNotMatch` sobre o texto: o
  // segundo despeja o arquivo INTEIRO na saída quando reprova, e a mensagem que
  // interessa fica soterrada. A régua tem de ser legível na hora em que fecha.
  assert.equal(
    escritas,
    1,
    `o servidor tem ${escritas} escritas em stdout; tem de haver exatamente 1`,
  )
  assert.ok(!/console\.log/.test(fonte), 'há console.log no servidor, e isso corrompe o JSON-RPC')
  assert.ok(fonte.includes('github:Navesz/rebar'), 'o servidor não nomeia a régua publicada')
})

/**
 * Sobe o servidor MCP de um projeto, faz o handshake e chama ferramentas.
 *
 * SEM REDE e sem dependência: o servidor lê o disco e nada mais. É o que
 * separa esta prova da anterior — a versão antiga deste arquivo era um lançador
 * que chamava `npx github:Navesz/rebar --mcp`, e essa cadeia saía 2 em toda
 * máquina, sempre, porque o SDK do MCP mora num pacote separado do rebar que o
 * `npx` nunca instala. Prova que precisa de rede é prova que não roda no CI de
 * um cliente.
 */
function conversarComOMcp(raizProjeto, chamadas) {
  const conf = JSON.parse(readFileSync(join(raizProjeto, '.mcp.json'), 'utf8'))
  const s = conf.mcpServers.rebar
  const pedidos = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'portao', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ...chamadas.map((c, i) => ({
      jsonrpc: '2.0',
      id: 10 + i,
      method: 'tools/call',
      params: { name: c.name, arguments: c.args || {} },
    })),
  ]
  // Tudo de uma vez no stdin e o cano fecha: o servidor processa linha a linha e
  // sai no `end`. Não há espera por relógio, então o teste não fica lento nem
  // instável em máquina carregada.
  const r = spawnSync(s.command, s.args, {
    cwd: raizProjeto,
    input: pedidos.map((p) => JSON.stringify(p)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 30_000,
  })
  const linhas = (r.stdout || '').split('\n').filter((l) => l.trim())
  const respostas = linhas.map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      // A prosa no canal do protocolo é O defeito que este servidor não pode
      // ter. Ela vira falha nomeada, e não um JSON.parse estourando cru.
      assert.fail(`o servidor escreveu prosa no stdout, que é o canal do JSON-RPC: ${l}`)
    }
  })
  return { r, respostas }
}

test('o servidor MCP sobe do .mcp.json, faz o handshake e responde às ferramentas', () => {
  // POR QUE ESTE TESTE EXECUTA, em vez de só ler o arquivo. Servidor que nunca
  // rodou é exatamente o que o requisito nº 5 do rebar reclama: código no disco
  // que nenhuma máquina executou — e um MCP que não sobe aparece no cliente
  // como uma linha cinza que ninguém lê.
  const { r, respostas } = conversarComOMcp(RAIZ, [
    { name: 'rebar_regras' },
    { name: 'rebar_verificar' },
  ])

  const ini = respostas.find((m) => m.id === 1)
  assert.ok(ini?.result, `o handshake não voltou: ${r.stderr}`)
  assert.equal(ini.result.serverInfo.name, 'rebar')
  assert.ok(ini.result.capabilities?.tools, 'o servidor não anuncia a capacidade `tools`')
  // As instruções são o único texto que chega ao agente sem ele chamar nada. Se
  // elas não mandarem chamar a régua, o servidor sobe e não ensina ninguém — que
  // é o defeito que este arquivo inteiro existe para não repetir.
  assert.match(
    ini.result.instructions,
    /rebar_regras/,
    'as instruções não mandam chamar rebar_regras',
  )

  const lista = respostas.find((m) => m.id === 2)
  const nomes = (lista?.result?.tools || []).map((t) => t.name)
  // Os nomes são contrato com o AGENTS.md: é ele que manda o agente chamá-los.
  for (const esperado of [
    'rebar_regras',
    'rebar_porque',
    'rebar_decidir',
    'rebar_portao',
    'rebar_verificar',
  ]) {
    assert.ok(
      nomes.includes(esperado),
      `o servidor não publica \`${esperado}\`, que o AGENTS.md manda chamar`,
    )
  }

  const regras = respostas.find((m) => m.id === 10)
  const texto = regras?.result?.content?.[0]?.text || ''
  assert.ok(
    texto.includes('conteudo-fora-do-codigo'),
    'rebar_regras não fala de onde mora o conteúdo',
  )
  assert.ok(
    texto.includes('placeholder-barra-o-build'),
    'rebar_regras não fala do build que reprova no placeholder',
  )
  assert.ok(
    texto.includes('segredo-nao-entra-no-commit'),
    'rebar_regras não fala do segredo barrado no commit',
  )
  assert.ok(texto.includes('coautoria-e-de-humano'), 'rebar_regras não fala da coautoria de IA')
  assert.ok(texto.includes('pilha-fechada'), 'rebar_regras não fala da pilha')

  assert.ok(respostas.find((m) => m.id === 11)?.result, 'rebar_verificar não respondeu')
})

test('o servidor MCP responde DESARMADA em vez de recitar regra sem guarda', () => {
  // O CASO INVERSO, e é o que dá valor ao de cima. Uma resposta que recita a
  // regra sempre — inclusive quando o arquivo que a impõe foi apagado — é pior
  // que silêncio: soa igual a regra em vigor, e o agente segue confiando num
  // portão que não existe mais.
  //
  // A mutação é feita numa CÓPIA em tmpdir, nunca neste repositório.
  const copia = mkdtempSync(join(tmpdir(), 'rebar-mcp-mutado-'))
  mkdirSync(join(copia, '.rebar'), { recursive: true })
  writeFileSync(join(copia, '.mcp.json'), ler('.mcp.json'), 'utf8')
  writeFileSync(join(copia, '.rebar', 'mcp.mjs'), ler(lancadorDeclarado()), 'utf8')
  // package.json mínimo: o projeto existe, e nenhum dos arquivos que impõem as
  // regras foi copiado. É a mutação.
  writeFileSync(join(copia, 'package.json'), '{"name":"mutado"}\n', 'utf8')

  const { respostas } = conversarComOMcp(copia, [{ name: 'rebar_regras' }])
  const texto = respostas.find((m) => m.id === 10)?.result?.content?.[0]?.text || ''
  assert.match(
    texto,
    /DESARMADA/,
    'o servidor recitou as regras num projeto sem nenhum arquivo que as imponha',
  )
  assert.match(
    texto,
    /Avise o usuário/,
    'o servidor não manda avisar o usuário quando o portão está desarmado',
  )
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
