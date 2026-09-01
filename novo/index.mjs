#!/usr/bin/env node
// O GERADOR.  npx github:Navesz/rebar novo <nome>
//
// ELE NÃO ESCREVE APLICAÇÃO, e essa é a decisão que governa o arquivo inteiro.
// O scaffold é delegado ao `shadcn create`, que já entrega exatamente a pilha
// decidida na §12.2 — Next 16 App Router, React 19.2.4, Tailwind 4, estilo
// base-nova sobre @base-ui/react, zero Radix. Escrever o nosso próprio scaffold
// seria manter uma cópia do trabalho do shadcn em dia para sempre, e ela
// começaria a apodrecer na primeira release deles.
//
// O que este arquivo faz é o que o shadcn não faz: valida o nome, chama o
// scaffold de forma que funcione nos DOIS sistemas, aplica o portão por cima,
// faz o primeiro commit e RODA A RÉGUA no resultado, imprimindo o placar. Um
// projeto gerado que não passa na própria régua do rebar é um gerador que
// fabrica dívida, então o placar sai na tela, sempre, mesmo quando é ruim.
//
// Zero dependência: só built-in do Node.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { aplicarPortao, marcarExecutaveis, PASTA_HOOKS } from './portao/aplicar.mjs'

// fileURLToPath, não .pathname: no Windows o pathname vem "/C:/Users/...", com
// barra antes da letra do drive, e todo join a partir dele aponta para o nada.
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_REBAR = join(AQUI, '..')

const eco = (...t) => console.log(...t)

// ───────────────────────────────────────────────────────── 1. o nome do projeto
//
// O nome é ENTRADA DO USUÁRIO e é o único valor variável que chega perto de um
// processo filho. Ele é validado aqui, uma vez, contra uma allowlist de
// caracteres — não contra uma lista de coisas proibidas. Lista de proibidos é a
// forma que sempre falta um caso; allowlist erra fechando.
const NOME_VALIDO = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

// Nomes que o Windows reserva para dispositivo. `mkdir CON` falha com uma
// mensagem que não diz por quê, e o projeto morre no meio do scaffold.
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i

function validarNome(nome) {
  if (!nome) return 'falta o nome do projeto'
  if (nome.length > 64) return 'nome com mais de 64 caracteres'
  if (!NOME_VALIDO.test(nome)) {
    return (
      `"${nome}" não serve. Use minúsculas, dígitos, ponto, hífen e sublinhado, ` +
      'começando e terminando por letra ou dígito. Sem espaço, sem barra, sem acento — ' +
      'o nome vira pasta, pacote npm e nome de repositório, e os três são mais estreitos ' +
      'que o sistema de arquivos.'
    )
  }
  if (RESERVADOS_WINDOWS.test(nome)) return `"${nome}" é nome reservado pelo Windows`
  return null
}

// O domínio não passa por shell nenhum — ele vira string dentro de um JSON de
// conteúdo. Ainda assim é validado, e por uma razão que não é injeção: ele é
// concatenado como `https://${dominio}`, então um valor com barra, espaço ou
// esquema junto produz uma URL quebrada que só aparece no cartão de
// compartilhamento, depois de publicado.
const DOMINIO_VALIDO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

function validarDominio(dominio) {
  if (DOMINIO_VALIDO.test(dominio) && dominio.length <= 253) return null
  return (
    `"${dominio}" não é um domínio. Escreva só o host, sem https:// e sem barra — ` +
    'por exemplo: padaria.com.br, ou navesz.github.io'
  )
}

// ────────────────────────────────────────────── 2. como chamar o `shadcn create`
//
// AQUI MORA O DEFEITO QUE MATOU O PROJETO ANTERIOR, e a escolha está escrita
// para não ser desfeita por engano.
//
// `execFileSync('npx', ...)` NÃO FUNCIONA no Windows. `npx` não é executável
// lá: é o `npx.cmd`, um shim de batch, e o CreateProcess do Windows não executa
// arquivo `.cmd` sem um interpretador. O erro é `ENOENT`, que diz "não achei o
// arquivo" sobre um arquivo que está no PATH, e é por isso que ele sobreviveu um
// ano no alicerce — o CI de lá só rodava Linux, onde `npx` é um symlink de
// verdade e tudo passa.
//
// DUAS SAÍDAS, E A ESCOLHIDA É A PRIMEIRA:
//
//   (a) RESOLVER O BINÁRIO. O `npx` real é um script Node, `npx-cli.js`, que
//       mora junto com o npm ao lado do próprio Node. Achado ele, a chamada
//       vira `process.execPath` + o caminho do script — um executável de
//       verdade, argumentos passados como VETOR, sem shell nenhum no meio. Não
//       existe interpolação, então não existe superfície de injeção, e o
//       comando é literalmente o mesmo nos dois sistemas.
//
//   (b) `spawnSync(..., { shell: true })`. Funciona, mas paga um preço: com
//       shell, os argumentos deixam de ser um vetor e passam a ser uma LINHA DE
//       COMANDO que o cmd.exe reparseia. O nome do projeto é entrada do usuário
//       e estaria nessa linha. Dá para blindar — e está blindado, o
//       `validarNome` acima roda antes de tudo —, mas a blindagem é uma segunda
//       coisa a manter certa para sempre.
//
// (a) é o padrão. (b) fica como rede, para o layout de instalação que eu não
// previ, e SÓ é alcançada com o nome já validado. A rede é anunciada quando é
// usada: cair para o shell em silêncio seria trocar um defeito por outro.
function resolverNpx() {
  const dirNode = dirname(process.execPath)
  const candidatos = [
    // Windows: node.exe e node_modules/npm/ dividem a mesma pasta.
    join(dirNode, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX: /usr/bin/node ou ~/.nvm/versions/node/vX/bin/node — o npm fica em
    // ../lib/node_modules. Vale para nvm, fnm, volta e homebrew.
    join(dirNode, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirNode, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  // Rodando por dentro de um script npm, o próprio npm diz onde está.
  if (process.env.npm_execpath) {
    candidatos.unshift(join(dirname(process.env.npm_execpath), 'npx-cli.js'))
  }
  return candidatos.find((c) => existsSync(c)) || null
}

function rodarShadcn(nome, pasta) {
  // Vetor fixo. O único elemento variável é `nome`, já validado, e `pasta`, que
  // é caminho que este processo calculou — nenhum dos dois passa por shell no
  // caminho (a).
  const args = [
    'shadcn@latest',
    'create',
    '-t',
    'next',
    '-b',
    'base',
    '-p',
    'nova',
    '--pointer',
    '-n',
    nome,
    '-y',
    '-c',
    pasta,
  ]

  const npx = resolverNpx()
  if (npx) {
    eco(`  npx resolvido: ${npx}`)
    return spawnSync(process.execPath, [npx, '--yes', ...args], {
      cwd: pasta,
      stdio: 'inherit',
    })
  }

  eco('  AVISO: não achei o npx-cli.js ao lado do Node; caindo para shell:true.')
  eco('         O nome do projeto já foi validado contra allowlist de caracteres.')
  return spawnSync('npx', ['--yes', ...args], { cwd: pasta, stdio: 'inherit', shell: true })
}

// ──────────────────────────────────────────────────────────────────── git

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

function configGit(cwd, chave) {
  const r = git(cwd, ['config', '--get', chave])
  return r.status === 0 ? r.stdout.trim() : ''
}

// ─────────────────────────────────────────────────────────────────── a régua

/**
 * Roda o rebar-check no projeto gerado e devolve o exit code.
 *
 * Prefere o checker do checkout local — é o mesmo código que o `npx
 * github:Navesz/rebar` baixaria, sem rede e sem cache velho no meio. A rede só
 * entra se este arquivo estiver rodando de um lugar onde o `ferramental/` não
 * veio junto, o que não deveria acontecer e por isso é anunciado.
 */
function rodarRegua(destino) {
  const local = join(RAIZ_REBAR, 'ferramental', 'rebar-check', 'index.mjs')
  if (existsSync(local)) {
    return spawnSync(process.execPath, [local, destino], { stdio: 'inherit' }).status
  }
  eco('  AVISO: não achei o rebar-check local; buscando por npx (precisa de rede).')
  const npx = resolverNpx()
  const args = ['--yes', 'github:Navesz/rebar', destino]
  const r = npx
    ? spawnSync(process.execPath, [npx, ...args], { stdio: 'inherit' })
    : spawnSync('npx', args, { stdio: 'inherit', shell: true })
  return r.status
}

// ──────────────────────────────────────────────────────────────────── main

async function main(argv) {
  // Aceita as duas formas de invocação, porque as duas vão existir:
  //   node novo/index.mjs <nome>                (do checkout)
  //   npx github:Navesz/rebar novo <nome>       (com o bin ligado ao despacho)
  const args = argv[0] === 'novo' ? argv.slice(1) : argv
  const nome = args[0]

  const erroNome = validarNome(nome)
  if (erroNome) {
    console.error(`\n  ${erroNome}\n`)
    console.error('  uso: npx github:Navesz/rebar novo <nome> [dominio]\n')
    return 2
  }

  // O domínio é opcional e o padrão é DELIBERADAMENTE inútil. Ele vira o
  // `meta.urlBase` do conteúdo, ou seja, o `og:url` e o `sitemap` do site — e um
  // padrão plausível-porém-errado é a pior das opções: sobe, não quebra nada
  // visível, e aponta o cartão de compartilhamento para o lugar errado durante
  // meses. `.invalid` é TLD reservado pela RFC 2606 e não resolve nunca, então
  // o esquecimento é inerte e barulhento em vez de silencioso.
  const dominio = args[1] || `${nome}.exemplo.invalid`
  const erroDominio = validarDominio(dominio)
  if (erroDominio) {
    console.error(`\n  ${erroDominio}\n`)
    return 2
  }

  const pasta = process.cwd()
  const destino = resolve(pasta, nome)
  if (existsSync(destino)) {
    console.error(`\n  já existe ${destino}\n`)
    console.error('  O gerador não escreve por cima de pasta existente: o que ele faria com o')
    console.error('  que já está lá dentro não tem resposta boa.\n')
    return 2
  }

  eco(`\n▸ 1/6  nome validado: ${nome}`)
  eco(`       destino: ${destino}`)

  eco('\n▸ 2/6  scaffold pelo shadcn (Next 16 · base-nova · @base-ui/react)')
  const r = rodarShadcn(nome, pasta)
  if (r.error) {
    console.error(`\n  o shadcn create não chegou a rodar: ${r.error.message}\n`)
    return 127
  }
  if (r.status !== 0) {
    console.error(`\n  o shadcn create saiu ${r.status}. Nada foi aplicado por cima.\n`)
    return r.status || 127
  }
  if (!existsSync(destino)) {
    console.error(`\n  o shadcn saiu 0 mas ${destino} não existe. Não sei o que ele criou.\n`)
    return 127
  }

  // A identidade vem do git da máquina, e não de um valor fixo no código: quem
  // aparece no NOTICE e na allowlist TEM de ser quem vai commitar. Se as duas
  // divergirem, o primeiro commit do projeto já nasce reprovado na regra
  // `coautoria-ia` — a allowlist listaria uma pessoa e o histórico teria outra.
  //
  // As variáveis de ambiente entram como segunda fonte porque runner de CI e
  // container costumam não ter `git config` nenhum e passar a identidade por
  // GIT_AUTHOR_*. Se as duas faltarem, o gerador NÃO INVENTA: avisa, não
  // commita, e deixa um marcador que grita no lugar do nome.
  const nomeConfig = configGit(destino, 'user.name') || process.env.GIT_AUTHOR_NAME || ''
  const emailConfig = configGit(destino, 'user.email') || process.env.GIT_AUTHOR_EMAIL || ''
  const dono = nomeConfig || 'DONO NÃO CONFIGURADO'
  const email = emailConfig || 'configure-git-user-email@exemplo.invalido'
  const semIdentidade = !emailConfig

  // O PRESET `site` VEM ANTES DO PORTÃO, e a ordem é obrigatória.
  //
  // O `novo/site/aplicar.mjs` copia os blocos dele com `cpSync(..., { force:
  // true })` — ele SOBRESCREVE. O portão é idempotente e não destrói nada. Numa
  // pilha de camadas, a destrutiva roda primeiro e a idempotente por último;
  // invertido, o `force: true` apagaria o next.config.ts que o portão acabou de
  // ajustar, em silêncio. É por isso que o portão é "por cima".
  //
  // Opcional e defensivo: se o preset não estiver presente, ou se ele quebrar, o
  // projeto ainda sai — com o scaffold cru do shadcn e o portão inteiro. O que
  // não pode acontecer é a falha passar despercebida, então ela vira aviso, e
  // aviso derruba o exit code no fim.
  eco('\n▸ 3/6  preset site, e o portão por cima dele')
  const avisosSite = []
  if (!args[1]) {
    avisosSite.push(
      `domínio não informado — o conteúdo saiu com "${dominio}", que não resolve. ` +
        'Troque `meta.urlBase` em conteudo/site.json antes de publicar, ou gere de novo com: ' +
        `novo ${nome} <dominio>`,
    )
  }
  const caminhoSite = join(AQUI, 'site', 'aplicar.mjs')
  if (!existsSync(caminhoSite)) {
    eco('       preset site: ausente — sai o scaffold cru do shadcn')
  } else {
    try {
      const { aplicarSite } = await import(pathToFileURL(caminhoSite).href)
      if (typeof aplicarSite !== 'function') {
        throw new Error('novo/site/aplicar.mjs não exporta aplicarSite')
      }
      const escritosSite = aplicarSite({ destino, nome, dominio, agora: new Date() }) || []
      eco(`       preset site: ${escritosSite.length} arquivo(s) · domínio ${dominio}`)
    } catch (erro) {
      avisosSite.push(`o preset site falhou (${erro.message}) — saiu o scaffold cru do shadcn`)
      eco(`       preset site: FALHOU — ${erro.message}`)
    }
  }

  const { escritos, avisos, elos, exportEstatico } = aplicarPortao({
    destino,
    nome,
    raizRebar: RAIZ_REBAR,
    dono,
    email,
  })
  avisos.unshift(...avisosSite)
  for (const a of escritos) eco(`       + ${a}`)
  eco(`       next.config.ts output:"export" → ${exportEstatico}`)
  eco(`       script verificar → ${elos ? elos.join(' + ') : '(não escrito)'}`)

  eco('\n▸ 4/6  git: init, hooks, primeiro commit')
  // `git init` é idempotente e o create-next-app já inicializou — mas ele não
  // commitou nada, então o primeiro commit é nosso. Rodar init de novo só
  // garante o caso em que o scaffold mudar de comportamento.
  git(destino, ['init', '-q'])
  git(destino, ['add', '-A'])

  const modos = marcarExecutaveis(destino, avisos)
  if (modos) for (const m of modos) eco(`       modo ${m}`)

  // Os hooks são instalados ANTES do primeiro commit, de propósito: o commit do
  // gerador passa pelo portão que o gerador acabou de montar. Portão que a
  // própria criação dele não atravessa é portão não testado.
  const inst = spawnSync(process.execPath, [join(destino, PASTA_HOOKS, 'instalar.mjs')], {
    cwd: destino,
    encoding: 'utf8',
  })
  eco(`       ${(inst.stdout || inst.stderr || '').trim().split('\n').join('\n       ')}`)

  let commitou = false
  if (semIdentidade) {
    avisos.push(
      'git sem user.email nesta máquina — o primeiro commit NÃO foi feito. ' +
        'Configure e rode: git commit -m "primeiro commit"',
    )
  } else {
    // `-c user.*` na chamada, e não `git config`: o commit sai com EXATAMENTE a
    // identidade que foi escrita na allowlist e no NOTICE, venha ela do config
    // ou do ambiente. Sem isto, uma máquina com config global e GIT_AUTHOR_*
    // divergentes escreveria um nome no arquivo e outro no histórico — e a
    // divergência só apareceria meses depois, na regra `identidade-git`.
    const c = git(destino, [
      '-c',
      `user.name=${dono}`,
      '-c',
      `user.email=${email}`,
      'commit',
      '-q',
      '-m',
      `${nome}: scaffold shadcn + portão do rebar`,
    ])
    commitou = c.status === 0
    if (!commitou) {
      avisos.push(`o primeiro commit falhou (${c.status}): ${(c.stderr || '').trim()}`)
    }
  }
  eco(`       primeiro commit: ${commitou ? 'feito' : 'NÃO FEITO'}`)

  eco('\n▸ 5/6  a régua do rebar sobre o que acabou de ser gerado\n')
  const placar = rodarRegua(destino)

  eco('\n▸ 6/6  o que falta, e é você quem faz')
  eco('')
  eco(`  cd ${nome}`)
  eco('  npm run verificar          # lint, typecheck, teste e build — o mesmo que o CI roda')
  eco('  npm run dev')
  eco('')
  eco('  O GERADOR NÃO FAZ ESTAS, DE PROPÓSITO — são as que mexem na sua conta:')
  eco('   1. criar o repositório remoto (gh repo create, ou pelo site) e dar o push')
  eco('   2. Settings › Rules › new ruleset: exigir o check `verificar` e proibir bypass.')
  eco('      Sem o ruleset, o CI é um selo verde opcional e o portão não fecha nada.')
  eco('   3. Settings › Pages › Source: GitHub Actions, se este site vai ao ar.')
  eco('   4. conferir .rebar-coautores: entrou a identidade do git desta máquina.')
  eco('')

  if (avisos.length) {
    eco('  AVISOS:')
    for (const a of avisos) eco(`   · ${a}`)
    eco('')
  }

  // O exit do gerador é o exit da régua, e um aviso também derruba. Um projeto
  // gerado que não passa na própria régua não pode sair 0: seria o gerador
  // aprovando a dívida que ele mesmo acabou de fabricar. E projeto entregue
  // pela metade — sem commit, sem hook executável — sai 1 mesmo com a régua
  // verde, porque a régua não tem regra para o que ainda não aconteceu.
  const codigo = placar !== 0 ? placar || 1 : avisos.length ? 1 : 0
  eco(`  régua: exit ${placar}${placar === 0 ? ' — passou' : ' — NÃO passou, leia o placar acima'}`)
  eco(
    `  gerador: exit ${codigo}` +
      (codigo === 0
        ? ' — projeto completo'
        : placar !== 0
          ? ' — a régua reprovou'
          : ' — a régua passou, mas há aviso acima que precisa de mão'),
  )
  eco('')

  return codigo
}

process.exit(await main(process.argv.slice(2)))
