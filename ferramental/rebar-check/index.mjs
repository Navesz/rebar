#!/usr/bin/env node
// rebar-check — roda contra QUALQUER repositório e imprime um placar.
//
// Por que isto existe antes do gerador: o projeto anterior não escalou. A
// versão antiga deste comentário dizia que ele "morreu porque a imposição
// nunca encostou num projeto", e isso foi MEDIDO e é FALSO — o ferramental
// dele gateia o CI de um repositório real, `prumo/.github/workflows/ci.yml`
// linha 113. Encostou em 2 de 19. O que faltou foi escala, não contato.
// Checar é retroativo e funciona nos repositórios que já existem; gerar só
// serve para o próximo. A inversão certa não é gerador-primeiro, é
// CONSUMIDOR-primeiro.
//
// Zero dependência: só built-ins do Node. O que confere o build não pode
// depender do build, e assim `npx github:Navesz/rebar` funciona sem instalar
// — o campo `bin` do package.json é o que faz o npx resolver isto, e a
// promessa ficou falsa desde o primeiro commit até o campo existir.
//
// Nunca escreve nada. Lê o repositório e sai.
//
// Uso:
//   node index.mjs [caminho...]        placar por repositório
//   node index.mjs --json [caminho]    saída para CI
//   node index.mjs --regra=<id> [dir]  uma regra só (é o que as provas usam)
//   node index.mjs --heuristicas       heurísticas também derrubam o exit code
//   node index.mjs novo <nome> [dom]   despacha para o GERADOR, novo/index.mjs
//   node index.mjs --mcp               entrega o stdio ao SERVIDOR MCP, mcp/src/
//
// O subcomando `novo` mora aqui, e não num segundo `bin`, por uma razão de
// mecânica do npx: `npx github:Navesz/rebar novo meu-site` resolve o bin que
// tem o NOME DO PACOTE — `rebar`, este arquivo — e passa "novo" como primeiro
// argumento. Sem o despacho, o checker tratava "novo" como caminho a auditar e
// saía 2 dizendo "caminho não existe". Um `bin` extra não conserta isso: ele só
// é alcançável por `npx -p github:Navesz/rebar rebar-novo …`, que ninguém
// digita. Ele existe assim mesmo, como forma inequívoca — ver o package.json.
//
// Para auditar uma pasta que se chame literalmente `novo`, use `./novo`.
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

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, saida: saida.trim() }
  } catch (e) {
    return { ok: false, erro: (e.stderr || e.message || '').toString().trim().split('\n')[0] }
  }
}

/**
 * Leitura com TRÊS estados, pelo mesmo motivo que `na()` existe: duas caixas
 * não bastam para três coisas.
 *
 *   { estado: 'ok', texto }       li
 *   { estado: 'ausente' }         não existe — N/A legítimo
 *   { estado: 'ilegivel', erro }  EXISTE e não consegui ler
 *
 * O `catch { return null }` de antes fundia "ausente" com "ilegível", e o
 * `pkg === null` virava `na('não é projeto npm')` — que SAI DO DENOMINADOR.
 * Medido no ataque: um repositório 9 de 10 (90%) com o package.json
 * sintaticamente quebrado vira 6 de 6 (100%) — quatro regras (dependabot,
 * ci-gateia, typecheck, formatter) somem da conta e o repositório passa a
 * tirar nota MÁXIMA. Quebrar o arquivo melhorava a nota. É a mesma classe de
 * "crash virava aprovação" que o `git()` já consertou, agora no disco.
 *
 * `rastreado` fecha a segunda porta do mesmo ataque: `rm package.json` sem
 * commitar deixa o arquivo no índice do git e fora do disco. Para quem veio da
 * lista do `git ls-files` o índice é a verdade sobre existir, então ENOENT ali
 * é "existe e não pude ler", não "não existe".
 */
function lerArquivo(dir, rel, rastreado = false) {
  try {
    return { estado: 'ok', texto: readFileSync(join(dir, rel), 'utf8') }
  } catch (e) {
    const some = e.code === 'ENOENT' || e.code === 'ENOTDIR'
    if (some && !rastreado) return { estado: 'ausente' }
    const erro = some ? 'rastreado pelo git e ausente do disco' : e.code || e.message
    return { estado: 'ilegivel', erro }
  }
}

function lerJsonRastreado(dir, rel) {
  const bruto = lerArquivo(dir, rel, true)
  if (bruto.estado !== 'ok') return bruto
  let valor
  try {
    valor = JSON.parse(bruto.texto)
  } catch (e) {
    return { estado: 'ilegivel', erro: `JSON inválido: ${e.message.split('\n')[0]}` }
  }
  // `null`, lista e número são JSON válidos e não são manifesto. Sem esta
  // peneira, um `package.json` com o conteúdo `null` passaria por "li" e
  // `valor.scripts` lançaria lá na regra — exit 127, acusando o rebar-check
  // de um defeito que é do alvo.
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return { estado: 'ilegivel', erro: 'JSON válido mas não é um objeto' }
  }
  return { estado: 'ok', valor }
}

function ler(dir, rel) {
  try {
    return readFileSync(join(dir, rel), 'utf8')
  } catch {
    return null
  }
}

function existe(dir, rel) {
  try {
    return existsSync(join(dir, rel))
  } catch {
    return false
  }
}

const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|astro)$/i
const IGNORAR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|vendor)\//

/**
 * Variáveis que o AMBIENTE fornece, não o projeto. Saem da conta de
 * `env-example` porque `.env.example` documenta o que a pessoa tem de
 * PREENCHER, e ninguém preenche NO_COLOR num arquivo de exemplo.
 *
 * Medido em 2026-08-30 nos 11 repositórios: `NO_COLOR` era a ÚNICA variável do
 * alicerce (que assim virava "lê 1 variável e não tem .env.example") e a ÚNICA
 * cobrada do prumo, que tem .env.example com PRUMO_KEK e DATABASE_URL
 * documentados. Dois de seis acusados eram isto. `CI` inflava openkartline de
 * 4 para 5 — lá a acusação continua de pé porque as outras quatro são reais.
 *
 * A lista é curta de propósito, e cada nome está aqui por ser produzido por
 * quem RODA o programa (terminal, runner de CI, toolchain) e não por quem o
 * configura. Nome de plataforma (GITHUB_*, VERCEL_*) não entrou porque não
 * apareceu em nenhum dos 11 — lista maior que a medição é adivinhação.
 */
const ENV_DO_AMBIENTE = new Set(['CI', 'NO_COLOR', 'FORCE_COLOR', 'NODE_ENV'])

/**
 * Um arquivo é teste se um SEGMENTO do caminho for pasta de teste, ou se o
 * NOME for de teste. Por segmento, não por substring: "aprovar/" contém
 * "provar" e não é pasta de teste.
 *
 * O português entra aqui porque a versão anterior era cega a ele. Medido no
 * alicerce: 43 arquivos rastreados com "prova" no nome, e a regra enxergava
 * ZERO — um checker escrito em português que não reconhece teste nomeado em
 * português. Era um dos dois falsos positivos determinísticos provados.
 *
 * `_test.` e `test_` entram pela MESMA razão, uma língua abaixo: a convenção de
 * Python e de Go escreve `vectra_kw82_test.py`, e o padrão anterior só conhecia
 * o ponto (`.test.`). Medido em 2026-08-30 nos 12 repositórios: o VectraB-Lab
 * era acusado de "zero arquivo de teste" tendo TRÊS scripts `*_test.py`
 * rastreados. Reconhecer a convenção acrescenta exatamente 3 arquivos em 12
 * repositórios e ZERO arquivo de código avaliável — nenhuma regra de conteúdo
 * perde texto por causa disto, e a conta está no relatório.
 *
 * O prefixo solto (`TESTE-1-cabo-KKL.md`) fica de fora de propósito: separador
 * `-` sem ponto é nome de documento, e aceitá-lo transformaria um `.md` de
 * anotação em prova de que o repositório testa.
 */
const PASTA_TESTE = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'teste',
  'testes',
  'prova',
  'provas',
])
const NOME_TESTE = /(\.|^|_)(test|spec|teste|prova)\.|^(provar|testar)[-.]|^test_/i

function ehTeste(rel) {
  const partes = rel.split('/')
  if (partes.slice(0, -1).some((p) => PASTA_TESTE.has(p.toLowerCase()))) return true
  return NOME_TESTE.test(partes[partes.length - 1])
}

/**
 * Código de produção rastreado — o crivo que `fontes()` aplica ANTES de tirar
 * teste. Extraído para que a CONTAGEM do que sai por ser teste use exatamente
 * o mesmo crivo da exclusão: contagem calculada por um crivo parecido, mas
 * outro, é pior que contagem nenhuma, porque parece conferir.
 */
const ehCodigoAvaliavel = (a) => CODIGO.test(a) && !IGNORAR.test(a)

/**
 * Onde um `caso.json` tem significado de marcador. Fora daqui é arquivo comum.
 *
 * O comentário que estava neste arquivo afirmava que o marcador "não serve de
 * bypass genérico". A auditoria provou o contrário com três bytes:
 *
 *     echo "{}" > dominios/caso.json && git add dominios/caso.json
 *
 * A árvore inteira de `dominios/` saiu da avaliação. Nenhuma validação de
 * conteúdo — `{}` bastava — e o único sinal foi a contagem de fixtures subir
 * de 63 para 70, em cinza-fraco e SEM símbolo de aviso.
 *
 * Prefixo literal, e não "qualquer pasta terminada em provas/casos/": o
 * marcador vale no lugar onde as provas DESTE repositório moram e em nenhum
 * outro. Reconhecer o caminho por forma devolveria o bypass genérico com um
 * `mkdir -p` a mais.
 */
const CASOS_PROVAS = 'ferramental/rebar-check/provas/casos/'

/**
 * MODELO NÃO É PRODUTO — é a mesma lição do `caso.json`, um andar acima, e ela
 * voltou no minuto em que o gerador entrou no repositório.
 *
 * `novo/site/blocos/` e `novo/portao/arquivos/` são ARQUIVOS QUE VÃO SER
 * COPIADOS para outro repositório. Rastreados aqui dentro, o rebar passou a se
 * medir por eles. Medido em 2026-08-31, com o `novo/` commitado num espelho do
 * repositório em os.tmpdir() (22 arquivos):
 *
 *   typecheck    – não tem TypeScript   →  ✗ nenhum package.json rastreado tem
 *                                            script typecheck, …
 *   nota         11 de 11               →  11 de 13
 *
 * Os cinco `.tsx`/`.ts` de `novo/site/blocos/app/` e `conteudo/` fizeram o
 * rebar parecer um projeto TypeScript sem compilador. Não é: o rebar não tem
 * uma linha de TypeScript própria, e esses cinco arquivos só são compilados
 * DEPOIS de copiados, pelo `tsc` do projeto gerado.
 *
 * E aí está o argumento que autoriza a exclusão sem afrouxar nada: o modelo
 * continua sendo checado, só que ONDE ELE CAI. O passo 5 do gerador roda esta
 * mesma régua no projeto recém-criado, com o modelo já no lugar, com o
 * `tsconfig.json` e o `package.json` do Next em volta. Medir o modelo no lugar
 * errado não é rigor a mais, é uma medição de outra coisa.
 *
 * A fechadura é dupla e as duas metades são obrigatórias:
 *   1. o prefixo tem de ser EXATAMENTE uma das raízes literais abaixo — não
 *      "começa com", não "qualquer pasta chamada blocos". Sem isto o marcador
 *      viraria o bypass genérico que o `caso.json` já tentou ser;
 *   2. tem de existir o `modelo.json` com `para` e `porque`, rastreado e
 *      legível. Marcador recusado vira AVISO nomeando o arquivo.
 * E a contagem sai impressa no placar, sempre, como a das provas.
 */
const RAIZES_DE_MODELO = ['novo/portao/arquivos/', 'novo/site/blocos/']

/**
 * Schema mínimo do marcador: para o `caso.json`, `regra` e `porque`, os dois
 * campos que o provar.mjs exige de todo caso; para o `modelo.json`, `para` e
 * `porque`. Um marcador sem eles não é marcador, é um arquivo com o nome certo
 * — e esconder árvore era exatamente o que se conseguia com um arquivo com o
 * nome certo.
 */
function marcadorInvalido(dir, rel, campos = ['regra', 'porque']) {
  const lido = lerJsonRastreado(dir, rel)
  if (lido.estado !== 'ok') return lido.erro
  const falta = campos.filter((k) => typeof lido.valor[k] !== 'string' || !lido.valor[k].trim())
  return falta.length ? `sem ${falta.join(' nem ')}` : null
}

/**
 * Tira da avaliação as árvores que são MATERIAL DE PROVA, não produto.
 *
 * Isto nasceu de uma falha real, e ela apareceu no minuto em que as provas
 * foram escritas: os casos de `ui-falso` e `schema-orfao` são, por construção,
 * repositórios defeituosos em miniatura. Rastreados dentro do rebar, eles
 * fizeram o rebar reprovar em `ui-falso`, `schema-orfao` e `typecheck` —
 * acusado pelas próprias provas. Uma ferramenta que não sabe distinguir o
 * produto do material de prova mede o material de prova.
 *
 * Duas portas de saída, as duas VISÍVEIS na saída, e as duas com fechadura:
 *
 *   caso.json     marca a raiz de um caso de prova. Só vale sob CASOS_PROVAS e
 *                 só com o schema mínimo — ver a nota lá em cima, que registra
 *                 o ataque de três bytes que a versão anterior aceitava.
 *                 Marcador recusado vira AVISO, nomeando o arquivo.
 *   .rebarignore  prefixos de caminho, um por linha, `#` comenta. Existe para
 *                 vendor e material gerado. É bypass de verdade — por isso a
 *                 contagem do que ele escondeu vai impressa no placar, e por
 *                 isso ele tem de estar RASTREADO. Portão aberto tem de ser
 *                 fato checado, não omissão.
 */
/**
 * Modo de cada arquivo no ÍNDICE do git, não no disco.
 *
 * A distinção decide a regra `hooks-executaveis`: o `chmod` que um instalador
 * faz é local e não viaja no clone; o que viaja é o modo commitado. Num clone
 * Linux, hook com modo 100644 é ignorado pelo git EM SILÊNCIO — o instalador
 * imprime "hooks instalados" e nada roda.
 */
function modosDoIndice(dir) {
  const r = git(dir, ['ls-files', '--stage'])
  if (!r.ok || !r.saida) return new Map()
  const mapa = new Map()
  for (const linha of r.saida.split('\n')) {
    // "<modo> <sha> <estagio>\t<caminho>"
    const tab = linha.indexOf('\t')
    if (tab === -1) continue
    mapa.set(linha.slice(tab + 1), linha.slice(0, linha.indexOf(' ')))
  }
  return mapa
}

function semFixtures(dir, todos) {
  const raizes = []
  const marcadoresRecusados = []
  for (const a of todos.filter((x) => basename(x) === 'caso.json')) {
    const prefixo = a.slice(0, -'caso.json'.length)
    // Raiz vazia é o pior caso do ataque: um `caso.json` na RAIZ do repositório
    // produz prefixo '' e `''.startsWith` casa com TUDO — o repositório inteiro
    // desapareceria da avaliação com um arquivo de três bytes.
    if (!prefixo) {
      marcadoresRecusados.push(`${a} — na raiz do repositório, esconderia o repositório inteiro`)
      continue
    }
    // `prefixo === CASOS_PROVAS` é a mesma armadilha um nível abaixo: um
    // marcador posto na pasta que CONTÉM os casos apagaria todos de uma vez.
    if (!prefixo.startsWith(CASOS_PROVAS) || prefixo === CASOS_PROVAS) {
      marcadoresRecusados.push(`${a} — fora de ${CASOS_PROVAS}<caso>/`)
      continue
    }
    const invalido = marcadorInvalido(dir, a)
    if (invalido) {
      marcadoresRecusados.push(`${a} — ${invalido}`)
      continue
    }
    raizes.push(prefixo)
  }

  // A árvore de MODELOS do gerador — ver RAIZES_DE_MODELO. Fechadura dupla:
  // prefixo idêntico a uma raiz literal E marcador com schema.
  const raizesDeModelo = []
  const modelosRecusados = []
  for (const a of todos.filter((x) => basename(x) === 'modelo.json')) {
    // Marcador DENTRO de um caso de prova não é marcador deste repositório: é o
    // conteúdo do caso, e o caso inteiro já saiu da avaliação um laço acima.
    // Sem esta linha, os três `modelo.json` dos casos `typecheck__modelo-*`
    // saíam como "3 modelo.json IGNORADO(S)" no placar do próprio rebar —
    // aviso verdadeiro sobre um arquivo que ninguém ia ler como bypass.
    if (raizes.some((p) => a.startsWith(p))) continue
    const prefixo = a.slice(0, -'modelo.json'.length)
    if (!RAIZES_DE_MODELO.includes(prefixo)) {
      modelosRecusados.push(`${a} — não é uma das raízes de modelo`)
      continue
    }
    const invalido = marcadorInvalido(dir, a, ['para', 'porque'])
    if (invalido) {
      modelosRecusados.push(`${a} — ${invalido}`)
      continue
    }
    raizesDeModelo.push(prefixo)
  }

  // Lido do GIT, não do disco. Um `.rebarignore` não rastreado — inclusive um
  // escondido atrás de `.git/info/exclude` — cegava o checker sem existir para
  // o git: não entra em diff, não entra em review, não aparece no `git status`.
  // Bypass que não está sob revisão é porta dos fundos, então aqui ele é
  // ignorado por inteiro e o fato vira aviso.
  const ignoreRastreado = todos.includes('.rebarignore')
  const ignoreNoDisco = ler(dir, '.rebarignore')
  const ignoreClandestino = ignoreNoDisco !== null && !ignoreRastreado
  const prefixos = (ignoreRastreado ? ignoreNoDisco || '' : '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.endsWith('/') ? l : l + '/'))

  const arquivos = []
  let provas = 0,
    modelos = 0,
    ignorados = 0
  for (const a of todos) {
    if (raizes.some((p) => a.startsWith(p))) {
      provas++
      continue
    }
    if (raizesDeModelo.some((p) => a.startsWith(p))) {
      modelos++
      continue
    }
    if (prefixos.some((p) => a.startsWith(p))) {
      ignorados++
      continue
    }
    arquivos.push(a)
  }
  return {
    arquivos,
    ignorados: {
      provas,
      raizesDeProva: raizes,
      marcadoresRecusados,
      modelos,
      raizesDeModelo,
      modelosRecusados,
      rebarignore: ignorados,
      rebarignoreClandestino: ignoreClandestino,
    },
  }
}

/**
 * Conteúdo dos arquivos de código rastreados, com teto de tamanho, separado nas
 * duas pilhas que as regras de fato querem: `producao` e `teste`.
 *
 * A separação sai daqui, e não de um segundo laço, porque a peneira tem de ser
 * a MESMA nas duas pontas — o arquivo lá em cima já registra que contagem
 * calculada por um crivo parecido, mas outro, é pior que contagem nenhuma.
 *
 * `teste` existe porque quase toda regra de conteúdo quer olhar só produção, e
 * UMA não quer: `schema-orfao` pergunta se alguém LÊ o schema, e um teste de
 * contrato que o importa é a prova mais forte possível de que alguém lê.
 * Medido: `openkartline` era acusado de dois schemas "definidos e nunca lidos"
 * com `apps/web/src/services/schemaContract.test.ts` importando os dois.
 */
function fontes(dir, arquivos) {
  const producao = []
  const teste = []
  for (const a of arquivos) {
    if (!ehCodigoAvaliavel(a)) continue
    try {
      if (statSync(join(dir, a)).size > 512 * 1024) continue
      ;(ehTeste(a) ? teste : producao).push([a, readFileSync(join(dir, a), 'utf8')])
    } catch {
      /* arquivo sumiu entre o ls-files e a leitura */
    }
  }
  return { producao, teste }
}

// ─────────────────────────────── defesa procurada onde o defeito foi achado
//
// Classe inteira de falso positivo consertada aqui: DEFEITO PROCURADO
// RECURSIVAMENTE, DEFESA PROCURADA SÓ NA RAIZ. `ui-falso` varria
// `components/ui/` em qualquer profundidade e conferia `components.json` só em
// `r.dir`; `formatter`, `typecheck` e `shadcn-completo` liam só o package.json
// da raiz. Cinco dos doze repositórios medidos são monorepo, e a acusação caía
// em cima justamente deles. Medido: prumo, ducado e LinhaK acusados de
// "components/ui/ sem components.json" tendo os três o arquivo rastreado
// (apps/web/, apps/web/, web/); openkartline acusado de "sem prettier" com
// prettier declarado em apps/web/package.json. Cinco achados, cinco falsos.

const RE_MANIFESTO = /(^|\/)package\.json$/
const RE_COMPONENTS_JSON = /(^|\/)components\.json$/
// Prefixo do diretório de um arquivo, no formato do git: '' na raiz,
// 'apps/web/' com barra no fim. O git SEMPRE devolve barra normal, inclusive no
// Windows; `join`/`sep` aqui produziriam 'apps\web\' e nada casaria com nada.
const pastaDe = (rel) => rel.slice(0, rel.lastIndexOf('/') + 1)

/**
 * Todo package.json RASTREADO, lido, com o estado da leitura preservado.
 * `arquivos` já veio filtrado por `semFixtures`, então os manifestos dos casos
 * de prova do próprio rebar ficam de fora — como têm de ficar.
 */
function manifestosNpm(dir, arquivos) {
  return arquivos
    .filter((a) => RE_MANIFESTO.test(a) && !IGNORAR.test(a))
    .map((rel) => ({ rel, ...lerJsonRastreado(dir, rel) }))
}

/**
 * Porta única das regras que dependem de manifesto: devolve string de
 * REPROVAÇÃO quando existe package.json rastreado que não pôde ser lido, e
 * null quando dá para seguir. Reprovação e não `na()`, porque N/A sai do
 * denominador e era exatamente por aí que o ataque entrava; reprovação e não
 * exceção, porque um package.json quebrado é defeito do ALVO, e o 127 está
 * reservado para defeito do rebar-check.
 */
function manifestoIlegivel(r, sePresta = () => true) {
  const maus = r.manifestos.filter((m) => m.estado !== 'ok' && sePresta(m))
  if (!maus.length) return null
  const lista = maus.slice(0, 3).map((m) => `${m.rel} (${m.erro})`)
  return `package.json ilegível, impossível avaliar: ${lista.join('; ')}`
}

/**
 * A guarda restrita ao manifesto da RAIZ, para as regras cuja aplicabilidade é
 * do repositório e não do pacote. Precisa ser restrita: com a guarda ampla,
 * um pacote ilegível em `web/` faria `dependabot` REPROVAR um repositório que
 * nem tem package.json na raiz — trocaria um falso negativo por um falso
 * positivo, que é a troca que este passo inteiro existe para não fazer.
 */
const raizIlegivel = (r) => manifestoIlegivel(r, (m) => m.rel === 'package.json')

/**
 * União de dependencies + devDependencies de TODOS os manifestos.
 *
 * Aqui a união crua é o casamento certo, e em `ui-falso` não é — a diferença é
 * o que cada defesa defende. Formatador e primitiva de UI são resolvidos pelo
 * gerenciador de pacotes do WORKSPACE INTEIRO (npm/pnpm/yarn içam para a raiz),
 * então declarar prettier num pacote formata o repositório todo. Já um
 * `components.json` configura os aliases de UM projeto e não alcança o pacote
 * vizinho.
 */
function dependenciasDeTodos(r) {
  const d = {}
  for (const m of r.manifestos) {
    if (m.estado !== 'ok') continue
    Object.assign(d, m.valor.dependencies, m.valor.devDependencies)
  }
  return d
}

/** Nomes de script declarados em qualquer manifesto do repositório. */
function scriptsDeTodos(r) {
  const nomes = new Set()
  for (const m of r.manifestos) {
    if (m.estado !== 'ok') continue
    const s = m.valor.scripts
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue
    for (const n of Object.keys(s)) nomes.add(n)
  }
  return nomes
}

/**
 * A pasta e todos os diretórios acima dela, até a raiz: 'apps/web/src/' vira
 * ['apps/web/src/', 'apps/web/', 'apps/', ''].
 *
 * É a regra de casamento por PROXIMIDADE de `ui-falso`. Subir é o único
 * caminho que reproduz como a ferramenta real resolve: o `components.json`
 * mora na raiz do PROJETO e os aliases dele apontam para baixo. Por isso
 * `apps/web/components.json` defende `apps/web/src/components/ui/` (está
 * acima) e NÃO defende `packages/outro/components/ui/` (é irmão, não
 * ancestral) — que era o risco de trocar "só na raiz" por "existe em qualquer
 * lugar", uma troca de falso positivo por falso negativo.
 *
 * A subida vai até a raiz de propósito, sem parar na fronteira do pacote: um
 * `components.json` na raiz de monorepo de app único é configuração legítima
 * do app aninhado, e o arquivo não diz para quem ele aponta. Entre acusar
 * quem não deve e calar sobre quem deve, uma regra determinística escolhe
 * calar — é a mesma conta que rebaixou a regra de cor literal a heurística.
 */
function ancestrais(pasta) {
  const saida = [pasta]
  let p = pasta
  while (p) {
    p = p.slice(0, p.lastIndexOf('/', p.length - 2) + 1)
    saida.push(p)
  }
  return saida
}

/**
 * Um runner chamado por um script: `node ci/verificar.mjs`, `tsx scripts/x.ts`.
 * Só o caminho, sem `..` — o alvo tem de ser um arquivo DO repositório, e a
 * conferência final é a lista do `git ls-files`, não este padrão.
 */
const RE_RUNNER =
  /(?:^|[\s;&|])(?:node|tsx|ts-node|bun)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./-]+\.[cm]?[jt]s)\b/g

/**
 * Expande o que o CI de fato executa. Um workflow que roda `npm run verificar`
 * está rodando o corpo de `verificar` — e, se aquele corpo chamar outro script,
 * está rodando aquele também.
 *
 * Sem isto, `ci-gateia` procurava as palavras lint/typecheck/test literais no
 * YAML e reprovava todo repositório que agrega a verificação num comando só.
 * Era o segundo falso positivo determinístico provado.
 *
 * A segunda perna — seguir `node <arquivo>` para DENTRO do arquivo — fecha o
 * mesmo furo um degrau adiante, e ele foi medido: o `ducado` era acusado de "o
 * CI não alcança: lint" com `.github/workflows/verificar.yml` rodando
 * `npm run verificar`, o script `verificar` sendo `node ci/verificar.mjs`, e
 * aquele arquivo rodando `npm run --silent lint` na linha 21. A cadeia real
 * tem três elos e a expansão só percorria dois; parar no `node` era declarar
 * que o CI não alcança o lint que ele alcança em toda execução.
 *
 * A expansão só ACRESCENTA texto, então só pode transformar reprovação em
 * aprovação — nunca inventar acusação. O teto é `profundidade` e cada nome e
 * cada arquivo entram uma vez só, senão um script que chama a si mesmo faria
 * o laço crescer para sempre.
 */
function textoEfetivoDoCi(yml, scripts, r, profundidade = 3) {
  let texto = yml
  const vistos = new Set()
  const lidos = new Set()
  for (let i = 0; i < profundidade; i++) {
    let cresceu = false
    for (const [nome, corpo] of Object.entries(scripts)) {
      if (vistos.has(nome)) continue
      // `npm run x`, `pnpm x`, `yarn x`, `run-s x`, `run-p x`
      const invocado = new RegExp(
        `(?:npm\\s+run|pnpm\\s+(?:run\\s+)?|yarn\\s+(?:run\\s+)?|run-[sp])\\s+${nome}\\b`,
      )
      if (invocado.test(texto)) {
        texto += '\n' + semComentario(corpo)
        vistos.add(nome)
        cresceu = true
      }
    }
    for (const m of [...texto.matchAll(RE_RUNNER)]) {
      // Normalizado para barra normal e sem `./`: o git devolve
      // `ci/verificar.mjs` e o YAML pode escrever `./ci/verificar.mjs`.
      const rel = m[1].replace(/\\/g, '/').replace(/^\.\//, '')
      if (lidos.has(rel) || !r.arquivos.includes(rel)) continue
      lidos.add(rel)
      const corpo = ler(r.dir, rel)
      if (corpo === null) continue
      texto += '\n' + semComentario(corpo)
      cresceu = true
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

/**
 * Bot commita, e commitar não faz dele uma identidade inconsistente do dono.
 *
 * Sem esta lista, o merge commit que o GitHub cria em `refs/pull/N/merge` —
 * autorado por `GitHub <noreply@github.com>` — conta como segunda pessoa E como
 * "e-mail pessoal exposto", dois falsos positivos de uma vez. Medido: com isso
 * TODO pull request nascia reprovado, o que tornava fisicamente impossível
 * ligar o rebar como check obrigatório de merge em qualquer repositório.
 */
const EH_BOT =
  /<[^>]*(noreply@github\.com|\[bot\]@|@bots\.|dependabot|renovate|github-actions)[^>]*>|\[bot\]\s*</i

// ─────────────────────────────────── coautoria: allowlist de humanos

/**
 * Onde mora a allowlist de coautores humanos, na raiz do repositório AUDITADO.
 *
 * Caminho único e sem pasta a criar porque o rebar-check roda contra
 * repositório de terceiro: `ferramental/` é layout do rebar, `.rebar-coautores`
 * é convenção que qualquer repositório consegue adotar com um arquivo — mesma
 * família do `.rebarignore`.
 */
const ALLOWLIST_COAUTORES = '.rebar-coautores'

/**
 * A lista de agentes de IA, usada SÓ quando o repositório auditado não tem
 * allowlist. Está aqui documentada como o que é: uma corrida perdida.
 *
 * A versão anterior tinha 9 nomes. O ataque de 2026-08-30 montou um repositório
 * em tmpdir e passou seis agentes atuais de uma vez — Windsurf, ChatGPT, Cody,
 * Codeium, Amazon Q, Tabnine —, todos com trailer que o
 * `git log --format=%(trailers:key=Co-authored-by)` reconheceu, e a regra acusou
 * "1 de 9 commits" num histórico onde 8 commits tinham trailer de coautoria.
 * Esta lista tem quatro vezes mais nomes e vai envelhecer do mesmo jeito; é por
 * isso que ela é o PLANO B, e não a política.
 *
 * Nome de agente que também é nome de gente (Cody, Jules) entra pelo domínio, e
 * não solto: acusar `Cody Silva <cody@empresa.com>` de ser IA seria transformar
 * a lista perdida numa lista perdida E injusta.
 */
const AGENTES_ENUMERADOS =
  /(claude|anthropic|cursor\.(com|sh)|cursoragent|copilot|codex|openai|chatgpt|devin|cognition|aider|gemini|google-labs-jules|jules@google|windsurf|codeium|sourcegraph|tabnine|amazon\s*q|amazonaws|codewhisperer|q-developer|replit|bolt\.new|v0\.dev|lovable|cline|roo-?code|kilo-?code|continue\.dev|sweep(ai|\.dev)|qodo|codium|coderabbit|greptile|ellipsis\.dev|korbit|bito\.ai|blackbox|phind|supermaven|augmentcode|zencoder|refact\.ai|sourcery|openhands|opendevin|all-hands|swe-agent|gpt-engineer|mentat|trae\.ai|marscode|comate)/i

/**
 * Automação que NÃO escreve código a partir de um enunciado: bumpador de
 * dependência, formatador de imagem, robô de release. Sai do bolo ANTES de
 * classificar, porque coautoria de robô de manutenção não é coautoria de IA.
 *
 * Isto existe porque a lista acima terminava num `\[bot\]` solto, e aquele
 * curinga afirmava uma coisa falsa: que todo App do GitHub que assina um
 * trailer é agente de IA. Medido em 2026-08-30: o `ducado` era acusado de "1 de
 * 25 commits com coautoria de IA" e o ÚNICO trailer do histórico inteiro é
 * `dependabot[bot]`. No `openkartline` o curinga inflava a acusação de 2 para
 * 6 — 4 dos 6 eram dependabot e só 2 eram Claude, então o número impresso era
 * o triplo do verdadeiro.
 *
 * É o mesmo julgamento que `EH_BOT` já faz uma regra abaixo, com a mesma frase:
 * bot commita, e commitar não faz dele autor de IA. E é o oposto do que o
 * curinga fazia — enumerar quem NÃO é IA aqui é seguro porque errar para menos
 * cai no ramo N/A ("não dá para classificar"), e não numa aprovação silenciosa.
 */
const AUTOMACAO_NAO_IA =
  /(dependabot|renovate|greenkeeper|snyk-bot|imgbot|allcontributors|pre-commit-ci|mergify|semantic-release|release-please|github-actions)/i

const emailDeCoautor = (valor) => {
  const m = /<([^<>]*)>/.exec(valor)
  const bruto = (m ? m[1] : valor).trim().toLowerCase()
  return bruto.includes('@') ? bruto : null
}

/**
 * A allowlist tem de estar RASTREADA, não só existir no disco.
 *
 * É a mesma porta que o `.rebarignore` clandestino já teve, e aqui seria pior:
 * um arquivo de dois bytes largado no disco desligaria a regra inteira do
 * repositório auditado sem aparecer em diff nenhum. `r.arquivos` vem do
 * `git ls-files`, então quem não está lá não existe para esta regra.
 */
function lerAllowlistCoautores(r) {
  if (!r.arquivos.includes(ALLOWLIST_COAUTORES)) return { estado: 'ausente' }
  const bruto = lerArquivo(r.dir, ALLOWLIST_COAUTORES, true)
  if (bruto.estado !== 'ok') return { estado: 'ilegivel', erro: bruto.erro }
  const emails = new Set()
  for (const linha of bruto.texto.split(/\r?\n/)) {
    const l = linha.trim()
    if (!l || l.startsWith('#')) continue
    const e = emailDeCoautor(l)
    if (e) emails.add(e)
  }
  return { estado: 'ok', emails }
}

/**
 * Os trailers de coautoria do histórico, perguntados AO GIT.
 *
 * `%(trailers:key=Co-authored-by)` é o mesmo parser que decide o que é trailer
 * de verdade — resolve dobramento de linha e não confunde uma linha solta no
 * meio do corpo com um trailer. Ler `%B` e passar regex era reimplementar isso
 * à mão, e à mão o `Co-authored-by:` contrabandeado abaixo da linha de tesoura
 * do `git commit -v` já entrou uma vez.
 *
 * O plano B existe para git anterior ao 2.22, que não conhece o placeholder e o
 * devolve literal. Quando ele roda, o motivo impresso diz que rodou: veredito
 * lido por instrumento pior tem de aparecer como tal.
 */
function coautoresDoHistorico(r) {
  const SEP_COMMIT = '\x00'
  const SEP_TRAILER = '\x1e'
  const log = git(r.dir, [
    'log',
    '--format=%(trailers:key=Co-authored-by,valueonly=true,separator=%x1e)%x00',
  ])
  const suportado = log.ok && !log.saida.includes('%(trailers')
  const coautores = []

  if (suportado) {
    const registros = log.saida.split(SEP_COMMIT)
    // O último pedaço depois do %x00 final é resto vazio, não commit.
    for (const reg of registros.slice(0, -1)) {
      for (const v of reg.split(SEP_TRAILER)) {
        const valor = v.trim()
        if (valor) coautores.push({ valor, email: emailDeCoautor(valor) })
      }
    }
    return { coautores, total: r.commits.length, porEnumeracaoDoTexto: null }
  }

  for (const m of r.commits.join('\n').matchAll(/^co-authored-by:[ \t]*(.+)$/gim)) {
    const valor = m[1].trim()
    if (valor) coautores.push({ valor, email: emailDeCoautor(valor) })
  }
  return {
    coautores,
    total: r.commits.length,
    porEnumeracaoDoTexto: log.ok ? 'git sem %(trailers)' : log.erro || 'git log falhou',
  }
}

/**
 * O que conta como "existe uma checagem de tipo que dá para chamar sozinha".
 *
 * Exigir o nome literal `typecheck` cobrava do repositório o VOCABULÁRIO, não
 * a prática — o mesmo erro que a regra `testes` cometia com nome de arquivo em
 * português. Medido: prumo (`"tipos": "tsc -b"`) e ducado (`"tipos"` na raiz e
 * `"typecheck"` em três pacotes) eram acusados de não ter typecheck tendo os
 * dois o script.
 *
 * A lista é de NOMES de script, e isso é deliberado: o que a regra quer é um
 * alvo que o CI consiga invocar. `navesz.github.io` tem `tsc --noEmit` DENTRO
 * do `build` e continua reprovando — corretamente, porque é exatamente a falha
 * que a prova desta regra descreve, "o único contato com o compilador é o
 * build".
 */
const NOMES_TYPECHECK = ['typecheck', 'type-check', 'check-types', 'tipos', 'tsc']

// ───────────────────────────────── o que é, e o que NÃO é, literal de conteúdo
//
// A §12.3 do plano fechou que o conteúdo do preset `site` mora em
// `conteudo/*.json` e que identidade do negócio — telefone, preço, endereço —
// é conteúdo validado, não código. A regra `conteudo-fora-do-codigo` cobra isso.
//
// A parte difícil não é a asserção, é a DEFINIÇÃO. String de `className`, de
// `import`, de `aria-label` e de chave de objeto não são conteúdo, e a versão
// larga desta regra acusaria todas. Por isso ela reconhece só DUAS formas, as
// duas escolhidas por serem impossíveis de confundir com as quatro de cima:
//
//   1. PREÇO — `R$` seguido de dígito. Não existe em nome de classe, em
//      caminho de import, em chave de objeto nem em rótulo de acessibilidade.
//      Repare que a exigência é o DÍGITO: `` `R$ ${valor}` `` não casa, e é o
//      certo — formatador de moeda é código, valor de moeda é conteúdo.
//
//   2. FRASE RENDERIZADA — texto entre `>` e `<`, isto é, nó de texto de JSX.
//      Por construção do JSX, className/import/aria-label/chave vivem em
//      ATRIBUTO ou fora da marcação, e nó de texto é o que o visitante lê.
//
// Quanto isso pega: medido em 2026-08-30 nos 11 repositórios, IGNORANDO o
// portão de aplicabilidade, a definição acha 188 ocorrências em 45 arquivos de 7
// repositórios — 147 só no decima-edicoes, em 15 dos 25 arquivos dele, depois
// ducado 13, hug-brasil-propostas 12, vectra-painel 9, Galegos 3, prumo 3 e
// LinhaK 1. Nenhum dos 188 é falso; abri a lista e são todos conteúdo mesmo,
// sem uma única string de className, de import, de aria-label ou de chave. O
// que a tabela prova é outra coisa — que TODO site escrito à mão viola esta
// asserção, e portanto a asserção não pode ser cobrada de quem não prometeu
// cumpri-la.
//
// Vale registrar a inversão que a mesma tabela mostrou, porque ela é um limite
// da definição e não um elogio a ela: o Galegos, que a §12.3 cita como o pior
// caso com as 623 linhas de `menu.ts`, dá 3 — e o que o pega lá é o PREÇO
// (`src/lib/menu.ts` linha 590), não a frase. Catálogo em objeto literal de
// `.ts` continua invisível, e continua de propósito: o padrão que o pegasse
// pegaria junto toda tabela de constantes de todo projeto.
//
// É daí que sai o portão: a regra só se aplica ao repositório que ADOTOU a
// convenção, ou seja, que tem `conteudo/*.json` rastreado. Mesma forma do
// `notice` (só cobra NOTICE de quem escolheu Apache) e do `ui-falso` (só cobra
// components.json de quem criou components/ui/). Com o portão, os 11
// repositórios medidos dão N/A com o motivo impresso, e a saída do gerador —
// que nasce com `conteudo/` — é cobrada por inteiro.

const RE_CONTEUDO_JSON = /^((?:.*\/)?)conteudo\/[^/]+\.json$/
export const PRECO_BRL = /R\$\s?\d[\d.,]*/
export const RE_JSX = /\.(tsx|jsx)$/i

/**
 * Tira comentário. O `[^:]` antes do `//` é o que impede de comer o `//` de
 * `https://` e cortar o resto da linha junto.
 *
 * Existe fora da regra de conteúdo porque duas regras dependem dele pelo mesmo
 * motivo, e o motivo está registrado neste arquivo desde a primeira medição:
 * das SETE ocorrências que a regra de cor literal deu no herz, CINCO eram
 * comentários documentando a própria regra. Comentário que aciona a regra que
 * ele explica é a forma mais barata de queimar a ferramenta — e ela quase
 * aconteceu de novo aqui: escrever o número do Galegos por extenso na nota do
 * `telefone` fez o rebar acusar o próprio index.mjs, e escrever
 * `process` `.env.X` na nota do `url-producao` fez o `env-example` cobrar
 * `.env.example` para uma variável que não existe.
 */
function semComentario(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Sem comentário e sem linha de import: nenhum dos dois é renderizado. */
export function semComentarioNemImport(t) {
  return semComentario(t).replace(/^\s*import[^\n]*$/gm, ' ')
}

/**
 * ── O DISCRIMINADOR: quem é o DONO do nó de texto ────────────────────────────
 *
 * A pergunta que separa CONTEÚDO de VOCABULÁRIO DE INTERFACE não é de tamanho.
 * Medido nos 11 repositórios: "Imprimir ou salvar em PDF" tem 5 palavras e 24
 * caracteres, "Nossa cozinha abre às 18h" tem 5 e 25 — nenhum limiar de
 * comprimento passa entre os dois. O que passa é a SEMÂNTICA DO ELEMENTO que
 * carrega o texto: aquele "Imprimir ou salvar em PDF" mora dentro de um
 * `<button>` (`decima-edicoes/app/components/print-button.tsx:8`), e `<button>`
 * não é elemento de prosa — é controle, e o texto de um controle é o NOME DELE.
 *
 * Daí a regra só afirmar sobre nó de texto cujo DONO é elemento de prosa
 * (`PROSA` abaixo). Três consequências medidas, todas contra os 11:
 *
 *   · rótulo de ação sai por construção — `<button>`, `<a>` e `<label>` não
 *     estão em `PROSA`, e não é preciso enumerar verbo nenhum para isso;
 *   · a exclusão é pelo DONO, não pelo ancestral. Procurar `<a>` na cadeia
 *     removeria ZERO acusações nesta amostra e removeria conteúdo real assim
 *     que aparecesse um cartão-link (`<a><h3>título</h3></a>`), onde o título é
 *     conteúdo e o `<a>` é só a área clicável;
 *   · o portão custa 38 acusações das 300 e nenhuma delas é conteúdo: são
 *     `<div>`, `<span>` e componente de terceiro, onde o checker NÃO SABE o que
 *     o elemento significa. Mesma disciplina do `na()`: o que não dá para
 *     decidir sai, e sai calado.
 *
 * ── O CASAMENTO: corrida de texto, não pedaço entre dois `<` ─────────────────
 *
 * O casamento anterior cortava no primeiro `<`, então frase atravessada por um
 * `<strong>` virava dois ou três achados. Medido: 17 das 185 frases começavam
 * com ponto, com travessão ou no meio da oração — eram FRAGMENTO, não literal.
 * E o estrago era maior que o cosmético: a frase que se parte em pedaços de
 * menos de 4 palavras SOME. `nosDeTexto()` monta a corrida atravessando os
 * elementos inline e a fecha em fronteira de bloco. Fragmento medido depois
 * disso: ZERO de 258.
 *
 * O `{…}` em posição de filho vira BARREIRA: o texto solto dele é código e
 * some, o JSX aberto lá dentro continua sendo lido, e no lugar dele fica um
 * marcador. É o que faz `<p>Faltam {n} dias para o milhão</p>` ser enxergado —
 * o casamento antigo descartava a frase inteira por causa da chave.
 *
 * ── AS DUAS GUARDAS QUE MORRERAM, com o número que as matou ─────────────────
 *
 * São exatamente duas das mutações que a auditoria viu sobreviver, e elas
 * sobreviveram porque as constantes não tinham serviço:
 *
 *   MÍNIMO DE 25 CARACTERES — morto. Medido: custava 13 acusações VERDADEIRAS
 *     ("Este carro fala KW82.", "Esta edição não existe.", "Suas chaves de
 *     API") e não comprava nenhuma. Quem faz esse serviço é o mínimo de
 *     PALAVRAS, e esse tem número: baixado de 4 para 1 a definição salta de
 *     262 para 481 achados, e os 219 a mais são rótulo de campo ("Forma de
 *     pagamento", "Informe a rua"), nome de seção ("Cardápio") e nó feito só
 *     de interpolação.
 *   SINAL_DE_CODIGO como CLASSE DE CARACTERES — morto na forma antiga. Ele
 *     existia para matar o que atravessava o `>` de uma seta ou de uma
 *     comparação; com a corrida montada por `nosDeTexto()`, expressão é
 *     barreira e isso não chega mais aqui. O que sobrava dele era dano: 51
 *     acusações VERDADEIRAS caíam só porque a prosa tinha um `;` ou um `:`
 *     ("Madeira real continua se movendo. Plano, umidade e integridade
 *     precisam ser medidos no recebimento…"). O nome fica e o corpo muda: o
 *     sinal de que não é prosa passou a ser a PROPORÇÃO de letras.
 */
const PROSA = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'dd',
  'dt',
  'blockquote',
  'figcaption',
  'caption',
  'td',
  'th',
  'legend',
  'article',
  'address',
])

/** Elementos inline: a corrida de texto os atravessa, eles não a interrompem. */
const INLINE = new Set([
  'strong',
  'b',
  'em',
  'i',
  'span',
  'code',
  'small',
  'mark',
  'u',
  's',
  'sub',
  'sup',
  'abbr',
  'time',
  'kbd',
  'var',
  'cite',
  'q',
  'dfn',
  'bdi',
  'bdo',
  'wbr',
  'br',
])

/** Elementos sem filho: `<br/>` vira espaço, o resto é fronteira de bloco. */
const VAZIO = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'track',
  'area',
  'col',
  'embed',
  'param',
])

/**
 * Nomes de elemento HTML que o leitor reconhece. É a FECHADURA do parser: sem
 * ela, o `<b)` de um `if (a<b)` viraria tag. Com ela ainda é preciso que a tag
 * feche num `>` sem `;` nem outro `<` no caminho.
 */
const HTML = new Set([
  ...PROSA,
  ...INLINE,
  ...VAZIO,
  'a',
  'aside',
  'audio',
  'body',
  'button',
  'canvas',
  'circle',
  'colgroup',
  'defs',
  'details',
  'dialog',
  'div',
  'dl',
  'ellipse',
  'fieldset',
  'footer',
  'form',
  'g',
  'head',
  'header',
  'html',
  'iframe',
  'label',
  'line',
  'main',
  'nav',
  'noscript',
  'ol',
  'optgroup',
  'option',
  'path',
  'picture',
  'polygon',
  'polyline',
  'pre',
  'rect',
  'script',
  'section',
  'select',
  'slot',
  'style',
  'summary',
  'svg',
  'table',
  'tbody',
  'template',
  'text',
  'textarea',
  'tfoot',
  'thead',
  'title',
  'tr',
  'tspan',
  'ul',
  'use',
  'video',
])

const MARCA_EXPR = String.fromCharCode(0)
const PALAVRA = /[\p{L}][\p{L}'’-]*/gu
const LETRA_OU_PONTUACAO = /[\p{L} ,.;:!?'’…·—–-]/gu

/**
 * O mínimo que separa FRASE de RÓTULO, e o único limiar de tamanho que sobrou.
 * O número está no bloco acima: baixada de 4 para 1, a definição vai de 262 para
 * 481 achados nos 11 repositórios, e os 219 a mais são rótulo, não conteúdo.
 */
const MIN_PALAVRAS = 4

/** Abaixo disto o nó é tabela de números, não prosa — ver `sinalDeCodigo`. */
const MIN_LETRAS = 0.9

/** Pula string ou template a partir da aspa em `i`. */
function pularAspas(t, i) {
  const aspa = t[i]
  i++
  while (i < t.length) {
    if (t[i] === '\\') i += 2
    else if (t[i] === aspa) return i + 1
    else i++
  }
  return i
}

/**
 * Monta as CORRIDAS de texto de um JSX: cada uma é o texto que um elemento
 * carrega entre duas fronteiras de bloco, com os inline atravessados.
 */
function nosDeTexto(fonte) {
  const saida = []
  const pilha = []
  let i = 0
  const topo = () => pilha[pilha.length - 1]

  function fecharCorrida(q) {
    if (!q) return
    // Expressão e inline não EMITEM: a primeira porque o texto solto dela é
    // código, o segundo porque o texto dele pertence à corrida do pai.
    if (q.expressao || q.inline) {
      q.partes = []
      return
    }
    const texto = q.partes.join('')
    q.partes = []
    if (texto.trim()) saida.push({ texto, dono: q.nome })
  }

  function fecharQuadro(q) {
    const pai = topo()
    if (q.inline && pai) {
      pai.partes.push(q.partes.join(''))
      return
    }
    fecharCorrida(q)
  }

  function fronteira() {
    const pai = topo()
    if (!pai) return
    if (!pai.inline) return fecharCorrida(pai)
    const avo = pilha[pilha.length - 2]
    if (avo) {
      avo.partes.push(pai.partes.join(''))
      pai.partes = []
    }
  }

  while (i < fonte.length) {
    const c = fonte[i]

    if (c === '<' && /[A-Za-z/]/.test(fonte[i + 1] || '')) {
      let j = i + 1
      const fechamento = fonte[j] === '/'
      if (fechamento) j++
      let nome = ''
      while (j < fonte.length && /[\w.:-]/.test(fonte[j])) nome += fonte[j++]
      // Componente (maiúscula) e `Namespace.Tag` valem; minúscula só se for HTML.
      if (!nome || !(/^[A-Z]/.test(nome) || nome.includes('.') || HTML.has(nome))) {
        i++
        continue
      }
      let k = j
      let chaves = 0
      let fechou = false
      while (k < fonte.length && k - i < 4000) {
        const d = fonte[k]
        if (d === '"' || d === "'" || d === '`') {
          k = pularAspas(fonte, k)
          continue
        }
        if (d === '{') {
          chaves++
          k++
          continue
        }
        if (d === '}') {
          chaves--
          k++
          continue
        }
        if (chaves === 0 && (d === '<' || d === ';')) break
        if (chaves === 0 && d === '>') {
          fechou = true
          break
        }
        k++
      }
      if (!fechou) {
        i++
        continue
      }
      const autoFecha = fonte[k - 1] === '/'
      i = k + 1

      if (fechamento) {
        const idx = pilha.map((x) => x.nome).lastIndexOf(nome)
        if (idx === -1) continue
        if (!INLINE.has(nome)) fronteira()
        while (pilha.length > idx) fecharQuadro(pilha.pop())
        if (!INLINE.has(nome)) fronteira()
        continue
      }
      if (autoFecha || VAZIO.has(nome)) {
        if (INLINE.has(nome)) {
          if (topo()) topo().partes.push(' ')
        } else fronteira()
        continue
      }
      if (!INLINE.has(nome)) fronteira()
      pilha.push({ nome, partes: [], inline: INLINE.has(nome), expressao: false })
      continue
    }

    // `{…}` em posição de filho: barreira. Ver a nota do casamento lá em cima.
    if (c === '{' && pilha.length) {
      if (topo()) topo().partes.push(MARCA_EXPR)
      pilha.push({ nome: '{}', partes: [], inline: false, expressao: true })
      i++
      continue
    }
    if (c === '}' && pilha.length) {
      const idx = pilha.map((x) => x.expressao).lastIndexOf(true)
      if (idx !== -1) {
        while (pilha.length > idx) fecharQuadro(pilha.pop())
      } else if (topo()) topo().partes.push(c)
      i++
      continue
    }
    // Dentro de expressão, string é código: pular inteira impede que um `<` ou
    // um `{` escrito entre aspas desmonte a pilha.
    if ((c === '"' || c === "'" || c === '`') && topo() && topo().expressao) {
      i = pularAspas(fonte, i)
      continue
    }

    if (topo()) topo().partes.push(c)
    i++
  }
  while (pilha.length) fecharQuadro(pilha.pop())
  return saida
}

/** O que faz um nó NÃO ser prosa: proporção de letras abaixo de MIN_LETRAS. */
function sinalDeCodigo(frase) {
  const letras = (frase.match(LETRA_OU_PONTUACAO) || []).length
  return letras / frase.length < MIN_LETRAS
}

/** As frases de CONTEÚDO de um arquivo JSX, pela definição do bloco acima. */
export function frasesDeConteudo(t) {
  const achadas = []
  for (const no of nosDeTexto(t)) {
    if (!PROSA.has(no.dono)) continue
    const frase = no.texto.split(MARCA_EXPR).join('…').replace(/\s+/g, ' ').trim()
    if (!frase) continue
    const palavras = frase.match(PALAVRA) || []
    if (palavras.length < MIN_PALAVRAS) continue
    if (sinalDeCodigo(frase)) continue
    achadas.push(frase)
  }
  return achadas
}

// EXPORTADO para o gerador do MCP (`mcp/gerar.mjs`), e essa é a única razão do
// `export` aqui: o artefato que o servidor MCP lê é DERIVADO desta lista, nunca
// uma cópia dela. Sem o export, o gerador teria de adivinhar `id`, `classe`,
// `nivel` e `titulo` por regex no texto do arquivo — e regex que erra some com a
// regra em silêncio, que é exatamente o defeito que o MCP existe para não
// repetir. Com o export, o gerador COMPARA o que leu no texto com o que o módulo
// entrega, e diverge alto.
//
// O `EH_PROGRAMA` logo abaixo é o que torna isto seguro: importar este arquivo
// não dispara o CLI, porque `process.argv[1]` é o outro programa.
export const REGRAS = [
  // ── determinísticas ─────────────────────────────────────────────────────

  {
    id: 'editorconfig',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'tem .editorconfig',
    checar: (r) => (existe(r.dir, '.editorconfig') ? null : 'ausente'),
  },

  {
    id: 'dependabot',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'atualização de dependência automatizada',
    checar: (r) => {
      // Guarda de leitura só: a aplicabilidade continua sendo o package.json da
      // RAIZ, porque dependabot e renovate são configuração de repositório e
      // não de pacote. Sem a guarda, quebrar o package.json tirava esta regra
      // do denominador junto com as outras três.
      const ilegivel = raizIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.pkg) return na('não é projeto npm')
      return existe(r.dir, '.github/dependabot.yml') ||
        existe(r.dir, '.github/dependabot.yaml') ||
        existe(r.dir, 'renovate.json') ||
        existe(r.dir, '.github/renovate.json')
        ? null
        : 'sem dependabot nem renovate'
    },
  },

  {
    id: 'ci',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'tem CI',
    checar: (r) => (r.workflows.length ? null : 'nenhum workflow em .github/workflows/'),
  },

  {
    id: 'ci-gateia',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'o CI alcança a verificação que o repositório tem',
    checar: (r) => {
      // Mesma guarda de leitura das outras: com o package.json quebrado,
      // `r.pkg?.scripts` virava `{}`, `alvos` ficava vazio e a regra saía do
      // denominador. Quatro regras sumindo é o que fazia 9 de 10 virar 6 de 6.
      const ilegivel = raizIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.workflows.length) return na('sem CI — quem cobra isso é a regra `ci`')
      const scripts = r.pkg?.scripts || {}
      // Só cobra o que o repositório POSSUI. Exigir `lint` de um repo sem lint
      // é exigir que ele adote uma ferramenta — decisão de outro nível.
      const alvos = ['lint', 'typecheck', 'test'].filter((g) => scripts[g])
      if (!alvos.length) return na('package.json não tem script lint, typecheck nem test')
      const yml = r.workflows.map((w) => ler(r.dir, w) || '').join('\n')
      const efetivo = textoEfetivoDoCi(yml, scripts, r)
      const faltam = alvos.filter((g) => !new RegExp(`\\b${g}\\b`).test(efetivo))
      return faltam.length ? `o CI não alcança: ${faltam.join(', ')}` : null
    },
  },

  {
    id: 'testes',
    classe: 'determinística',
    nivel: 'N3',
    titulo: 'tem teste',
    checar: (r) => (r.arquivos.some(ehTeste) ? null : 'zero arquivo de teste'),
  },

  {
    id: 'typecheck',
    classe: 'determinística',
    nivel: 'N0',
    titulo: 'tem script de typecheck',
    checar: (r) => {
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.manifestos.length) return na('não é projeto npm')
      if (!r.arquivos.some((a) => /\.(ts|tsx)$/i.test(a))) return na('não tem TypeScript')
      const nomes = scriptsDeTodos(r)
      return NOMES_TYPECHECK.some((n) => nomes.has(n))
        ? null
        : `nenhum package.json rastreado tem script ${NOMES_TYPECHECK.join(', ')}`
    },
  },

  {
    id: 'formatter',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'tem formatador',
    checar: (r) => {
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.manifestos.length) return na('não é projeto npm')
      const d = dependenciasDeTodos(r)
      return d.prettier || d['@biomejs/biome'] || d.dprint ? null : 'sem prettier, biome ou dprint'
    },
  },

  {
    id: 'env-example',
    classe: 'determinística',
    nivel: 'N2',
    titulo: 'lê env e documenta em .env.example',
    checar: (r) => {
      if (!r.varsEnv.size) return na('não lê variável de ambiente')
      if (!r.envExample)
        return `lê ${r.varsEnv.size} variável(is) de ambiente e não tem .env.example`
      const faltando = [...r.varsEnv].filter(
        (v) => !new RegExp(`^${v}\\s*=`, 'm').test(r.envExample),
      )
      return faltando.length ? `não documentadas: ${faltando.slice(0, 4).join(', ')}` : null
    },
  },

  {
    id: 'licenca',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'tem LICENSE',
    checar: (r) => (r.arquivos.some((a) => /^LICEN[CS]E/i.test(a)) ? null : 'ausente'),
  },

  {
    id: 'readme',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'tem README',
    // ESTA REGRA PEGA ZERO HOJE, e isso fica escrito aqui de propósito.
    //
    // Medido em 31/08/2026 nos 12 repositórios da máquina: TODOS têm README,
    // de 25 a 282 linhas úteis, e NENHUM é boilerplate de framework (procurei
    // por "bootstrapped with create-next-app", "npm create vite", "Getting
    // Started with Create React App" e afins — zero ocorrências).
    //
    // Então por que existe. Primeiro: duas horas antes de esta linha ser
    // escrita, o próprio rebar era o único repositório sem README, e foi a
    // público assim — enquanto o docs/PLANO.md listava "README como
    // entregável" DUAS VEZES como buraco que este projeto existe para tapar.
    // A régua não enxergava o buraco que o plano dela nomeava.
    // Segundo: o gerador vai produzir repositório novo, e repositório novo
    // nasce sem README por padrão.
    //
    // Só PRESENÇA, sem piso de tamanho. Um limite de linhas reprovaria
    // `navesz.github.io` (25 linhas) e `VectraB-Lab` (31), que são projetos
    // pequenos com README proporcional — e regra automática errada custa mais
    // que regra ausente.
    checar: (r) =>
      r.arquivos.some((a) => /^readme(\.[a-z]+)?$/i.test(a))
        ? null
        : 'ausente — é a primeira coisa que se vê num repositório público',
  },

  {
    id: 'notice',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'Apache-2.0 acompanhado de NOTICE',
    checar: (r) => {
      const lic = r.arquivos.find((a) => /^LICEN[CS]E/i.test(a))
      if (!lic) return na('sem LICENSE — quem cobra isso é a regra `licenca`')
      if (!/Apache License/i.test(ler(r.dir, lic) || '')) return na('a licença não é Apache')
      return r.arquivos.some((a) => /^NOTICE/i.test(a)) ? null : 'licença Apache sem NOTICE'
    },
  },

  {
    id: 'hooks-executaveis',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'hook de git commitado com bit de execução',
    // ACHADO DE AUDITORIA, 31/08: o modo 100755 era garantido UMA VEZ, na
    // criação, e nada o mantinha. Um `git update-index --chmod=-x` — ou um
    // arquivo criado no Windows, onde o bit não existe — devolve o hook para
    // 100644, e em Linux o git passa a IGNORÁ-LO em silêncio. O portão se
    // declara ligado e não faz nada, que é o pior estado possível.
    //
    // O modo lido é o do ÍNDICE, não o do disco: `chmod` local não viaja no
    // clone, e é o clone que chega na máquina de quem for usar.
    checar: (r) => {
      const nomes =
        /(^|\/)(pre-commit|commit-msg|pre-push|prepare-commit-msg|post-checkout|pre-rebase)$/
      const hooks = r.arquivos.filter((a) => nomes.test(a))
      if (!hooks.length) return na('nenhum arquivo com nome de hook de git')
      const modos = modosDoIndice(r.dir)
      const mudos = hooks.filter((h) => modos.get(h) !== '100755')
      return mudos.length
        ? `sem bit de execução no índice, o git os ignora em Linux: ${mudos.join(', ')}` +
            ` — conserte com: git update-index --chmod=+x ${mudos.join(' ')}`
        : null
    },
  },

  {
    id: 'portao-com-placeholder',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'o portão não ficou com placeholder de instalação',
    // ACHADO USANDO O GERADOR DE VERDADE, 02/09. O dono pediu um site real, e
    // gerar um expôs isto: o placeholder do CONTEÚDO é inerte e barulhento — o
    // build reprova enquanto sobrar `TROQUE-…`. O placeholder do PORTÃO era
    // inerte e MUDO.
    //
    // A identidade do git desta máquina é local do repositório do rebar, não
    // global. O gerador não achou nenhuma, escreveu `DONO NÃO CONFIGURADO` em
    // NOTICE, README e `.rebar-coautores`, e o rebar-check deu 13 de 13, exit 0
    // em cima disso.
    //
    // O pior dos três é o `.rebar-coautores`: ele vira a allowlist de quem pode
    // assinar commit, com um e-mail `@exemplo.invalido` dentro. Ninguém casa
    // com aquele e-mail, então a regra `coautoria-ia` passa a reprovar todo
    // commit — ou, dependendo de como for lida, nenhum. Portão instalado com
    // placeholder é portão que se aprende a desligar na primeira semana.
    checar: (r) => {
      const MARCA = /(NÃO|NAO) CONFIGURADO|@exemplo\.invalido|TROQUE-[A-Z-]{3,}/
      const ONDE = /^(NOTICE|README\.md|\.rebar-coautores|LICENSE)$/i
      const alvos = r.arquivos.filter((a) => ONDE.test(a))
      if (!alvos.length) return na('nenhum arquivo de identidade do portão')
      const sujos = alvos.filter((a) => MARCA.test(ler(r.dir, a) || ''))
      return sujos.length
        ? `o gerador não achou a identidade e deixou marcador em ${sujos.join(', ')}` +
            ` — configure o git e refaça, ou corrija à mão`
        : null
    },
  },

  {
    id: 'coautoria-ia',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'coautoria só de humanos da allowlist',
    checar: (r) => {
      if (!r.commits.length) return na('repositório sem commit')

      const { coautores: brutos, total, porEnumeracaoDoTexto } = coautoresDoHistorico(r)
      // Automação de manutenção sai antes de qualquer contagem, para que ela não
      // apareça nem no veredito nem no NÚMERO impresso — ver AUTOMACAO_NAO_IA.
      const coautores = brutos.filter((x) => !AUTOMACAO_NAO_IA.test(x.valor))

      // Zero trailer de coautoria é o único veredito que NÃO depende de saber
      // quem é IA e quem é gente: não há coautor nenhum, logo não há coautor de
      // IA. Vale com allowlist e sem, e é o caso dos 11 commits deste
      // repositório. Sai antes de tudo para que o ramo N/A abaixo nunca engula
      // um repositório que está genuinamente limpo.
      if (!coautores.length) return null

      const lista = lerAllowlistCoautores(r)
      if (lista.estado === 'ilegivel')
        return `${ALLOWLIST_COAUTORES} está rastreada e não pude ler: ${lista.erro}`

      const fonte = porEnumeracaoDoTexto
        ? ' (trailers lidos do texto: ' + porEnumeracaoDoTexto + ')'
        : ''

      if (lista.estado === 'ok') {
        const forasteiros = coautores.filter((x) => !x.email || !lista.emails.has(x.email))
        if (!forasteiros.length) return null
        return (
          `${forasteiros.length} de ${total} commits com coautor fora de ${ALLOWLIST_COAUTORES}: ` +
          [...new Set(forasteiros.map((x) => x.valor))].slice(0, 3).join(' · ') +
          fonte
        )
      }

      // Sem allowlist só resta ENUMERAR, e enumeração é a forma que este
      // conserto existe para abandonar: medido em 2026-08-30, a lista de 9
      // agentes deixou passar Windsurf, ChatGPT, Cody, Codeium, Amazon Q e
      // Tabnine de uma só vez. Aqui ela sobrevive por um motivo estreito: o
      // rebar-check roda contra repositório de TERCEIRO, que não tem a
      // allowlist do rebar, e desligar a regra ali seria trocar um portão
      // furado por portão nenhum.
      //
      // O que muda é o que a enumeração tem direito de AFIRMAR. Achou um agente
      // conhecido, reprova — enumeração prova presença. Não achou, NÃO passa:
      // vira N/A dizendo que há coautor que não dá para classificar. Enumeração
      // não prova ausência, e um "✓" ali seria o checker afirmando o que não
      // sabe. É a mesma disciplina do `na()` no alto deste arquivo: o que não dá
      // para decidir sai do denominador, com o motivo impresso.
      const suspeitos = coautores.filter((x) => AGENTES_ENUMERADOS.test(x.valor))
      if (suspeitos.length) {
        return (
          `${suspeitos.length} de ${total} commits com coautoria de IA, por ENUMERAÇÃO ` +
          `(sem ${ALLOWLIST_COAUTORES} rastreada): ` +
          [...new Set(suspeitos.map((x) => x.valor))].slice(0, 3).join(' · ') +
          fonte
        )
      }
      return na(
        `${coautores.length} coautor(es) e nenhuma ${ALLOWLIST_COAUTORES} rastreada — ` +
          'só dá para enumerar agentes conhecidos, e enumeração não prova ausência',
      )
    },
  },

  {
    id: 'identidade-git',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'identidade de autor consistente',
    checar: (r) => {
      if (!r.autores.length) return na('repositório sem commit')
      const humanos = r.autores.filter((a) => !EH_BOT.test(a))
      if (!humanos.length) return na('só há commit de bot')
      const ids = new Set(humanos)
      if (ids.size <= 1) return null
      const pessoal = [...ids].filter((i) => !/@users\.noreply\.github\.com>/.test(i))
      const extra = pessoal.length ? ` (e-mail pessoal exposto: ${pessoal.length})` : ''
      return `${ids.size} combinações de nome/e-mail${extra}`
    },
  },

  {
    id: 'ui-falso',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'components/ui/ acompanhado de components.json',
    checar: (r) => {
      // A BASE de uma pasta de UI é o diretório que contém `components/`:
      // `apps/web/src/components/ui/botao.tsx` tem base `apps/web/src/`. É de
      // lá que a busca pela defesa sobe.
      const bases = new Set()
      for (const a of r.arquivos) {
        const m = /^((?:.*?\/)?)components\/ui\//.exec(a)
        if (m) bases.add(m[1])
      }
      if (!bases.size) return na('não tem pasta components/ui/')
      const defesas = new Set(r.componentsJson.map(pastaDe))
      const orfas = [...bases].filter((b) => !ancestrais(b).some((p) => defesas.has(p)))
      return orfas.length
        ? `components/ui/ imitando a convenção, sem components.json em nenhum diretório acima: ` +
            orfas
              .slice(0, 3)
              .map((b) => `${b}components/ui/`)
              .join(', ')
        : null
    },
  },

  {
    id: 'schema-orfao',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'nenhum JSON Schema órfão',
    checar: (r) => {
      const schemas = r.arquivos.filter((a) => /\.schema\.json$/.test(a))
      if (!schemas.length) return na('nenhum .schema.json no repositório')
      // Teste CONTA como leitor, e é o único lugar do arquivo onde ele conta.
      //
      // As outras regras de conteúdo perguntam o que o produto FAZ, e teste não
      // é produto. Esta pergunta é outra: existe alguém que lê este schema? Um
      // teste de contrato que o importa responde SIM da forma mais forte que
      // existe — se o schema mudar, o teste quebra. Medido: o `openkartline`
      // era acusado de dois schemas "definidos e nunca lidos" com
      // `apps/web/src/services/schemaContract.test.ts` importando os dois nas
      // linhas 2 e 3. Era a única acusação desta regra nos 11 repositórios, e
      // era falsa.
      const todo = [...r.fontes, ...r.fontesTeste].map(([, t]) => t).join('\n')
      const orfaos = schemas.filter((s) => !todo.includes(basename(s)))
      return orfaos.length ? `definido e nunca lido: ${orfaos.slice(0, 3).join(', ')}` : null
    },
  },

  {
    id: 'conteudo-fora-do-codigo',
    // CONTINUA HEURÍSTICA — e agora com o número que RECUSA a promoção, não
    // com uma lista de pendências. Três dos quatro defeitos apontados na
    // auditoria de 31/08 estão consertados e medidos; o quarto não cedeu, e é
    // ele que segura a regra aqui.
    //
    // 1. FRAGMENTO — CONSERTADO. O casamento cortava no primeiro `<`, e 18 das
    //    185 frases começavam com ponto, travessão ou no meio da oração.
    //    `nosDeTexto()` remonta a corrida atravessando os elementos inline:
    //    ZERO de 262 agora começam fora do começo da oração. As 6 que começam
    //    em minúscula foram conferidas uma a uma na fonte: quatro são `<li>` de
    //    uma lista "Nunca:", uma é legenda escrita assim, e a sexta é sobra de
    //    depuração (`esperado 0x… · recebido 0x…`) — nenhuma é pedaço de frase.
    //
    // 2. RÓTULO DE AÇÃO — CONSERTADO, e sem enumerar verbo. O discriminador é
    //    o DONO do nó de texto: `<button>`, `<a>` e `<label>` não são elemento
    //    de prosa, e o texto de um controle é o NOME dele. Ver o bloco de
    //    `PROSA`. Dos rótulos que a auditoria nomeou, saíram quatro:
    //    "Imprimir ou salvar em PDF" (`<button>`), "Arraste pela grade ou use
    //    ‹ › para percorrer." (`<span>`), "Não deu para abrir o cofre."
    //    (`<AlertTitle>`) e "Carregando o índice de preços…" (`<div>`).
    //
    // 3. PROVA DECORATIVA — CONSERTADA. Das nove mutações que sobreviviam
    //    nesta regra, as três nomeadas eram: apagar o dígito do padrão de
    //    preço, baixar o mínimo da frase e desligar o filtro de sinal de
    //    código. As três agora DIVERGEM, e o `aprovar/` do caso principal
    //    existe para isso: ele contém `R$` SEM dígito, um rótulo de campo de
    //    três palavras, uma linha de tabela com menos de 90% de letras, um
    //    `<button>` com rótulo de quatro palavras e um estado em `<div>`. Cada
    //    um deles fica vermelho se a guarda correspondente for afrouxada.
    //
    // 4. VOCABULÁRIO DE INTERFACE EM `<p>` — NÃO CEDEU, e é o que recusa a
    //    promoção. Medido antes: 27 de 185 (14,6%). Medido depois: 31 de 262
    //    (11,8%), e este número é RECONTÁVEL — `node medir-conteudo.mjs <repos>`
    //    imprime a tabela e a classificação. O 14,1% que esta linha publicava
    //    até 31/08 vinha de contagem à mão e não se reproduzia; o instrumento
    //    foi escrito justamente porque este repositório já publicou número
    //    errado quatro vezes, e ele desmentiu o primeiro número que checou —
    //    o mais caro do arquivo, o que RECUSA a promoção desta regra.
    //    A estrutura não moveu o número porque os que restam moram em
    //    elemento de prosa de verdade: "Nenhuma proposta salva ainda." é um
    //    `<p>` sob `history.length === 0` e "Clique para enviar a logo da
    //    empresa" é um `<p>` ao lado de um `<input type="file">`. Separá-los de
    //    "Nossa cozinha abre às 18h" exigiria ENUMERAR verbo de instrução e
    //    palavra de estado — e enumeração aqui falha para o lado errado: a
    //    lista incompleta não deixa de excluir, ela ACUSA. É a inversão exata
    //    do argumento do `coautoria-ia`: lá a enumeração prova presença e por
    //    isso pode reprovar; aqui ela precisaria provar AUSÊNCIA de instrução
    //    para não acusar, e não prova. Com ~12% de ruído, determinística barra
    //    merge por rótulo de campo — e regra que barra merge por rótulo de
    //    campo ensina a desligar a saída inteira.
    //
    // A §12.3 do plano continua aberta por causa do item 4, e não por causa do
    // 1, do 2 e do 3. O que falta não é engenharia de casamento: é um
    // discriminador de VOZ — texto que fala do negócio contra texto que fala
    // do programa — e ele não sai da árvore de elementos.
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'conteúdo em conteudo/*.json, não dentro de src/ nem de app/',
    // O motivo do portão de aplicabilidade está no bloco de comentário acima de
    // `RE_CONTEUDO_JSON`; a definição de "literal de conteúdo" e o número que
    // ela dá nos 11 repositórios estão no bloco de `PROSA`, logo abaixo dele.
    checar: (r) => {
      // A base é o diretório que contém `conteudo/`: em monorepo,
      // `apps/site/conteudo/menu.json` tem base `apps/site/`. A asserção fica
      // presa àquela base, e não ao repositório inteiro, pelo mesmo motivo que
      // `ui-falso` casa por proximidade: um `apps/painel/` vizinho que nunca
      // prometeu nada não pode ser acusado pela promessa do `apps/site/`.
      const bases = new Set()
      for (const a of r.arquivos) {
        const m = RE_CONTEUDO_JSON.exec(a)
        if (m) bases.add(m[1])
      }
      if (!bases.size) {
        return na(
          'nenhum conteudo/*.json rastreado — o repositório não adotou a convenção da §12.3',
        )
      }
      const sob = (a) =>
        [...bases].some((b) => a.startsWith(`${b}src/`) || a.startsWith(`${b}app/`))
      const alvos = r.fontes.filter(([a]) => sob(a))
      if (!alvos.length) return na('há conteudo/*.json e nenhum código em src/ nem em app/ ao lado')

      const achados = []
      for (const [a, bruto] of alvos) {
        const t = semComentarioNemImport(bruto)
        const preco = PRECO_BRL.exec(t)
        if (preco) achados.push(`${a}: preço ${JSON.stringify(preco[0])}`)
        // Frase só em arquivo com JSX. Num `.ts` puro não existe nó de texto, e
        // procurar marcação lá seria ler operador de comparação como prosa.
        if (!RE_JSX.test(a)) continue
        const frases = frasesDeConteudo(t)
        if (frases.length) {
          achados.push(`${a}: frase ${JSON.stringify(frases[0].slice(0, 60))}`)
        }
      }
      return achados.length
        ? `${achados.length} literal(is) de conteúdo fora de conteudo/: ${achados.slice(0, 3).join(' · ')}`
        : null
    },
  },

  {
    id: 'telefone',
    // SOBE DE HEURÍSTICA A DETERMINÍSTICA, e o número que decidiu está aqui.
    //
    // Medido em 2026-08-30 nos 11 repositórios + o rebar: 417 arquivos de
    // código de produção varridos, UMA acusação — `Galegos/src/lib/whatsapp.ts`
    // linha 7, um `const WHATSAPP_NUMBER` com o celular da pizzaria em treze
    // dígitos —, e ela é verdadeira. Um verdadeiro, zero falsos, em 417
    // arquivos. (O número não é transcrito aqui de propósito: ver a nota do
    // `semComentario`, onde está o que acontece quando ele é.)
    //
    // A §12.3 do plano fechou a decisão que dá o dente: telefone, CNPJ e
    // endereço são CONTEÚDO validado, não código e não variável de ambiente. E
    // o custo do erro está documentado no próprio Galegos: `Navesz/Galegos#1`
    // tentou mover o número para env var e o dono parou o PR, porque o build
    // passa e o `wa.me` sobe sem destinatário. Determinística é o que faz a
    // decisão valer.
    //
    // O padrão foi APERTADO junto com a promoção, e essa é a metade cara. O
    // antigo `\(?\d{2}\)?\s?9\d{4}-?\d{4}` aceitava ONZE DÍGITOS SEGUIDOS sem
    // pontuação nenhuma, com um `9` na terceira casa: um EAN-13 de produto
    // (`7891234599999`) casava. Aceitável numa heurística que só informa;
    // inaceitável numa regra que reprova merge. Agora só conta o que traz
    // MARCA de telefone brasileiro — link `wa.me`, código de país 55, ou a
    // pontuação de DDD. O mesmo Galegos continua sendo pego (`55` + `24` + `9`
    // + oito dígitos) e os outros 416 arquivos continuam limpos: o aperto não
    // custou nem um verdadeiro positivo.
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'sem telefone brasileiro no código',
    checar: (r) => {
      const re =
        /wa\.me\/\d{8,}|\+?55\s?\(?\d{2}\)?\s?9\d{4}-?\d{4}|\(\d{2}\)\s?9\d{4}-?\d{4}|\b\d{2}\s9\d{4}-\d{4}\b/
      // Comentário fora: ver a nota do `semComentario`. O que a §12.3 proíbe é
      // o número que o programa USA — o que sobe no `wa.me` e no `tel:` —, e
      // esse mora em código executado, não em nota de rodapé.
      // ONZE DÍGITOS CRUS contam SÓ quando o arquivo monta um `wa.me` ou um
      // `tel:`. É o conserto de uma regressão que o aperto acima causou e que a
      // auditoria pegou: o MESMO celular do Galegos escrito sem o DDI, no mesmo
      // arquivo, montando o mesmo link, passava limpo. O contexto é o que
      // separa telefone de código de barras: um EAN-13 não vira link de
      // WhatsApp, e por isso o dígito cru só conta acompanhado.
      const cru = /\b\d{2}9\d{8}\b/
      const usaContato = /wa\.me|tel:|whatsapp/i
      const hits = r.fontes
        .filter(([, t]) => {
          const limpo = semComentario(t)
          return re.test(limpo) || (usaContato.test(limpo) && cru.test(limpo))
        })
        .map(([a]) => a)
      return hits.length
        ? `telefone é conteúdo, não código (§12.3) — ${hits.length} arquivo(s): ${hits.slice(0, 3).join(', ')}`
        : null
    },
  },

  // ── heurísticas ─────────────────────────────────────────────────────────

  {
    id: 'shadcn-completo',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'shadcn com o aparato, não só a pasta',
    checar: (r) => {
      // Mesmo conserto do `ui-falso` e do `formatter`: o `components.json`
      // procurado em qualquer profundidade, o aparato procurado em todos os
      // manifestos. Antes, monorepo nenhum chegava a ser avaliado por esta
      // heurística — prumo, ducado e LinhaK saíam por `na('não usa shadcn')`
      // tendo os três o arquivo rastreado numa subpasta.
      if (!r.componentsJson.length) return na('não usa shadcn')
      // A guarda de leitura vem DEPOIS do N/A: quem não usa shadcn não deve
      // ganhar aviso por causa de um package.json quebrado. Aqui isso é seguro
      // porque heurística não entra no denominador — não há N/A a lavar.
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      const d = dependenciasDeTodos(r)
      // ATENÇÃO: @radix-ui sozinho reprova o único repo que acertou. O Galegos
      // usa shadcn correto no estilo base-nova, com @base-ui/react e ZERO Radix.
      //
      // `radix-ui` sem barra é o pacote unificado que substituiu os
      // `@radix-ui/react-*` avulsos, e a ausência dele aqui era um falso
      // positivo latente que este passo destapou: passando a enxergar
      // `apps/web/components.json`, a heurística acusou o ducado de
      // "components.json sem primitiva" com `"radix-ui": "^1.6.7"` declarado e
      // `import { Select as SelectPrimitive } from 'radix-ui'` em oito
      // componentes. Defesa procurada com nome velho é a mesma classe de erro
      // que defesa procurada só na raiz.
      const primitiva = Object.keys(d).some(
        (k) => k.startsWith('@radix-ui/') || k === 'radix-ui' || k === '@base-ui/react',
      )
      const faltam = []
      if (!primitiva) faltam.push('primitiva (@radix-ui/*, radix-ui ou @base-ui/react)')
      if (!d['class-variance-authority']) faltam.push('cva')
      if (!d['tailwind-merge']) faltam.push('tailwind-merge')
      return faltam.length ? `components.json sem ${faltam.join(', ')}` : null
    },
  },

  {
    id: 'url-producao',
    classe: 'heurística',
    // POR QUE CONTINUA HEURÍSTICA, com o número na mão.
    //
    // Depois dos dois consertos abaixo a regra passou de 12 arquivos acusados
    // em 7 repositórios para 6 arquivos em 5, e os 6 são literalmente
    // verdadeiros — nenhum é falso positivo. Mesmo assim ela NÃO sobe a
    // determinística, e o motivo é o nome dela: 4 dos 6 são endereço de API
    // PÚBLICA DE TERCEIRO (`viacep.com.br`, `api.bcb.gov.br`,
    // `api.deepinfra.com`, `api.replicate.com`) e só 2 são a origem de produção
    // do próprio site (`decima-edicoes/scripts/verify-static.mjs`,
    // `navesz.github.io/scripts/fetch-data.mjs`). Fixar o endereço de uma API
    // pública é engenharia normal, não defeito; o defeito é fixar PARA ONDE
    // ESTE site sobe. Separar os dois exige saber a origem do deploy, e o
    // checker não sabe. Barrar merge com 2 de 6 de precisão sobre o defeito que
    // a regra nomeia é punir comportamento correto — e regra que pune
    // comportamento correto ensina a desligar a saída inteira.
    nivel: 'N2',
    titulo: 'sem URL de produção fora de configuração',
    checar: (r) => {
      // CONSERTO 1 — o padrão env-fallback, que é o padrão CERTO.
      //
      // `process.env.X ?? 'https://…'` é exatamente o que se quer que a pessoa
      // escreva: variável de ambiente com padrão sensato. Medido:
      // `decima-edicoes/app/lib/site.ts:5` acusado por
      // `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://navesz.github.io/decima-edicoes'`,
      // e `hug-brasil-propostas` acusado DUAS vezes pela mesma forma
      // (`scripts/check-access.js:3` e `src/lib/accessControl.ts:6`). Três das
      // doze acusações eram a régua batendo em quem acertou.
      //
      // O fallback é apagado do texto ANTES da busca, e não o arquivo inteiro:
      // um arquivo pode ter o padrão certo numa linha e o endereço cru na
      // outra, e absolver o arquivo por causa da linha boa seria trocar este
      // falso positivo por um falso negativo.
      const ENV_FALLBACK =
        /(?:process|import\.meta)\.env(?:\.[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\])\s*(?:\?\?|\|\|)\s*(['"`])[^'"`]*\1/g

      // CONSERTO 2 — endereço só conta quando é usado COMO endereço.
      //
      // O literal tem de ABRIR uma string e vir logo depois de uma chamada de
      // requisição ou de um nome de endereço. Medido, três acusações caíram e
      // as três não se sustentavam ao abrir o arquivo:
      //   openkartline/apps/web/src/App.tsx:521 — `href="https://github.com/…"`,
      //     um link do rodapé para o próprio repositório. Link é link.
      //   prumo/…/migrations/20260825_0003_credentials.ts — vinte campos
      //     `doc: 'https://docs.fal.ai'`, catálogo de documentação semeado em
      //     tabela. É DADO, e dado é o lugar certo dele.
      //   prumo/…/collectors/index.ts:76 — o endereço dentro da string de
      //     `User-Agent`. Não abre string nenhuma, então nem chega a ser testado.
      const ABERTURA =
        /(['"`])(https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|json-schema\.org|fonts\.(?:googleapis|gstatic)\.com|registry\.npmjs)[a-z0-9.-]+\.(?:com|com\.br|br|app|dev|io|net|site)[^'"`]*)/gi
      const CHAMADA = /(?:fetch|axios(?:\.\w+)?|request|createClient|connect|new\s+URL)\s*\(\s*$/i
      // Português na lista pela mesma razão de `NOMES_TYPECHECK` e de
      // `NOME_TESTE`: régua escrita em português que só reconhece nome de
      // variável em inglês é cega ao repositório que ela existe para medir.
      // `origem`, `endereco` e `servidor` são o que um projeto daqui escreve
      // onde o `decima-edicoes` escreveu `origin`.
      const NOME_ENDERECO =
        /[A-Za-z0-9_$]*(?:url|uri|endpoint|origin|origem|host|base|site|api|endereco|endereço|servidor)\s*[:=]\s*$/i

      const hits = []
      for (const [a, bruto] of r.fontes) {
        if (/config|\.d\.ts$/i.test(a)) continue
        const t = bruto.replace(ENV_FALLBACK, ' ')
        for (const m of t.matchAll(ABERTURA)) {
          // 60 caracteres bastam para o `const NOME_LONGO =` mais folgado e
          // impedem que uma linha vizinha empreste o veredito à seguinte.
          const antes = t.slice(Math.max(0, m.index - 60), m.index)
          if (CHAMADA.test(antes) || NOME_ENDERECO.test(antes)) {
            hits.push(a)
            break
          }
        }
      }
      return hits.length ? `${hits.length} arquivo(s): ${hits.slice(0, 3).join(', ')}` : null
    },
  },

  {
    id: 'hex-cru',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'sem hex duplicando token do CSS',
    checar: (r) => {
      // Só acusa hex que JÁ EXISTE como token no CSS. Hex solto tem contexto
      // legítimo demais — material de three.js, véu de overlay — e a versão
      // ingênua desta regra deu 100% de falso positivo quando medida.
      const css = r.arquivos.filter((a) => /\.css$/.test(a))
      if (!css.length) return na('nenhum .css no repositório')
      const noCss = new Set()
      for (const a of css)
        for (const m of (ler(r.dir, a) || '').matchAll(/#[0-9a-f]{6}/gi))
          noCss.add(m[0].toLowerCase())
      if (!noCss.size) return na('nenhuma cor hex no CSS')
      const dup = new Set()
      for (const [, t] of r.fontes)
        for (const m of t.matchAll(/#[0-9a-f]{6}/gi)) {
          if (noCss.has(m[0].toLowerCase())) dup.add(m[0].toLowerCase())
        }
      return dup.size
        ? `${dup.size} cor(es) definidas nos dois lugares: ${[...dup].slice(0, 3).join(', ')}`
        : null
    },
  },

  {
    id: 'idioma-unico',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'um idioma só no repositório',
    checar: (r) => {
      const pt = /\b(não|para|então|função|usuário|configuração|arquivo)\b/i
      const en = /\b(the|this|should|configuration|file|user)\b/i
      let ptN = 0,
        enN = 0
      for (const [, t] of r.fontes) {
        const com = t.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || []
        // Trecho entre crases é CÓDIGO CITADO, não prosa, e sai antes do teste
        // de idioma. Identificador em inglês dentro de um comentário em
        // português não é troca de idioma, é o nome da coisa — ninguém traduz
        // `User-Agent`, `<input type="file">` ou `cat-file --batch`.
        //
        // Medido em 2026-08-31 no espelho do rebar com `novo/` rastreado: a
        // contagem `en` caía de 3 para 0, e esses 3 eram exatamente estes três
        // arquivos, todos com prosa em português — `index.mjs`,
        // `varrer-segredo.mjs` e `novo/index.mjs`. Com min(pt,en) >= 3 sendo o
        // piso, os três davam a acusação inteira. O caso de prova
        // `idioma-unico` não tem uma crase e continua igual pelos dois lados.
        const txt = com.join('\n').replace(/`[^`]*`/g, ' ')
        if (pt.test(txt)) ptN++
        if (en.test(txt)) enN++
      }
      const menor = Math.min(ptN, enN)
      return menor >= 3 ? `comentários em pt (${ptN}) e en (${enN}) no mesmo repositório` : null
    },
  },
]

// ────────────────────────────────────────────────────────── leitura do repo

export function lerRepo(dir) {
  // Não basta existir `.git/`: uma pasta `.git/` VAZIA passa no existsSync e
  // faz todo comando git falhar. Pergunte ao git, não ao disco.
  const raiz = git(dir, ['rev-parse', '--git-dir'])
  if (!raiz.ok) return { erro: raiz.erro || 'git indisponível' }

  const ls = git(dir, ['ls-files'])
  if (!ls.ok) return { erro: ls.erro }
  const todos = ls.saida ? ls.saida.split('\n').filter(Boolean) : []
  const { arquivos, ignorados } = semFixtures(dir, todos)

  const manifestos = manifestosNpm(dir, arquivos)
  const componentsJson = arquivos.filter((a) => RE_COMPONENTS_JSON.test(a) && !IGNORAR.test(a))
  // `pkg` continua sendo só o manifesto da RAIZ, e só para quem depende dele
  // por razão própria (`ci-gateia` lê os scripts que o workflow invoca,
  // `dependabot` decide aplicabilidade). Quem pergunta sobre o repositório
  // inteiro usa `manifestos`.
  const raiz_ = manifestos.find((m) => m.rel === 'package.json')
  const pkg = raiz_?.estado === 'ok' ? raiz_.valor : null
  const { producao: fs_, teste: fsTeste } = fontes(dir, arquivos)
  // `ehTeste` serve nas DUAS pontas: define o que satisfaz a regra `testes` e
  // filtra o que entra em `fontes()`. Medido no ataque, com os mesmos bytes:
  // renomear uma pasta para `provas/` tirou o conteúdo dela de env-example,
  // schema-orfao, telefone, url-producao e idioma-unico E ainda satisfez
  // `testes` — "2 de 8 + 2 avisos" virou "3 de 7 + 0 avisos", sem uma linha
  // dizendo o que sumiu. A contagem é o que transforma esse portão aberto em
  // fato checado, do mesmo jeito que já se faz com o .rebarignore.
  const excluidosPorTeste = arquivos.filter((a) => ehCodigoAvaliavel(a) && ehTeste(a))
  ignorados.testes = excluidosPorTeste.length
  ignorados.amostraTestes = excluidosPorTeste.slice(0, 3)

  // Comentário fora ANTES da varredura: `.env.example` documenta o que o
  // programa LÊ EM EXECUÇÃO, e variável citada em comentário não é lida por
  // ninguém. Sem isto, uma nota explicando o padrão env-fallback fazia o
  // próprio rebar reprovar em `env-example` por duas variáveis inexistentes.
  const varsEnv = new Set()
  for (const [, t] of fs_) {
    for (const m of semComentario(t).matchAll(
      /(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g,
    )) {
      if (!ENV_DO_AMBIENTE.has(m[1])) varsEnv.add(m[1])
    }
  }

  // \x00 separa commits: mensagem de commit contém \n à vontade.
  // Repositório sem nenhum commit faz `git log` sair 128 — é estado válido,
  // e vira lista vazia, que as regras tratam como N/A.
  const logBruto = git(dir, ['log', '--format=%B%x00'])
  const commits =
    logBruto.ok && logBruto.saida
      ? logBruto.saida
          .split('\x00')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  // --no-merges: em pull request o GitHub cria um merge commit autorado por
  // `GitHub <noreply@github.com>`. Sem isto, TODO PR nasce reprovado nesta regra
  // — medido, e era o que impedia fisicamente ligar o rebar num PR de verdade.
  const logAutores = git(dir, ['log', '--no-merges', '--format=%an <%ae>'])
  const autores =
    logAutores.ok && logAutores.saida ? logAutores.saida.split('\n').filter(Boolean) : []

  return {
    dir,
    nome: basename(dir) || dir,
    arquivos,
    ignorados,
    pkg,
    manifestos,
    componentsJson,
    fontes: fs_,
    fontesTeste: fsTeste,
    varsEnv,
    commits,
    autores,
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
  return { dir, nome: r.nome, ignorados: r.ignorados, resultados }
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
  if (a.erro) {
    console.log(`\n${c.forte(a.nome)}\n  ${c.vermelho('✗')} ${a.erro}`)
    return
  }

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
    console.log(
      `  ${n.ok === n.total ? c.verde(txt) : c.vermelho(txt)}` +
        (n.na ? c.fraco(`  ·  ${n.na} não se aplica`) : '') +
        (heuVisiveis.length ? c.fraco(`  ·  ${heuVisiveis.length} aviso(s)`) : ''),
    )
  }
  if (n.quebrou) {
    console.log(
      `  ${c.amarelo(`⚠ ${n.quebrou} regra(s) QUEBRARAM — defeito do rebar-check, fora da nota`)}`,
    )
  }
  const ig = a.ignorados
  // Cada portão de exclusão imprime uma linha, mesmo quando não escondeu nada
  // de errado. Bypass A e B eram invisíveis: um subia um número em cinza-fraco
  // sem símbolo, o outro não subia nada. Aviso com a LISTA, não só a contagem —
  // número sozinho não dá para conferir.
  if (ig?.marcadoresRecusados?.length) {
    console.log(
      `  ${c.amarelo(`⚠ ${ig.marcadoresRecusados.length} caso.json IGNORADO(S) como marcador de prova:`)}`,
    )
    for (const m of ig.marcadoresRecusados) console.log(`      ${c.amarelo(m)}`)
  }
  if (ig?.modelosRecusados?.length) {
    console.log(
      `  ${c.amarelo(`⚠ ${ig.modelosRecusados.length} modelo.json IGNORADO(S) como marcador de modelo:`)}`,
    )
    for (const m of ig.modelosRecusados) console.log(`      ${c.amarelo(m)}`)
  }
  if (ig?.rebarignoreClandestino) {
    console.log(
      `  ${c.amarelo('⚠ .rebarignore existe no disco e NÃO está rastreado — ignorado por inteiro')}`,
    )
  }
  if (ig?.rebarignore) {
    console.log(`  ${c.amarelo(`⚠ ${ig.rebarignore} arquivo(s) escondidos por .rebarignore`)}`)
  }
  if (ig?.provas) {
    // Prefixo comum fatorado: todas as raízes aceitas moram sob CASOS_PROVAS
    // por construção, e repetir 40 caracteres por linha esconderia a lista
    // dentro do próprio comprimento dela.
    const nomes = (ig.raizesDeProva || []).map((p) => p.slice(CASOS_PROVAS.length, -1))
    console.log(
      c.fraco(
        `  ${ig.provas} arquivo(s) de caso de prova, fora da avaliação` +
          `  ·  ${CASOS_PROVAS}{${nomes.join(', ')}}`,
      ),
    )
  }
  if (ig?.modelos) {
    // A contagem sai mesmo quando é benigna, e nomeia as raízes: exclusão que
    // não se vê é exclusão que ninguém confere. É a mesma regra da linha das
    // provas, logo acima.
    console.log(
      c.fraco(
        `  ${ig.modelos} arquivo(s) de modelo do gerador, fora da avaliação` +
          `  ·  ${(ig.raizesDeModelo || []).join(', ')}`,
      ),
    )
  }
  if (ig?.testes) {
    const amostra = ig.amostraTestes?.length ? `: ${ig.amostraTestes.join(', ')}` : ''
    console.log(
      c.fraco(
        `  ${ig.testes} arquivo(s) de código fora das regras de conteúdo por serem teste${amostra}`,
      ),
    )
  }
}

// ─────────────────────────────────────────────────────────────────── main
//
// A linha de comando só roda quando ESTE arquivo é o PROGRAMA. Importado como
// biblioteca — é o que `medir-conteudo.mjs` faz para reusar a definição de
// literal de conteúdo em vez de reimplementá-la — o módulo entrega só os
// símbolos exportados e não avalia, não imprime e não sai.
//
// `realpathSync` nos DOIS lados porque o npx instala o bin como LINK: no Linux
// `node_modules/.bin/rebar` é um symlink para este arquivo, e comparar caminho
// cru daria falso justo no caminho quente. Também é o que faz a caixa do
// Windows não decidir nada: `c:/USERS/...` e `C:/Users/...` voltam iguais do
// realpath, e conferido — as duas formas rodam a linha de comando.
//
// Os dois casos de borda, e por que caem para lados OPOSTOS:
//   · SEM `argv[1]` — `node -e`, `--input-type=module`, REPL. Aí nenhum arquivo
//     é o programa, então este também não é: devolve FALSE e o embutidor recebe
//     só os símbolos. Sem esta linha, `node -e "import('…/index.mjs')"` fazia o
//     checker auditar o diretório corrente e sair 2 — medido.
//   · REALPATH FALHA num caminho que EXISTE como argumento. Aí não dá para
//     saber, e devolve TRUE: o arquivo volta a se comportar como programa, que
//     é o que ele fazia antes deste guarda. Errar para "programa" é errar alto
//     (imprime e sai com código); errar para "biblioteca" seria um `npx` que
//     não faz nada e sai 0.
const EH_PROGRAMA = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return true
  }
})()

if (EH_PROGRAMA) {
  const args = process.argv.slice(2)

  // ─── despacho do subcomando `novo`, ANTES de qualquer parse de opção
  //
  // Vem primeiro de propósito: o gerador tem a linha de comando dele (`<nome>
  // [dominio]`), e deixar o parser do checker olhar para ela produziria "opção
  // desconhecida" em bandeira que é do outro programa.
  //
  // O import é DINÂMICO e só acontece aqui. Assim `npx github:Navesz/rebar .`
  // — o caminho quente, o que roda em CI — não paga nada por o gerador existir,
  // e continua funcionando num checkout onde `novo/` não veio junto.
  if (args[0] === 'novo') {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const gerador = join(RAIZ, 'novo', 'index.mjs')
    if (!existsSync(gerador)) {
      console.error(`rebar: subcomando "novo" pede ${gerador}, que não está neste checkout.`)
      console.error('       Para auditar uma pasta chamada "novo", escreva ./novo')
      process.exit(2)
    }
    console.log(`rebar: subcomando "novo" → gerador (para auditar a pasta "novo", use ./novo)`)
    // O gerador chama `process.exit` por conta própria no fim do main dele, então
    // este import não retorna. Se um dia retornar, o exit 0 abaixo é o certo:
    // significa que o módulo carregou e terminou sem reclamar.
    await import(pathToFileURL(gerador).href)
    process.exit(0)
  }

  // ─── despacho de `--mcp`, também ANTES do parse de opção
  //
  // Esta bandeira NÃO audita nada: ela entrega o processo ao servidor MCP, que
  // fala JSON-RPC no stdio. Por isso vem antes, junto do `novo` — o parser
  // abaixo recusaria `--mcp` como opção desconhecida, e era exatamente isso que
  // acontecia até hoje: todo projeto gerado por `rebar novo` escreve um
  // `.mcp.json` que roda `.rebar/mcp.mjs`, que chama `rebar --mcp`. O ponteiro
  // existia dos dois lados e o alvo não respondia — `rebar-check: opção
  // desconhecida: --mcp`, saída 2, em todo projeto gerado.
  //
  // É PROCESSO FILHO, e não import dinâmico como o `novo`, por causa do stdio.
  // O transporte do MCP é JSON-RPC puro no stdout: uma única linha estranha ali
  // derruba a sessão inteira. Com `stdio: 'inherit'` o filho fica dono dos três
  // canais e nada que este arquivo já carregou tem como escrever no meio.
  //
  // Os dois erros abaixo são separados de propósito, porque o conserto é
  // diferente: o primeiro é checkout sem o módulo, o segundo é o módulo sem as
  // dependências dele. `mcp/` é pacote SEPARADO justamente para a raiz seguir
  // com zero dependência — o preço é este `npm install`, e ele é dito por
  // extenso em vez de aparecer como um ERR_MODULE_NOT_FOUND cru.
  if (args.includes('--mcp')) {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const servidor = join(RAIZ, 'mcp', 'src', 'index.mjs')
    const semMcp = (motivo, conserto) => {
      console.error(`rebar: --mcp pede ${motivo}`)
      console.error(`       ${conserto}`)
      console.error('       Sem MCP as regras continuam alcançáveis pelo comando do CI:')
      console.error('         npx --yes github:Navesz/rebar . --json')
      process.exit(2)
    }
    if (!existsSync(servidor)) {
      semMcp(`${servidor}, que não está neste checkout.`, 'Clone o rebar inteiro.')
    }
    if (!existsSync(join(RAIZ, 'mcp', 'node_modules'))) {
      semMcp(
        'as dependências do pacote mcp/, que não estão instaladas.',
        'Instale uma vez: cd mcp && npm install',
      )
    }
    // `process.execPath` e um .mjs: executável de verdade nos dois sistemas, sem
    // shell. É a mesma razão pela qual o `.mcp.json` do projeto gerado chama
    // `node` e não `npx` — no Windows o `npx` é `.cmd` e o CreateProcess não o
    // executa sem interpretador.
    const filho = spawnSync(process.execPath, [servidor], { stdio: 'inherit' })
    process.exit(filho.status ?? 1)
  }

  const json = args.includes('--json')
  const heuristicasBarram = args.includes('--heuristicas')
  const regraArg = args.find((a) => a.startsWith('--regra='))
  const filtro = regraArg ? regraArg.slice('--regra='.length) : null

  const desconhecidas = args.filter(
    (a) => a.startsWith('--') && !/^--(json|heuristicas|regra=)/.test(a),
  )
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
    console.log(
      JSON.stringify(
        avaliacoes.map((a) => (a.erro ? a : { ...a, nota: nota(a.resultados) })),
        null,
        2,
      ),
    )
  } else {
    for (const a of avaliacoes) imprimir(a)
    if (avaliacoes.length > 1) {
      console.log(`\n${c.forte('resumo')}`)
      for (const a of avaliacoes) {
        if (a.erro) {
          console.log(`  ${a.nome.padEnd(24)} ${c.vermelho(a.erro)}`)
          continue
        }
        const n = nota(a.resultados)
        if (!n.total) {
          console.log(`  ${a.nome.padEnd(24)} ${c.fraco('nada avaliável')}`)
          continue
        }
        // Barra de LARGURA FIXA. Com o N/A saindo do denominador cada repositório
        // tem um total diferente, e uma barra de comprimento variável faria 2/6
        // parecer pior que 3/11 — comparação que a régua não sustenta.
        const pct = n.ok / n.total
        const cheio = Math.round(pct * 10)
        const barra = '█'.repeat(cheio) + '·'.repeat(10 - cheio)
        console.log(
          `  ${a.nome.padEnd(24)} ${pct === 1 ? c.verde(barra) : c.vermelho(barra)}` +
            ` ${String(Math.round(pct * 100)).padStart(3)}%` +
            c.fraco(` ${n.ok}/${n.total}`) +
            (n.na ? c.fraco(` · ${n.na} n/a`) : ''),
        )
      }
    }
  }

  // Ordem dos códigos: QUEBROU domina REPROVOU. Um defeito no verificador
  // invalida o veredito — não se acusa um repositório com uma régua que quebrou.
  const quebrou = avaliacoes.some((a) => a.resultados?.some((x) => x.estado === 'quebrou'))
  const alvoInvalido = avaliacoes.some((a) => a.erro)
  const reprovou = avaliacoes.some((a) =>
    a.resultados?.some(
      (x) => x.estado === 'reprovou' && (x.classe === 'determinística' || heuristicasBarram),
    ),
  )

  if (quebrou) process.exit(127)
  if (alvoInvalido) process.exit(2)
  process.exit(reprovou ? 1 : 0)
}
