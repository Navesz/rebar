#!/usr/bin/env node
// numeros.mjs — os números do README e do ESTADO não são digitados. Este arquivo os escreve.
//
// POR QUE ELE EXISTE, e o defeito não é hipotético: já aconteceu SEIS VEZES.
// Medido nesta árvore em 02/09/2026, antes desta linha existir:
//
//   fato                        o README dizia    a verdade
//   regras determinísticas      16                17
//   casos de prova              50                52
//   regras com prova            21 de 21          22 de 22
//   passos do `verificar`       8                 12
//
// E o ESTADO.md carrega QUATRO contagens diferentes de casos de prova espalhadas
// pelo mesmo arquivo — 13, 33, 47 e 50 —, das quais no máximo uma pode estar
// certa. O próprio ESTADO abre com uma seção admitindo que já errou número três
// vezes ("disse 20 checagens quando eram 19"), e errou outras três desde então.
//
// A causa é ESTRUTURAL e não vai embora com atenção: os números são escritos à
// mão e a verdade muda a cada commit. Escrever com mais cuidado é a resposta que
// já falhou seis vezes; o repositório inteiro existe para dizer que regra em
// markdown tem cumprimento próximo de zero e regra em portão tem 100%.
//
// A DOUTRINA DA CASA JÁ RESOLVEU ISSO UMA VEZ, em `mcp/gerar.mjs`, e este
// arquivo é a mesma forma aplicada ao segundo lugar onde o defeito mora:
//
//   DERIVADO, NUNCA      nenhum número deste arquivo é digitado aqui. Cada fato
//   DIGITADO             tem uma FONTE em disco e uma derivação de uma linha.
//                        Não há duas fontes para divergir — há uma fonte e uma
//                        projeção dela dentro do texto.
//   UM COMANDO REGENERA  `node ferramental/numeros.mjs`
//   UM PORTÃO REPROVA    `--verificar` recalcula EM MEMÓRIA, compara com o que
//                        está escrito nos documentos e sai 1 se divergir. É o
//                        passo `numeros` do `verificar`, e é o que torna
//                        impossível commitar com documento velho.
//
// ZERO DEPENDÊNCIA, e aqui não é preferência: este arquivo roda no `verificar`
// da raiz, que precisa funcionar em clone limpo. Só built-in do Node.
//
// ─────────────────────────────────────────────────────────────────────────────
// (a) A FORMA DA MARCAÇÃO NO MARKDOWN — a decisão de projeto deste módulo.
//
// O documento precisa DIZER o número, e quem lê tem de continuar lendo markdown
// normal. Três formas foram pesadas contra três critérios: renderizar bem no
// GitHub, não poluir a leitura, e produzir diff pequeno na regeneração.
//
//   1. BLOCO GERADO INTEIRO, entre comentários HTML.
//      Rejeitada. O número do README quase nunca está sozinho: está DENTRO da
//      frase ("**16 determinísticas** derrubam o exit code", "o passo `mcp` do
//      portão — 5 de 11"). Um bloco gerado que contenha a frase faz o gerador
//      virar dono da PROSA, e prosa passa a morar num `.mjs` — que é a segunda
//      fonte que a §7.2 do plano proíbe, só que com a prosa do lado errado.
//      Custo de diff também é pior: o bloco reimprime inteiro por um dígito.
//
//   2. UMA TABELA ÚNICA GERADA, e o texto só aponta para ela.
//      Rejeitada, e é a pior das três para este repositório. Trocaria
//      "**17 determinísticas** derrubam o exit code" por "as determinísticas
//      (ver tabela) derrubam o exit code". O valor do README é o número estar
//      NA frase que o usa; empurrá-lo para uma tabela distante é a mesma
//      distância entre decisão e uso que o rebar acusa nos outros.
//
//   3. MARCADOR INLINE POR NÚMERO. ESCOLHIDA.
//        **<!--n regras.deterministicas-->17<!--/n--> determinísticas**
//      · RENDERIZA: comentário HTML é invisível no GitHub, e é inline legal em
//        CommonMark — o `**` continua abrindo ênfase forte porque vem depois de
//        espaço e antes de pontuação.
//      · NÃO POLUI: a prosa continua sendo do autor humano. O gerador é dono de
//        26 caracteres em volta do valor, e de mais nada.
//      · DIFF MÍNIMO: regenerar troca EXATAMENTE os dígitos que mudaram. Uma
//        regra nova mexe em 5 trechos do README; um bloco gerado mexeria em 5
//        blocos inteiros. Diff que ninguém revisa é diff que passa.
//      · BÔNUS não planejado: o marcador NOMEIA o fato. Quem abre o markdown
//        cru vê `regras.deterministicas` e sabe que não deve editar à mão — a
//        forma se documenta no lugar onde a tentação acontece.
//
// O CUSTO DA ESCOLHA, e ele é real: comentário HTML é invisível no markdown
// renderizado, mas VISÍVEL dentro de cerca de código — o GitHub imprime
// ```` ```bash ```` literalmente, comentário e tudo. Então FATO NÃO MORA DENTRO
// DE CERCA. A cerca mostra o COMANDO, que é copiável e não envelhece; o número
// que ele imprime vai na prosa ao lado. Isso não é contorno, é conserto: o
// README de hoje tem `npm run provar     # 50 casos` dentro de uma cerca — uma
// linha que a pessoa copia, cola, e recebe outro número. Uma cerca que mente é
// pior que uma cerca sem comentário.
//
// E para que a regra não dependa de alguém lembrar dela, `conferirCerca()` mais
// abaixo REPROVA marcador dentro de cerca, nomeando arquivo e linha. Defeito de
// renderização que sairia silencioso sai alto.
//
// ─────────────────────────────────────────────────────────────────────────────
// (b) ONDE PASSA A LINHA ENTRE FATO DERIVADO E MEDIÇÃO HISTÓRICA.
//
// Nem todo número de um documento é um fato desta árvore. "7 ocorrências e zero
// verdadeiros positivos no herz", "161 commits em seis repositórios", "8 de 9
// credenciais reais passaram" — isso é REGISTRO DE UMA MEDIÇÃO PASSADA, feita
// noutra máquina, noutra data, sobre árvore que não é esta. Derivar seria
// impossível; sobrescrever seria APAGAR HISTÓRIA, e a história é o que dá
// autoridade à regra. Fica escrito à mão, com data, e é assim que tem de ser.
//
// Um número entra neste catálogo se, e só se, passa nos TRÊS testes:
//
//   1. É propriedade DESTA árvore, agora — não de outro repositório, outra
//      máquina, outra data.
//   2. Muda quando o código muda, e SÓ então. Não muda com o relógio, e não
//      muda pelo próprio ato de ser registrado.
//   3. Tem derivação de uma linha, sem rede e sem rodar o produto.
//
// O TESTE 2 É O QUE EXCLUI A CONTAGEM DE COMMITS, e ela estava no pedido.
// `git rev-list --all --count` devolve 36 nesta árvore. Se o documento gravasse
// 36, o commit que grava 36 faria a contagem virar 37 — documento velho no
// instante seguinte, e o CI, que roda depois do commit, ficaria VERMELHO PARA
// SEMPRE. Um fato que muda por ser registrado é um portão que nunca fecha. O
// que entra no lugar são os números que só mudam quando alguém mexe no
// repositório: arquivos rastreados (o índice já reflete o `git add` antes do
// commit) e commits com trailer de coautoria (que a allowlist mantém em 0 e que
// só sai de 0 quando o invariante for violado — aí ficar vermelho é o certo).
//
// O TESTE 3 É O QUE EXCLUI "12 de 12 na própria régua". Esse número sai de
// RODAR o `rebar-check`, e quem já o trava é o passo `auto` do `verificar`.
// Derivá-lo aqui criaria a segunda fonte que a §7.2 proíbe, e ainda por cima
// duplicaria o passo mais caro do portão dentro do mais barato.
//
// ─────────────────────────────────────────────────────────────────────────────
// Uso:
//   node ferramental/numeros.mjs              reescreve os marcadores nos documentos
//   node ferramental/numeros.mjs --verificar  recalcula, compara, sai 1 se divergiu
//   node ferramental/numeros.mjs --fatos      lista os fatos, o valor e a fonte
//
// Códigos de saída — mesma disciplina do mcp/gerar.mjs, três coisas, três códigos:
//   0    escreveu, ou conferiu e bateu
//   1    DIVERGIU: o documento não diz o que a fonte diz hoje. Regenere. Também
//        é 1 o marcador malformado — quem errou foi o documento, e o conserto é
//        no documento.
//   2    a própria DERIVAÇÃO quebrou — fonte com forma inesperada, contagem que
//        não fecha. Domina o 1 pelo mesmo motivo que o 127 domina o 1 no
//        index.mjs: não se acusa o documento com um medidor torto.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')

/** Erro de DERIVAÇÃO — sai 2, nunca 1. Ver o bloco de códigos de saída acima. */
class Torto extends Error {}
const exigir = (condicao, mensagem) => {
  if (!condicao) throw new Torto(mensagem)
}

// ───────────────────────────────────────────────────────────────────── leitura

// `join` para o disco (Windows), barra normal para tudo que aparece na saída e
// nos marcadores: o `--verificar` roda no CI em matriz Windows + Linux, e um
// `ferramental\rebar-check\index.mjs` impresso num lado e não no outro faria a
// mesma árvore ter duas saídas.
const caminho = (rel) => join(RAIZ, ...rel.split('/'))
const existe = (rel) => existsSync(caminho(rel))

/**
 * Lê um arquivo do repositório, normalizando CRLF. O `.gitattributes` fixa LF,
 * mas um checkout com `autocrlf` ligado entrega CRLF ao Node — e aí toda
 * contagem de linha mudaria por causa de um byte que o git considera
 * inexistente.
 */
const ler = (rel) => readFileSync(caminho(rel), 'utf8').replace(/\r\n/g, '\n')

/**
 * Conta linhas como o `wc -l` conta: uma por quebra. É a contagem que os
 * documentos citam ("`mcp/gerar.mjs` · 902 linhas"), e o comando que a reproduz
 * está escrito ao lado de cada fato em `--fatos`.
 */
function contarLinhas(rel) {
  const texto = ler(rel)
  return texto.split('\n').length - (texto.endsWith('\n') ? 1 : 0)
}

/** Caminhos relativos de todos os arquivos sob `rel`, em ordem estável. */
function arquivosSob(rel, pular = () => false) {
  const saida = []
  const andar = (parcial) => {
    for (const nome of readdirSync(caminho(parcial)).sort()) {
      const filho = `${parcial}/${nome}`
      if (pular(filho, nome)) continue
      if (statSync(caminho(filho)).isDirectory()) andar(filho)
      else saida.push(filho)
    }
  }
  andar(rel)
  return saida
}

/** Uma linha do git, ou `null` se esta árvore não é um repositório git. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

const pt = (n) => n.toLocaleString('pt-BR')

// ─────────────────────────────────────────────────────────── os grupos de fato
//
// O NÚCLEO É OBRIGATÓRIO, O RESTO É POR GRUPO — e isto é a doutrina do N/A do
// próprio rebar-check, aplicada aqui pela mesma razão que o `mcp/gerar.mjs` a
// aplicou por seção: "o nada não conforma; o nada não se aplica".
//
// Uma árvore que não tem `novo/` não pode testemunhar sobre o gerador; uma que
// não é repositório git não pode testemunhar sobre arquivos rastreados. Gritar
// DIVERGIU ali seria acusar o documento de estar velho quando o que está
// incompleto é a árvore — a acusação errada, apontando para quem não errou.
//
// ONDE ISSO APARECE DE VERDADE: a prova deste passo, em
// `ferramental/verificar/provar-passos.mjs`, monta uma raiz temporária SEM
// `.git` e sem `dominios/`. Sem o N/A por grupo, aquela prova pediria ao
// medidor para acusar a ausência de coisas que ela mesma decidiu não copiar.
//
// O CUSTO, e ele é real: quem APAGAR o `novo/` do repositório de verdade faz
// este portão parar de conferir os números do gerador em silêncio. O que sobra
// contra isso é a linha ⚠ nomeando o grupo e a fonte que faltou — impressa
// mesmo quando o passo PASSA, porque o passo declara `avisar` no
// verificar.config.mjs.

/** As regras, do módulo que as exporta — a mesma fonte que o MCP deriva. */
async function grupoRegras() {
  const rel = 'ferramental/rebar-check/index.mjs'
  const mod = await import(pathToFileURL(caminho(rel)).href)
  const regras = mod.REGRAS
  exigir(Array.isArray(regras) && regras.length, `${rel}: REGRAS não é uma lista não vazia`)

  const por = (classe) => regras.filter((r) => r.classe === classe)
  const det = por('determinística')
  const heu = por('heurística')
  exigir(
    det.length + heu.length === regras.length,
    `${rel}: ${regras.length} regras, mas ${det.length} determinísticas + ${heu.length} ` +
      'heurísticas não fecham — apareceu uma terceira classe',
  )
  // A lista sai em crase e separada por `·` porque é a forma em que os dois
  // documentos já a imprimem. Formato de apresentação mora aqui e não no
  // documento pelo mesmo motivo que o valor mora: para não haver o que divergir.
  const lista = (rs) => rs.map((r) => `\`${r.id}\``).join(' · ')

  return {
    'regras.total': `${regras.length}`,
    'regras.deterministicas': `${det.length}`,
    'regras.heuristicas': `${heu.length}`,
    'regras.lista-deterministicas': lista(det),
    'regras.lista-heuristicas': lista(heu),
    'linhas.rebar-check': `${pt(contarLinhas(rel))}`,
  }
}

/** Os casos de prova, contados nos `caso.json` — o mesmo que o provar.mjs lê. */
function grupoProvas(totalDeRegras) {
  const base = 'ferramental/rebar-check/provas/casos'
  const pastas = readdirSync(caminho(base))
    .sort()
    .filter((n) => statSync(caminho(`${base}/${n}`)).isDirectory())

  const regras = new Set()
  for (const nome of pastas) {
    const rel = `${base}/${nome}/caso.json`
    exigir(existe(rel), `${rel}: pasta de caso sem caso.json`)
    let caso
    try {
      caso = JSON.parse(ler(rel))
    } catch (e) {
      throw new Torto(`${rel}: JSON inválido — ${e.message}`)
    }
    // Casa pelo campo `regra` DE DENTRO do caso, e não pelo nome da pasta: o
    // nome é convenção, o campo é declaração. Mesma escolha do mcp/gerar.mjs.
    exigir(caso.regra, `${rel}: sem campo "regra"`)
    regras.add(caso.regra)
  }
  exigir(pastas.length, `${base}/: nenhum caso de prova nesta árvore`)

  return {
    'provas.casos': `${pastas.length}`,
    'provas.regras-com-prova': `${regras.size}`,
    // COBERTURA É UMA FRAÇÃO DE DUAS FONTES, e a versão anterior desta linha
    // era `${regras.size} de ${regras.size}` — o mesmo número duas vezes.
    //
    // Achado da auditoria de 31/08, e é pior que número velho: aquele fato era
    // ESTRUTURALMENTE incapaz de estar errado. Se metade das regras perdesse a
    // prova, ele continuaria imprimindo "N de N", e o README vende justamente
    // essa frase como garantia de que toda regra nasce com dois casos. Número
    // que não pode acusar não é medição, é decoração — e decoração com cara de
    // medição é a coisa que este repositório existe para tirar do caminho.
    //
    // Agora o numerador vem dos `caso.json` e o denominador vem do catálogo de
    // regras do checker. São fontes diferentes, e é por serem diferentes que a
    // fração pode ficar desigual e acusar.
    'provas.cobertura': `${regras.size} de ${totalDeRegras}`,
    'provas.regras-sem-prova': `${Math.max(0, totalDeRegras - regras.size)}`,
  }
}

/** Os passos do portão, na ordem, do próprio verificar.config.mjs. */
async function grupoVerificar() {
  const rel = 'verificar.config.mjs'
  const mod = await import(pathToFileURL(caminho(rel)).href)
  const passos = mod.default
  exigir(Array.isArray(passos) && passos.length, `${rel}: o default export não é lista de passos`)
  const nomes = passos.map((p) => p.nome)
  exigir(
    nomes.every((n) => typeof n === 'string' && n),
    `${rel}: passo sem nome`,
  )

  const fatos = {
    'verificar.passos': `${passos.length}`,
    'verificar.lista-passos': nomes.map((n) => `\`${n}\``).join(' · '),
  }
  // Uma posição por passo, e não só a do `mcp` que o README cita hoje. É de
  // graça, e faz com que inserir um passo no meio conserte TODA citação de
  // posição de uma vez — que é exatamente o erro que o README carrega agora
  // ("5 de 11", quando são 12 passos e o `mcp` é o sexto).
  nomes.forEach((n, i) => {
    fatos[`verificar.posicao.${n}`] = `${i + 1} de ${passos.length}`
  })
  return fatos
}

/** O artefato do MCP e o servidor que o lê. */
function grupoMcp() {
  const relArtefato = 'mcp/regras.gerado.json'
  const bruto = ler(relArtefato)
  let a
  try {
    a = JSON.parse(bruto)
  } catch (e) {
    throw new Torto(`${relArtefato}: não é JSON — ${e.message}`)
  }
  exigir(Array.isArray(a.regras), `${relArtefato}: sem lista "regras"`)

  const relServidor = 'mcp/src/index.mjs'
  const ferramentas = [...ler(relServidor).matchAll(/registerTool\(\s*'([a-z_]+)'/g)]
  exigir(
    ferramentas.length,
    `${relServidor}: nenhum registerTool casado — o servidor mudou de forma`,
  )

  // O SERVIDOR NÃO INCLUI O CLIENTE DE PROVA. `mcp/src/prova-cliente.mjs` são
  // 370 linhas que exercitam o servidor de fora; somá-las daria 1.307 e o
  // documento diria que o servidor é 40% maior do que é.
  const linhasServidor = arquivosSob('mcp/src', (_f, nome) => nome === 'prova-cliente.mjs')
    .filter((f) => f.endsWith('.mjs'))
    .reduce((n, f) => n + contarLinhas(f), 0)

  return {
    'mcp.artefato.regras': `${a.regras.length}`,
    'mcp.artefato.niveis': `${a.niveis?.length ?? 0}`,
    'mcp.artefato.passos': `${a.portao?.passos.length ?? 0}`,
    'mcp.artefato.provas': `${a.regras.reduce((n, r) => n + (r.provas?.length || 0), 0)}`,
    // KB de documento, base 1000 — é a unidade em que os dois documentos já
    // escrevem "78 KB", e trocar a base agora criaria um diff que não é fato.
    'mcp.artefato.tamanho': `${Math.round(Buffer.byteLength(bruto, 'utf8') / 1000)} KB`,
    'mcp.ferramentas': `${ferramentas.length}`,
    'linhas.mcp-gerador': `${pt(contarLinhas('mcp/gerar.mjs'))}`,
    'linhas.mcp-servidor': `${pt(linhasServidor)}`,
  }
}

/** O gerador `rebar novo`: quantos passos ele anuncia e quanto é modelo. */
function grupoNovo() {
  const rel = 'novo/index.mjs'
  const fonte = ler(rel)
  // O gerador imprime `▸ 1/6`, `▸ 2/6` … O denominador É o número de passos, e
  // ele já está escrito no lugar onde erraria alto: se alguém acrescentar um
  // passo e esquecer o denominador, a conferência abaixo quebra com exit 2.
  const marcas = [...fonte.matchAll(/▸ (\d+)\/(\d+)\b/g)].map((m) => [+m[1], +m[2]])
  exigir(marcas.length, `${rel}: nenhuma marca "▸ n/m" — o gerador mudou de forma`)
  const total = marcas[0][1]
  exigir(
    marcas.every(([, m]) => m === total),
    `${rel}: as marcas "▸ n/m" não concordam no denominador`,
  )
  exigir(
    Math.max(...marcas.map(([n]) => n)) === total,
    `${rel}: o denominador das marcas é ${total}, mas o maior passo impresso é ` +
      `${Math.max(...marcas.map(([n]) => n))}`,
  )

  const todos = arquivosSob('novo', (_filho, nome) => nome === 'node_modules')
  // MODELO é o que o gerador COPIA para dentro do projeto criado, e a fronteira
  // não é adivinhada: é a pasta que carrega um `modelo.json`, que é a mesma
  // fechadura que o rebar-check usa para tirar esses arquivos da avaliação.
  const pastasModelo = todos
    .filter((f) => f.endsWith('/modelo.json'))
    .map((f) => f.slice(0, -'modelo.json'.length))
  exigir(pastasModelo.length, 'novo/: nenhum modelo.json — a fechadura de modelo sumiu')
  const modelo = todos.filter((f) => pastasModelo.some((p) => f.startsWith(p)))

  return {
    'novo.passos': `${total}`,
    'novo.arquivos': `${todos.length}`,
    'novo.arquivos-modelo': `${modelo.length}`,
  }
}

/** O que o git sabe. N/A inteiro quando esta árvore não é repositório git. */
function grupoGit() {
  const rastreados = git('ls-files')
  exigir(rastreados !== null, 'git ls-files não respondeu numa árvore que tem .git')
  const arquivos = rastreados.split('\n').filter(Boolean)
  const casos = 'ferramental/rebar-check/provas/casos/'

  const coautoria = git('log', '--all', '-i', '--grep=Co-authored-by', '--format=%H')
  const primeiro = git(
    'log',
    '--all',
    '--reverse',
    '--format=%ad',
    '--date=format:%Y-%m-%d %H:%M:%S',
  )

  return {
    'git.arquivos-rastreados': `${pt(arquivos.length)}`,
    'git.arquivos-fora-dos-casos': `${pt(arquivos.filter((f) => !f.startsWith(casos)).length)}`,
    // Só sai de 0 quando o `commit-msg` for burlado. Aí ficar vermelho é o
    // comportamento certo, e não o incômodo que a contagem total de commits seria.
    'git.commits-com-coautoria': `${(coautoria || '').split('\n').filter(Boolean).length}`,
    'git.primeiro-commit': (primeiro || '').split('\n')[0] || '(sem commit)',
  }
}

/** O manifesto: é dele que sai "única dependência: prettier". */
function grupoPacote() {
  const rel = 'package.json'
  const pkg = JSON.parse(ler(rel))
  const dev = Object.entries(pkg.devDependencies || {})
  return {
    'pacote.dependencias': `${Object.keys(pkg.dependencies || {}).length}`,
    'pacote.dev-dependencias': dev.map(([n, v]) => `\`${n}\` ${v}`).join(' · ') || 'nenhuma',
  }
}

/** O domínio provado contra PostgreSQL real. */
function grupoDominio() {
  const rel = 'dominios/privilegio-de-banco/privilegio.test.mjs'
  const testes = [...ler(rel).matchAll(/^\s*test\(/gm)].length
  exigir(testes, `${rel}: nenhum test( casado — a suíte mudou de forma`)
  return { 'dominio.privilegio.testes': `${testes}` }
}

/**
 * Grupo → fontes que ele EXIGE. A mesma tabela decide o que é gerado e o que é
 * comparado, para que derivar e conferir nunca divirjam.
 */
const GRUPOS = [
  { chave: 'regras', exige: ['ferramental/rebar-check/index.mjs'], montar: grupoRegras },
  { chave: 'provas', exige: ['ferramental/rebar-check/provas/casos'], montar: grupoProvas },
  { chave: 'verificar', exige: ['verificar.config.mjs'], montar: grupoVerificar },
  {
    chave: 'mcp',
    exige: ['mcp/regras.gerado.json', 'mcp/src/index.mjs', 'mcp/gerar.mjs'],
    montar: grupoMcp,
  },
  { chave: 'novo', exige: ['novo/index.mjs'], montar: grupoNovo },
  { chave: 'git', exige: ['.git'], montar: grupoGit },
  { chave: 'pacote', exige: ['package.json'], montar: grupoPacote },
  {
    chave: 'dominio',
    exige: ['dominios/privilegio-de-banco/privilegio.test.mjs'],
    montar: grupoDominio,
  },
]

/** Deriva o que esta árvore consegue derivar, e diz o que ficou de fora. */
async function derivar() {
  const fatos = new Map()
  const ausentes = []
  for (const g of GRUPOS) {
    const faltando = g.exige.filter((r) => !existe(r))
    if (faltando.length) {
      ausentes.push({ chave: g.chave, faltando })
      continue
    }
    // O grupo `provas` recebe o total de regras porque cobertura é fração de
    // DUAS fontes — ver a nota em `grupoProvas`. Os grupos correm em ordem de
    // declaração, e `regras` vem antes de `provas` por isso.
    const jaDerivado = fatos.get('regras.total')?.valor
    for (const [id, valor] of Object.entries(await g.montar(Number(jaDerivado)))) {
      exigir(!fatos.has(id), `fato "${id}" derivado por dois grupos — id duplicado`)
      exigir(typeof valor === 'string' && valor.length, `fato "${id}" veio vazio`)
      fatos.set(id, { valor, grupo: g.chave, fonte: g.exige[0] })
    }
  }
  exigir(fatos.size, 'nenhum grupo pôde ser derivado nesta árvore — não há o que conferir')
  return { fatos, ausentes }
}

// ────────────────────────────────────────────────────── os documentos e o texto

// A GRAMÁTICA, e ela é minúscula de propósito: um par de comentários HTML, o id
// no de abertura, nada no de fechamento. Repetir o id no fechamento ajudaria em
// região longa; aqui a região é um valor curto, e repetir dobraria a poluição
// justamente no critério em que esta forma ganha das outras duas.
const MARCADOR = /<!--n ([a-z0-9][a-z0-9.\-]*)-->([\s\S]*?)<!--\/n-->/g
const ABERTURA = /<!--n ([a-z0-9][a-z0-9.\-]*)-->/g

/**
 * Todo `.md` da árvore é governado — não uma lista fixa de dois nomes.
 *
 * Registrar documento à mão é a mesma classe de defeito que este módulo existe
 * para matar: alguém põe marcador no `docs/STACK.md`, esquece de registrar o
 * arquivo, e o portão fica mudo sobre um número que passou a existir. Aqui o
 * marcador basta: onde ele está, o portão confere.
 *
 * `provas/casos/` fica FORA porque material de prova é byte-exato — é a mesma
 * razão que já o tira do prettier, e reescrever um `README.md` de fixture
 * mudaria o que a regra está lendo.
 */
function documentos() {
  const forade = new Set(['node_modules', '.git'])
  const casos = 'ferramental/rebar-check/provas/casos'
  const saida = []
  const andar = (parcial) => {
    for (const nome of readdirSync(caminho(parcial)).sort()) {
      if (forade.has(nome)) continue
      const filho = parcial ? `${parcial}/${nome}` : nome
      if (filho === casos) continue
      if (statSync(caminho(filho)).isDirectory()) andar(filho)
      else if (nome.endsWith('.md')) saida.push(filho)
    }
  }
  andar('')
  return saida
}

/** Linhas (1-based) que caem dentro de cerca de código. */
function linhasEmCerca(texto) {
  const dentro = new Set()
  let aberta = false
  texto.split('\n').forEach((linha, i) => {
    if (/^\s{0,3}(```|~~~)/.test(linha)) {
      aberta = !aberta
      dentro.add(i + 1)
      return
    }
    if (aberta) dentro.add(i + 1)
  })
  return dentro
}

const linhaDe = (texto, indice) => texto.slice(0, indice).split('\n').length

/**
 * Acha os marcadores de um documento. Devolve também os DEFEITOS de forma —
 * abertura sem fechamento e marcador dentro de cerca —, porque marcador que não
 * casa é pior que marcador ausente: o número fica lá, parecendo conferido.
 */
/**
 * Marcador que ABRE parágrafo quebra o markdown renderizado, e por isso é
 * recusado aqui em vez de confiado à memória de quem escreve.
 *
 * No CommonMark, comentário HTML na coluna 0 abre um BLOCO HTML (tipo 2) quando
 * inicia um bloco — e o resto daquela linha sai como HTML cru, então as crases
 * viram literais em vez de código. No MEIO do parágrafo é inofensivo: bloco
 * HTML tipo 2 não interrompe parágrafo em andamento.
 *
 * Achado da auditoria de 31/08: 30 linhas começavam com marcador, e 4 delas
 * abriam parágrafo de verdade — o README mostrava crase literal para quem lê no
 * GitHub. O conserto na prosa é de uma palavra ("São elas: "), e a frase até
 * melhora; o que faltava era alguém avisar.
 */
function abreParagrafo(linhas, i) {
  if (!linhas[i].startsWith('<!--n ')) return false
  const anterior = i > 0 ? linhas[i - 1] : ''
  return !anterior.trim() || /^(#|\||```|---)/.test(anterior)
}

function marcadoresDe(rel) {
  const texto = ler(rel)
  const cerca = linhasEmCerca(texto)
  const achados = []
  const defeitos = []
  const casaram = new Set()

  for (const m of texto.matchAll(MARCADOR)) {
    const linha = linhaDe(texto, m.index)
    casaram.add(m.index)
    if (cerca.has(linha)) {
      defeitos.push(
        `${rel}:${linha}: marcador "${m[1]}" DENTRO de cerca de código — o GitHub ` +
          'imprime o comentário como texto. Deixe o comando na cerca e o número na prosa ao lado.',
      )
      continue
    }
    achados.push({ arquivo: rel, id: m[1], linha, atual: m[2] })
  }

  // Abertura sem fechamento não aparece no casamento acima; sem esta varredura
  // ela some em silêncio, e o número que ela cerca deixa de ser conferido sem
  // que nada mude na tela.
  //
  // A comparação é por ÍNDICE e não por linha, e a diferença foi medida: com
  // linha, uma linha que carrega um marcador fechado e outro aberto — que é
  // exatamente a forma de uma célula de tabela com dois números — dava a
  // abertura órfã por fechada e voltava a ficar muda.
  for (const m of texto.matchAll(ABERTURA)) {
    const linha = linhaDe(texto, m.index)
    if (!casaram.has(m.index) && !cerca.has(linha)) {
      defeitos.push(`${rel}:${linha}: marcador "${m[1]}" aberto e nunca fechado com <!--/n-->`)
    }
  }
  // Marcador que ABRE parágrafo — ver `abreParagrafo`. Fica por último porque
  // é o único defeito que não impede a conferência do número: ele quebra o
  // RENDER, não a derivação. Mas quebra para quem lê no GitHub, que é o único
  // leitor que este arquivo tem.
  const linhas = texto.split(String.fromCharCode(10))
  for (let i = 0; i < linhas.length; i++) {
    if (cerca.has(i + 1)) continue
    if (abreParagrafo(linhas, i)) {
      defeitos.push(
        `${rel}:${i + 1}: marcador ABRE parágrafo — no CommonMark isso vira bloco HTML e ` +
          'o resto da linha sai como HTML cru (as crases viram literais). Ponha uma palavra ' +
          'de prosa antes, como "São elas: ".',
      )
    }
  }

  return { texto, achados, defeitos }
}

/** Reescreve os marcadores conhecidos. Devolve o texto novo e quantos mudaram. */
function reescrever(texto, fatos) {
  let trocados = 0
  const novo = texto.replace(MARCADOR, (inteiro, id, atual) => {
    const fato = fatos.get(id)
    if (!fato || fato.valor === atual) return inteiro
    trocados++
    return `<!--n ${id}-->${fato.valor}<!--/n-->`
  })
  return { novo, trocados }
}

// ──────────────────────────────────────────────────────── comparar e escrever

/**
 * Recorte pelo MEIO, e não pelo fim, e a diferença foi medida.
 *
 * `regras.lista-deterministicas` são 17 ids em crase — 300 caracteres. Colados
 * inteiros duas vezes (velho e novo) empurram as outras divergências para fora
 * da tela com o `limite: 12` do passo. Mas cortar pelo FIM é pior que cortar
 * muito: a lista cresce no fim, então as duas linhas sairiam IDÊNTICAS na tela
 * e o dono leria "mudou" sem ver o quê. Guardando começo e fim, `· hex-cru`
 * aparece na linha `+` e não na `-`, que é a notícia inteira em três palavras.
 * O valor completo sai em `--fatos`.
 */
const recortar = (s) => (s.length > 110 ? `${s.slice(0, 60)}…${s.slice(-45)}` : s)

/** ⚠ nomeando cada grupo que ESTA árvore não soube derivar, e o que faltou. */
function avisarAusentes(ausentes) {
  for (const a of ausentes) {
    console.error(
      `  ⚠ grupo "${a.chave}" NÃO derivado nem conferido — falta ${a.faltando.join(', ')} nesta árvore`,
    )
  }
}

/**
 * ⚠ quando ninguém marcou nada ainda.
 *
 * Documento sem marcador é N/A, e não reprovação: gritar DIVERGIU sobre um
 * README que ainda não foi marcado é acusar o documento de estar velho quando o
 * que falta é a marcação — a acusação errada, apontando para quem não errou. É
 * o mesmo `na()` do rebar-check.
 *
 * O CUSTO, e é a fresta que esta decisão abre: enquanto nenhum marcador
 * existir, este portão confere zero números. Contra isso sobra esta linha, e
 * ela sai MESMO QUANDO O PASSO PASSA, porque o passo `numeros` do
 * verificar.config.mjs declara `avisar: /^\s*⚠/`. O buraco aparece em toda
 * rodada do `verificar` até alguém fechá-lo.
 */
function avisarSemMarcador(docs, fatos) {
  // UMA linha só, e o ponteiro do conserto vai DENTRO dela. O executor do
  // `verificar` extrai por linha com `avisar: /^\s*⚠/`; um segundo parágrafo
  // explicativo sem o ⚠ seria descartado ali, e o aviso chegaria ao dono sem
  // dizer o que fazer — que é a mesma queixa que a `dica` de cada passo existe
  // para não repetir.
  console.error(
    `  ⚠ nenhum marcador em ${docs.length} documento(s) markdown — este portão confere 0 dos ` +
      `${fatos.size} fatos que sabe derivar. Marque assim: <!--n regras.deterministicas-->` +
      '17<!--/n--> · a lista de ids sai em `node ferramental/numeros.mjs --fatos`',
  )
}

function escrever(fatos, ausentes) {
  avisarAusentes(ausentes)
  const docs = documentos()
  const defeitos = []
  const escritos = []
  let marcadores = 0

  for (const rel of docs) {
    const { texto, achados, defeitos: d } = marcadoresDe(rel)
    defeitos.push(...d)
    marcadores += achados.length
    const desconhecidos = achados.filter((a) => !fatos.has(a.id))
    for (const a of desconhecidos) {
      defeitos.push(`${a.arquivo}:${a.linha}: "${a.id}" não é um fato derivável (veja --fatos)`)
    }
    if (!achados.length) continue
    const { novo, trocados } = reescrever(texto, fatos)
    if (!trocados) continue
    // Idempotente de propósito: bytes só são tocados quando um valor mudou. É o
    // que impede uma regeneração de sujar o diff de um commit que não mexeu em
    // número nenhum.
    writeFileSync(caminho(rel), novo, 'utf8')
    escritos.push(`${rel} (${trocados})`)
  }

  if (defeitos.length) {
    for (const d of defeitos) console.error(`  erro ${d}`)
    return 1
  }
  if (!marcadores) {
    avisarSemMarcador(docs, fatos)
    return 0
  }
  console.log(
    escritos.length
      ? `numeros: reescrito ${escritos.join(', ')} · ${marcadores} marcador(es) · ${fatos.size} fato(s)`
      : `numeros: ${marcadores} marcador(es) em ${docs.length} documento(s) já em dia`,
  )
  return 0
}

function conferir(fatos, ausentes) {
  avisarAusentes(ausentes)
  const docs = documentos()
  const defeitos = []
  const divergencias = []
  const naoDerivados = []
  let marcadores = 0

  for (const rel of docs) {
    const { achados, defeitos: d } = marcadoresDe(rel)
    defeitos.push(...d)
    marcadores += achados.length
    for (const a of achados) {
      const fato = fatos.get(a.id)
      if (!fato) {
        // Fato de grupo N/A nesta árvore não é divergência — é N/A, e sai como
        // ⚠. Fato que NENHUM grupo produz é defeito do documento, e sai como
        // erro: o id foi digitado errado, ou o fato deixou de existir.
        const naGrupo = ausentes.some((x) => a.id.startsWith(`${x.chave}.`))
        if (naGrupo) naoDerivados.push(`${a.arquivo}:${a.linha} ${a.id}`)
        else
          defeitos.push(`${a.arquivo}:${a.linha}: "${a.id}" não é um fato derivável (veja --fatos)`)
        continue
      }
      if (fato.valor !== a.atual) divergencias.push({ ...a, esperado: fato.valor })
    }
  }

  if (defeitos.length) {
    console.error(`numeros --verificar: DIVERGIU. ${defeitos.length} marcador(es) malformado(s).`)
    for (const d of defeitos) console.error(`  erro ${d}`)
    console.error('\n  Conserto: no documento, não aqui.')
    return 1
  }
  for (const n of naoDerivados) {
    console.error(`  ⚠ marcador não conferido nesta árvore (grupo N/A): ${n}`)
  }

  if (divergencias.length) {
    console.error(
      `numeros --verificar: DIVERGIU. ${divergencias.length} número(s) escrito(s) nos ` +
        'documentos não são o que a fonte diz hoje.',
    )
    // FORMA DE DIFF UNIFICADO, e não é estética: o passo `numeros` do
    // verificar.config.mjs extrai da saída com /^\s*(erro|✗|[-+] )/, e sem o
    // `- `/`+ ` no começo nada casa e o executor cai nas últimas linhas — que
    // seriam a linha de conserto, não o que mudou. O ARQUIVO E A LINHA vão em
    // cada linha, e não num cabeçalho acima: linha extraída sozinha tem de
    // dizer sozinha onde consertar.
    //
    // Teto de 12, o mesmo `limite` que o passo impõe: imprimir mais é escrever
    // para um recorte que já cortou.
    for (const d of divergencias.slice(0, 12)) {
      console.error(
        `  - ${d.arquivo}:${d.linha} ${d.id} = ${recortar(d.atual)}   (documento, velho)`,
      )
      console.error(`  + ${d.arquivo}:${d.linha} ${d.id} = ${recortar(d.esperado)}   (fonte, hoje)`)
    }
    if (divergencias.length > 12) {
      console.error(`  … e mais ${divergencias.length - 12} número(s).`)
    }
    console.error('\n  Conserto: node ferramental/numeros.mjs')
    return 1
  }

  if (!marcadores) {
    avisarSemMarcador(docs, fatos)
    return 0
  }
  console.log(
    `numeros --verificar: em dia · ${marcadores} marcador(es) em ${docs.length} documento(s) · ` +
      `${fatos.size} fato(s) deriváveis` +
      `${ausentes.length ? ` · ${ausentes.length} grupo(s) N/A nesta árvore` : ''}`,
  )
  return 0
}

/** O catálogo na tela: é o que a próxima frente lê para saber o que marcar. */
function listarFatos(fatos, ausentes) {
  avisarAusentes(ausentes)
  const usados = new Map()
  for (const rel of documentos()) {
    for (const a of marcadoresDe(rel).achados) {
      usados.set(a.id, (usados.get(a.id) || 0) + 1)
    }
  }
  console.log(`${fatos.size} fato(s) deriváveis · ${usados.size} já marcado(s) em documento\n`)
  let grupo = null
  for (const [id, f] of fatos) {
    if (f.grupo !== grupo) {
      grupo = f.grupo
      console.log(`── ${grupo}  (fonte: ${f.fonte})`)
    }
    const marcas = usados.get(id)
    console.log(`  ${marcas ? `${marcas}×` : ' ·'} ${id.padEnd(34)} ${f.valor}`)
  }
  return 0
}

// ───────────────────────────────────────────────────────────────────── programa

const args = process.argv.slice(2)
const desconhecidas = args.filter((a) => !/^--(verificar|fatos)$/.test(a))
if (desconhecidas.length) {
  console.error(`numeros: opção desconhecida: ${desconhecidas.join(', ')}`)
  console.error('uso: node ferramental/numeros.mjs [--verificar | --fatos]')
  process.exit(2)
}

let fatos
let ausentes
try {
  ;({ fatos, ausentes } = await derivar())
} catch (e) {
  // Derivação torta sai 2 e NUNCA 1: 1 quer dizer "o documento está velho,
  // regenere", e mandar regenerar com o medidor quebrado é mandar gravar número
  // errado por cima de número certo.
  console.error(`numeros: a DERIVAÇÃO quebrou — ${e.message}`)
  if (!(e instanceof Torto)) console.error(e.stack)
  process.exit(2)
}

process.exit(
  args.includes('--fatos')
    ? listarFatos(fatos, ausentes)
    : args.includes('--verificar')
      ? conferir(fatos, ausentes)
      : escrever(fatos, ausentes),
)
