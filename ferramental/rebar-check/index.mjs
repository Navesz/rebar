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
//   node index.mjs --regra=<id> [dir]  uma regra só (é o que as provas usam)
//   node index.mjs --heuristicas       heurísticas também derrubam o exit code
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
 * Um arquivo é teste se um SEGMENTO do caminho for pasta de teste, ou se o
 * NOME for de teste. Por segmento, não por substring: "aprovar/" contém
 * "provar" e não é pasta de teste.
 *
 * O português entra aqui porque a versão anterior era cega a ele. Medido no
 * alicerce: 43 arquivos rastreados com "prova" no nome, e a regra enxergava
 * ZERO — um checker escrito em português que não reconhece teste nomeado em
 * português. Era um dos dois falsos positivos determinísticos provados.
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
const NOME_TESTE = /(\.|^)(test|spec|teste|prova)\.|^(provar|testar)[-.]/i

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
 * Schema mínimo do marcador: `regra` e `porque`, os dois campos que o
 * provar.mjs exige de todo caso. Um `caso.json` sem eles não é caso de prova,
 * é um arquivo com o nome certo — e esconder árvore era exatamente o que se
 * conseguia com um arquivo com o nome certo.
 */
function marcadorInvalido(dir, rel) {
  const lido = lerJsonRastreado(dir, rel)
  if (lido.estado !== 'ok') return lido.erro
  const falta = ['regra', 'porque'].filter(
    (k) => typeof lido.valor[k] !== 'string' || !lido.valor[k].trim(),
  )
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
    ignorados = 0
  for (const a of todos) {
    if (raizes.some((p) => a.startsWith(p))) {
      provas++
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
      rebarignore: ignorados,
      rebarignoreClandestino: ignoreClandestino,
    },
  }
}

/** Conteúdo dos arquivos de código rastreados, com teto de tamanho. */
function fontes(dir, arquivos) {
  const out = []
  for (const a of arquivos) {
    if (!ehCodigoAvaliavel(a) || ehTeste(a)) continue
    try {
      if (statSync(join(dir, a)).size > 512 * 1024) continue
      out.push([a, readFileSync(join(dir, a), 'utf8')])
    } catch {
      /* arquivo sumiu entre o ls-files e a leitura */
    }
  }
  return out
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
 * Expande o que o CI de fato executa. Um workflow que roda `npm run verificar`
 * está rodando o corpo de `verificar` — e, se aquele corpo chamar outro script,
 * está rodando aquele também.
 *
 * Sem isto, `ci-gateia` procurava as palavras lint/typecheck/test literais no
 * YAML e reprovava todo repositório que agrega a verificação num comando só.
 * Era o segundo falso positivo determinístico provado.
 */
function textoEfetivoDoCi(yml, scripts, profundidade = 3) {
  let texto = yml
  const vistos = new Set()
  for (let i = 0; i < profundidade; i++) {
    let cresceu = false
    for (const [nome, corpo] of Object.entries(scripts)) {
      if (vistos.has(nome)) continue
      // `npm run x`, `pnpm x`, `yarn x`, `run-s x`, `run-p x`
      const invocado = new RegExp(
        `(?:npm\\s+run|pnpm\\s+(?:run\\s+)?|yarn\\s+(?:run\\s+)?|run-[sp])\\s+${nome}\\b`,
      )
      if (invocado.test(texto)) {
        texto += '\n' + corpo
        vistos.add(nome)
        cresceu = true
      }
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
  /(claude|anthropic|cursor\.(com|sh)|cursoragent|copilot|codex|openai|chatgpt|devin|cognition|aider|gemini|google-labs-jules|jules@google|windsurf|codeium|sourcegraph|tabnine|amazon\s*q|amazonaws|codewhisperer|q-developer|replit|bolt\.new|v0\.dev|lovable|cline|roo-?code|kilo-?code|continue\.dev|sweep(ai|\.dev)|qodo|codium|coderabbit|greptile|ellipsis\.dev|korbit|bito\.ai|blackbox|phind|supermaven|augmentcode|zencoder|refact\.ai|sourcery|openhands|opendevin|all-hands|swe-agent|gpt-engineer|mentat|trae\.ai|marscode|comate|\[bot\])/i

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

const REGRAS = [
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
      const efetivo = textoEfetivoDoCi(yml, scripts)
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
    id: 'coautoria-ia',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'coautoria só de humanos da allowlist',
    checar: (r) => {
      if (!r.commits.length) return na('repositório sem commit')

      const { coautores, total, porEnumeracaoDoTexto } = coautoresDoHistorico(r)

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
      const todo = r.fontes.map(([, t]) => t).join('\n')
      const orfaos = schemas.filter((s) => !todo.includes(basename(s)))
      return orfaos.length ? `definido e nunca lido: ${orfaos.slice(0, 3).join(', ')}` : null
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
    id: 'telefone',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'sem telefone brasileiro no código',
    checar: (r) => {
      const re = /\(?\d{2}\)?\s?9\d{4}-?\d{4}|\b55\d{2}9\d{8}\b|wa\.me\/\d+/
      const hits = r.fontes.filter(([, t]) => re.test(t)).map(([a]) => a)
      return hits.length ? `${hits.length} arquivo(s): ${hits.slice(0, 3).join(', ')}` : null
    },
  },

  {
    id: 'url-producao',
    classe: 'heurística',
    nivel: 'N2',
    titulo: 'sem URL de produção fora de configuração',
    checar: (r) => {
      const re =
        /https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|json-schema\.org|fonts\.(?:googleapis|gstatic)\.com|registry\.npmjs)[a-z0-9.-]+\.(?:com|com\.br|br|app|dev|io|net|site)/i
      const hits = r.fontes
        .filter(([a, t]) => !/config|\.d\.ts$/i.test(a) && re.test(t))
        .map(([a]) => a)
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
        const txt = com.join('\n')
        if (pt.test(txt)) ptN++
        if (en.test(txt)) enN++
      }
      const menor = Math.min(ptN, enN)
      return menor >= 3 ? `comentários em pt (${ptN}) e en (${enN}) no mesmo repositório` : null
    },
  },
]

// ────────────────────────────────────────────────────────── leitura do repo

function lerRepo(dir) {
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
  const fs_ = fontes(dir, arquivos)
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

  const varsEnv = new Set()
  for (const [, t] of fs_) {
    for (const m of t.matchAll(/(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g))
      varsEnv.add(m[1])
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

const args = process.argv.slice(2)
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
