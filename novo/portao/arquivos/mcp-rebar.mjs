#!/usr/bin/env node
// LANÇADOR DO MCP DO REBAR. Não é servidor, e não guarda uma única regra.
//
// ─────────────────────────────────────────────────────────── a decisão, e o custo
//
// A pergunta era: este projeto ganha um MCP PRÓPRIO, ou aponta para o do rebar?
// A resposta é APONTAR, e o que decide é uma contagem, não gosto.
//
// Este projeto tem ZERO regra própria. O que o `npm run verificar` dele roda —
// lint, typecheck, teste, build — é configuração de ferramenta, não regra de
// projeto. As regras que o medem são as do rebar — 22 em 2026-09-01, 17
// determinísticas e 5 heurísticas, contadas com
// `npx --yes github:Navesz/rebar . --json` de dentro deste projeto —, e o
// `README.md` já manda rodar a régua. Um MCP próprio aqui serviria, portanto,
// uma CÓPIA de regra de outro repositório.
//
// O que a cópia custaria, item por item, e tudo isso por projeto gerado:
//   1. o artefato com as 22 regras, que envelhece no minuto em que o rebar mexe
//      numa delas — é literalmente o defeito do Herz, o requisito nº 5;
//   2. um gerador que o reescreva, que precisaria da FONTE das regras;
//   3. a fonte, que mora no rebar em 2.292 linhas — ou seja, vendorizar o
//      checker inteiro aqui dentro, e aí não há portão que prove que a cópia
//      dele acompanha o original;
//   4. um portão de frescor no `verificar` deste projeto, que só conseguiria
//      provar que a cópia bate com a cópia da fonte;
//   5. o SDK de MCP como dependência, num projeto cujo `AGENTS.md` diz que
//      dependência nova precisa de motivo escrito.
//
// Apontar custa UMA coisa: o rebar tem de estar alcançável. E ele já tem de
// estar — é a régua deste projeto, e ela roda por `npx` sem instalar nada. Não
// é dependência nova; é a mesma que já existe, agora com uma segunda porta.
//
// ────────────────────────────────────────── por que existe um lançador, e não npx direto
//
// O `.mcp.json` poderia trazer `"command": "npx"` e acabar aqui. Não traz, e o
// motivo é o defeito que matou o projeto anterior: no Windows o `npx` NÃO é
// executável — é `npx.cmd`, um roteiro de lote, e o CreateProcess não roda
// `.cmd` sem interpretador. O erro é ENOENT sobre um comando que está no PATH,
// e ele sobreviveu um ano porque só o Linux era testado. O cliente de MCP sobe
// o servidor sem shell; posto ali cru, o `npx` daria ENOENT em toda máquina
// Windows e em nenhuma Linux.
//
// `node` é executável de verdade nos dois sistemas. Então o `.mcp.json` chama
// `node` neste arquivo, e a resolução do `npx` acontece aqui, do mesmo jeito
// que o gerador do rebar já resolve: acha-se o `npx-cli.js` real e chama-se
// `process.execPath` com ele. O `shell: true` fica de rede, para o layout de
// instalação não previsto, e é anunciado quando é usado.
//
// A resolução abaixo é uma segunda cópia da que está em `novo/index.mjs` do
// rebar, e isso é dito em vez de escondido: este arquivo roda numa máquina que
// pode não ter o rebar em disco, então importar de lá é impossível. É cópia de
// MECÂNICA, não de regra — nada aqui muda quando uma regra do rebar muda, que é
// justamente o que faz este arquivo não ter portão de frescor.
//
// ─────────────────────────────────────────────────────── o MCP nunca é a porta
//
// Se nada disto subir, as regras continuam alcançáveis pelo comando que o CI
// usa. É por isso que a falha aqui é barulhenta e nomeia esse comando: um
// atalho que morre calado é pior que atalho nenhum.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// A ÚNICA coisa que este arquivo sabe sobre as regras: o endereço de quem as
// tem. Uma fonte, publicada, a mesma que o README e o CI já usam.
const ESPEC_REBAR = 'github:Navesz/rebar'

// BANDEIRA, e não subcomando solto, e a escolha foi MEDIDA nas duas formas —
// quando o rebar ainda não respondia a nenhuma, e o critério era qual das duas
// FALHA melhor, porque falhar é o que elas faziam:
//
//   `rebar mcp`     o parser lia `mcp` como CAMINHO DE ALVO, auditava uma pasta
//                   que não existe e imprimia um placar vermelho NO STDOUT,
//                   saindo 2. Numa sessão de MCP isso é o pior resultado
//                   possível: prosa no canal do JSON-RPC, ou seja, resposta
//                   errada com cara de resposta.
//   `rebar --mcp`   o mesmo parser recusava opção desconhecida ANTES de
//                   qualquer coisa, no STDERR, stdout vazio, saída 2. Erro que
//                   não polui o canal e que nomeia o que falta.
//
// A bandeira ganhou, e desde então o rebar RESPONDE a ela: o despacho está em
// `ferramental/rebar-check/index.mjs`, junto do subcomando `novo`, e entrega o
// processo ao servidor MCP com `stdio: 'inherit'`. De quebra, bandeira não
// colide com nome de pasta — o subcomando `novo` já teve de documentar que,
// para auditar uma pasta chamada "novo", escreve-se "./novo".
const BANDEIRA = '--mcp'

// Tudo o que este processo diz vai para o STDERR, sem exceção.
//
// O transporte stdio do MCP é JSON-RPC puro no STDOUT. Uma linha de prosa lá
// dentro não vira aviso: vira mensagem malformada, e o cliente derruba a sessão
// inteira sem dizer por quê. O teste `testes/portao.test.mjs` deste projeto
// varre o texto daqui atrás de qualquer escrita no canal padrão de saída e
// reprova, porque é regra fácil demais de quebrar num conserto apressado — e
// ela já reprovou uma vez, por causa deste comentário, quando ele nomeava a
// chamada proibida em vez de descrevê-la.
const grito = (t) => process.stderr.write(`rebar-mcp: ${t}\n`)

/**
 * Acha o `npx-cli.js` de verdade — um roteiro Node, executável nos dois
 * sistemas — em vez de confiar no `npx` do PATH, que no Windows é `.cmd`.
 */
function resolverNpx() {
  const dirNode = dirname(process.execPath)
  const candidatos = [
    // Windows: node.exe e node_modules/npm/ dividem a mesma pasta.
    join(dirNode, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX: o npm fica em ../lib/node_modules. Vale para nvm, fnm e homebrew.
    join(dirNode, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirNode, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  // Rodando por dentro de um roteiro npm, o próprio npm diz onde está. Chave em
  // caixa baixa de propósito: é o nome que o npm publica.
  if (process.env.npm_execpath) {
    candidatos.unshift(join(dirname(process.env.npm_execpath), 'npx-cli.js'))
  }
  return candidatos.find((c) => existsSync(c)) || null
}

/**
 * `--rebar <caminho>` aponta para um checkout do rebar em disco, em vez da
 * versão publicada.
 *
 * Existe por DUAS razões e nenhuma delas é conveniência. A primeira: é assim
 * que o portão consegue PROVAR este arquivo sem rede — o teste do projeto roda
 * o lançador contra um alvo em disco e confere que ele repassa a bandeira e
 * devolve o código de saída do filho. Sem isso o lançador seria mais um arquivo
 * que nunca rodou. A segunda: quem desenvolve o próprio rebar precisa ver a
 * mudança dele antes de publicar.
 *
 * É ARGUMENTO, e não variável de ambiente, também por dois motivos. Variável de
 * ambiente é estado invisível que muda o comportamento sem aparecer em lugar
 * nenhum; e a régua do rebar cobra que toda variável lida esteja documentada em
 * `.env.example` — um projeto de site que não lê ambiente nenhum não vai passar
 * a ler por causa de um atalho.
 */
function alvoLocal(argv) {
  const i = argv.indexOf('--rebar')
  if (i === -1) return null
  const raiz = argv[i + 1]
  if (!raiz || raiz.startsWith('--')) {
    grito('`--rebar` veio sem caminho depois.')
    return { erro: true }
  }
  return { caminho: join(raiz, 'ferramental', 'rebar-check', 'index.mjs') }
}

function main(argv) {
  const local = alvoLocal(argv)
  if (local?.erro) return 2

  if (local) {
    if (!existsSync(local.caminho)) {
      grito(`não achei o rebar em ${local.caminho}`)
      grito('confira o caminho passado em `--rebar`, ou tire a bandeira para usar o publicado.')
      return 127
    }
    const r = spawnSync(process.execPath, [local.caminho, BANDEIRA], { stdio: 'inherit' })
    return encerrar(r, `node ${local.caminho} ${BANDEIRA}`)
  }

  // `stdio: 'inherit'`: o filho herda os MESMOS descritores deste processo, e o
  // JSON-RPC do cliente chega nele sem passar por aqui. Copiar byte de um cano
  // para o outro seria pôr este arquivo no meio de um protocolo que ele não
  // entende — e todo bug de enquadramento nasce daí.
  const args = ['--yes', ESPEC_REBAR, BANDEIRA]
  const npx = resolverNpx()
  if (npx) {
    const r = spawnSync(process.execPath, [npx, ...args], { stdio: 'inherit' })
    return encerrar(r, `npx ${args.join(' ')}`)
  }

  grito('não achei o npx-cli.js ao lado do Node; caindo para shell:true.')
  grito('a linha de comando abaixo é constante deste arquivo — nada de fora entra nela.')
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true })
  return encerrar(r, `npx ${args.join(' ')}`)
}

/**
 * A falha nomeia o comando tentado E a saída que não depende de MCP nenhum.
 *
 * Um servidor de MCP que não sobe aparece no cliente como uma linha cinza que
 * ninguém lê. Se a única coisa que o agente perde for silenciosa, ele segue sem
 * as regras e não sabe disso — que é exatamente o defeito que este projeto
 * inteiro existe para não repetir.
 */
function encerrar(r, comando) {
  if (r.error) {
    grito(`o rebar não chegou a rodar: ${r.error.message}`)
  } else if (r.status !== 0) {
    grito(`o rebar não respondeu como servidor MCP (saída ${r.status}).`)
  } else {
    return 0
  }
  grito(`comando: ${comando}`)
  grito('as regras NÃO dependem disto. O mesmo que o CI cobra, sem instalar nada:')
  grito(`  npx --yes ${ESPEC_REBAR} .`)
  grito(`  npx --yes ${ESPEC_REBAR} . --json`)
  return r.status || 127
}

process.exit(main(process.argv.slice(2)))
