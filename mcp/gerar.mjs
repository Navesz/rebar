#!/usr/bin/env node
// gerar.mjs — o MCP não é escrito à mão. Este arquivo é quem o escreve.
//
// POR QUE ELE EXISTE. O defeito que o dono viveu no Herz e no BMB Compras não
// foi "faltou MCP": foi que o MCP CONTINUOU SERVINDO A REGRA VELHA depois que a
// regra mudou, e ninguém percebeu. Medido neste repositório em 01/09/2026,
// antes desta linha existir: `mcp/` tinha 182 linhas de servidor que serviam
// PROSA do plano por seção, NUNCA tinham rodado (as dependências nunca foram
// instaladas), NENHUM passo do `verificar` as tocava e NENHUMA regra as cobria —
// enquanto o `rebar-check` ao lado já impunha 22 regras que o MCP não conhecia.
// É o diagnóstico que abre o plano, cometido dentro do próprio repositório:
// decisão que mora onde nenhuma máquina lê.
//
// O desenho é o da §7.2 do docs/PLANO.md, e as três linhas dela governam este
// arquivo inteiro:
//
//   ARTEFATO GERADO      o servidor MCP não guarda regra escrita à mão. Ele lê
//                        `regras.gerado.json`, que sai daqui.
//   PORTÃO DE FRESCOR    `--verificar` regenera EM MEMÓRIA e compara com o
//                        disco. Divergiu, sai 1. É o que torna impossível mudar
//                        a regra e esquecer o MCP.
//   DERIVADO, NUNCA      nenhum fato deste arquivo é digitado aqui. Cada campo
//   DUPLICADO            do artefato tem uma FONTE em disco, e o artefato
//                        carrega o sha256 de cada uma. Não há duas fontes para
//                        divergir — há uma fonte e uma projeção dela.
//
// ZERO DEPENDÊNCIA, e aqui não é preferência: este arquivo roda no `verificar`
// da RAIZ, que não instala o `mcp/node_modules`. Só built-in do Node. O `mcp/`
// como pacote pode ter dependência; o portão de frescor não pode, ou o portão
// passa a depender do que ele está conferindo.
//
// Uso:
//   node mcp/gerar.mjs              escreve mcp/regras.gerado.json
//   node mcp/gerar.mjs --verificar  regenera em memória, compara, sai 1 se divergiu
//   node mcp/gerar.mjs --resumo     imprime o que seria gerado, sem escrever
//
// Códigos de saída — mesma disciplina do index.mjs, três coisas, três códigos:
//   0    escreveu, ou conferiu e bateu
//   1    DIVERGIU: o disco não é o que a fonte produz hoje. Regenere.
//   2    a própria GERAÇÃO quebrou — fonte ausente, forma inesperada, contagem
//        que não fecha. Domina o 1 pelo mesmo motivo que o 127 domina o 1 no
//        index.mjs: não se acusa o disco com um gerador que está torto.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { REGRAS } from '../ferramental/rebar-check/index.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')
const ARTEFATO = join(AQUI, 'regras.gerado.json')

/** Erro de GERAÇÃO — sai 2, nunca 1. Ver o bloco de códigos de saída acima. */
class Torto extends Error {}
const exigir = (condicao, mensagem) => {
  if (!condicao) throw new Torto(mensagem)
}

// ───────────────────────────────────────────────────────────────── leitura

/**
 * Lê um arquivo do repositório com caminho POSIX estável.
 *
 * `join` para o disco (Windows), barra normal para o que entra no artefato: o
 * artefato é comparado byte a byte entre Windows e Linux no CI em matriz, e um
 * `ferramental\\rebar-check\\index.mjs` gravado lá dentro faria o portão de
 * frescor reprovar em metade da matriz por causa da barra, sem que nada de
 * fato tivesse mudado.
 */
function ler(rel) {
  const abs = join(RAIZ, ...rel.split('/'))
  exigir(existsSync(abs), `fonte ausente: ${rel}`)
  // Normaliza CRLF. O .gitattributes fixa LF no repositório, mas um checkout com
  // autocrlf ligado entrega CRLF ao Node, e aí o sha256 e o corte de comentário
  // mudariam por causa de um byte que o git considera inexistente.
  return readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
}

const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')

const linhaDe = (texto, indice) => texto.slice(0, indice).split('\n').length

/** Acha a linha (1-based) da primeira ocorrência do padrão, ou quebra. */
function linhaDoPadrao(texto, padrao, rel) {
  const m = padrao.exec(texto)
  exigir(m, `${rel}: não achei ${padrao} — a fonte mudou de forma`)
  return linhaDe(texto, m.index)
}

// ───────────────────────────────────────────────── comentário → o "porque"
//
// A PARTE CARA, e a escolha tem custo que fica escrito.
//
// O `porque` de cada regra — o número medido que justifica a decisão, "417
// arquivos, uma acusação, zero falsos", "43 arquivos com prova no nome e a
// regra enxergava zero" — mora em COMENTÁRIO no `index.mjs`. Uma IA que recebe
// "não use telefone no código" ignora; uma que recebe "um verdadeiro positivo e
// zero falsos em 417 arquivos, e o PR que tentou mover para env var foi parado
// porque o wa.me sobe sem destinatário" não ignora. É por isso que o comentário
// é o conteúdo, e não enfeite.
//
// A FORMA ESCOLHIDA: `porque` é UMA lista de parágrafos, cada um com a LINHA de
// onde saiu e um rótulo `onde` — `cabecalho` (entre o `{` da regra e a chave
// `checar:`, mais o bloco contíguo acima do `{`) ou `implementacao` (dentro do
// corpo do `checar`). Linha `//` vazia separa parágrafo; item de lista abre o
// seu.
//
// A PRIMEIRA VERSÃO DESTA FUNÇÃO CORTAVA em dois campos, `porque` só do
// cabeçalho e `notas` do corpo, e a medição derrubou o corte: das 22 regras, 15
// ficavam com `porque` VAZIO — e não por falta de razão. A razão do `hex-cru`
// ("a versão ingênua desta regra deu 100% de falso positivo quando medida"), a
// do `coautoria-ia` inteira e a do `dependabot` ("quatro regras sumindo é o que
// fazia 9 de 10 virar 6 de 6") estão escritas DENTRO do `checar`. Um artefato
// que entregasse `porque: []` para 15 de 22 regras ensinaria o modelo que
// aquelas regras são arbitrárias, que é o oposto exato do que este campo existe
// para fazer. O rótulo `onde` preserva a distinção sem esconder o número: quem
// quiser só a razão de decisão filtra por `cabecalho`.
//
// O CUSTO que sobra: a classificação é POSICIONAL, não semântica. Um comentário
// de implementação pura ("60 caracteres bastam para o const mais folgado") vem
// junto, rotulado `implementacao`. Preferi ruído rotulado a silêncio.
//
// A FORMA MELHOR, e que não está disponível: um campo `porque:` na própria
// regra. Zero parsing, zero fragilidade, e o `porque` passaria a ser conferido
// pelo prettier e pelo próprio `export`. Custa 22 edições no `index.mjs`, e a
// permissão desta frente é de UM toque só (o `export const REGRAS`). Fica
// registrado como o próximo movimento: quando alguém puder editar as 22 regras,
// mover `porque` para dentro do objeto apaga este bloco inteiro.
//
// A FRAGILIDADE é conhecida e está CONTIDA, não ignorada: o casamento depende
// da forma que o prettier impõe (`  {` na coluna 2, chaves na coluna 4). Se ela
// mudar, o parser não devolve texto vazio em silêncio — a conferência lá
// embaixo compara a lista casada no TEXTO com o array `REGRAS` IMPORTADO, id a
// id, e sai 2. Regra que suma do artefato é o defeito que este módulo existe
// para não cometer; ela some ALTO ou não some.

/** Tira o `//` e o espaço, e devolve `null` para régua decorativa (`── … ──`). */
function limparComentario(linha) {
  const m = /^\s*\/\/ ?(.*)$/.exec(linha)
  if (!m) return undefined
  const texto = m[1].replace(/\s+$/, '')
  // Régua de seção (`── determinísticas ─────`) e caixa de moldura não são
  // razão de nada: são navegação para o olho humano.
  if (!texto || /^[─—\-=·\s]+$/.test(texto)) return ''
  if (/^[─—]{2,}.*[─—]{2,}$/.test(texto)) return ''
  return texto
}

/**
 * Junta linhas de comentário em parágrafos. Linha vazia abre parágrafo novo;
 * dentro do parágrafo as linhas viram uma frase só, porque a quebra do fonte é
 * do printWidth 100 do prettier e não do autor.
 *
 * Item de lista (`1.`, `·`, `-`) abre parágrafo por conta própria: sem isto, as
 * quatro conclusões numeradas do `conteudo-fora-do-codigo` — que são o motivo
 * de a regra continuar heurística — viravam um parágrafo de 40 linhas.
 */
function paragrafos(linhas, onde, primeiraLinha = 0) {
  const saida = []
  let atual = []
  let abriuEm = 0
  const fechar = () => {
    const texto = atual.join(' ').replace(/\s+/g, ' ').trim()
    if (texto) saida.push({ onde, linha: abriuEm, texto })
    atual = []
  }
  linhas.forEach((bruta, i) => {
    const t = limparComentario(bruta)
    if (t === undefined) return
    if (t === '') return fechar()
    if (/^(\d+\.|[·•*]|[-–—] )/.test(t)) fechar()
    if (!atual.length) abriuEm = primeiraLinha + i
    atual.push(t)
  })
  fechar()
  return saida
}

/** O mesmo, quando o consumidor só quer o texto (decisões, sem linha). */
const soTexto = (ps) => ps.map((p) => p.texto)

/**
 * Casa cada objeto de regra no TEXTO do index.mjs e devolve cabeçalho, corpo e
 * linha. Não interpreta código: só usa a indentação que o prettier garante.
 */
function regrasNoTexto(fonte, rel) {
  const linhas = fonte.split('\n')
  const inicioArray = linhas.findIndex((l) => /^export const REGRAS = \[$/.test(l))
  exigir(
    inicioArray >= 0,
    `${rel}: não achei "export const REGRAS = [" — o toque do gerador na fonte da verdade sumiu`,
  )

  const achadas = []
  for (let i = inicioArray + 1; i < linhas.length; i++) {
    if (linhas[i] === ']') break
    if (linhas[i] !== '  {') continue

    // O bloco `//` contíguo ACIMA do `{` pertence a esta regra.
    const acima = []
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(linhas[j]); j--) acima.unshift(linhas[j])

    let fim = i + 1
    while (fim < linhas.length && linhas[fim] !== '  },') fim++
    exigir(fim < linhas.length, `${rel}: objeto de regra aberto na linha ${i + 1} e nunca fechado`)

    const dentro = linhas.slice(i + 1, fim)
    const iChecar = dentro.findIndex((l) => /^    checar:/.test(l))
    exigir(iChecar >= 0, `${rel}: regra na linha ${i + 1} sem chave "checar:" na coluna 4`)

    const mId = /^    id: '([^']+)',$/.exec(dentro[0])
    exigir(mId, `${rel}: regra na linha ${i + 1} não começa por "id: '…'," na coluna 4`)

    achadas.push({
      id: mId[1],
      linha: i + 2, // a linha do `id:`, que é onde um humano vai procurar
      porque: [
        // `i + 1 - acima.length` é a linha (1-based) da primeira `//` do bloco
        // acima do `{`; `i + 3` é a linha da chave logo depois do `id:`.
        ...paragrafos(acima, 'cabecalho', i + 1 - acima.length),
        ...paragrafos(dentro.slice(1, iChecar), 'cabecalho', i + 3),
        ...paragrafos(dentro.slice(iChecar), 'implementacao', i + 2 + iChecar),
      ],
    })
    i = fim
  }
  return achadas
}

// ─────────────────────────────────────────────────────────────────── provas
//
// `provas/casos/<regra>[__<variante>]/caso.json` já é JSON, com um campo
// `porque` escrito à mão para explicar O QUE O CASO TRAVA. É a fonte de
// `porque` mais barata do repositório: zero parsing, zero fragilidade.
//
// Casa pelo campo `regra` DE DENTRO do caso.json, e não pelo nome da pasta: o
// nome da pasta é convenção, o campo é declaração. Um caso cuja pasta se chama
// `telefone__digito-cru` mas declara outra regra é defeito, e sai 2.
//
// O `porque` entra INTEIRO, sem corte. Cortar aqui criaria a segunda fonte que
// a §7.2 proíbe: o artefato diria uma coisa e o caso.json outra, e a divergência
// seria invisível porque o corte é determinístico. Quem decide o que cabe numa
// resposta é o servidor, na hora de responder — não o gerador, para sempre.

function lerProvas(idsValidos) {
  const relBase = 'ferramental/rebar-check/provas/casos'
  const base = join(RAIZ, ...relBase.split('/'))
  exigir(existsSync(base), `fonte ausente: ${relBase}/`)

  const porRegra = new Map(idsValidos.map((id) => [id, []]))
  const arquivos = []
  for (const nome of readdirSync(base).sort()) {
    const dir = join(base, nome)
    if (!statSync(dir).isDirectory()) continue
    const rel = `${relBase}/${nome}/caso.json`
    const bruto = ler(rel)
    arquivos.push({ rel, bruto })

    let caso
    try {
      caso = JSON.parse(bruto)
    } catch (e) {
      throw new Torto(`${rel}: JSON inválido — ${e.message}`)
    }
    exigir(
      porRegra.has(caso.regra),
      `${rel}: declara a regra "${caso.regra}", que não existe em REGRAS`,
    )
    porRegra.get(caso.regra).push({
      caso: nome,
      // Estado esperado de cada lado. Omitido, o provar.mjs assume
      // aprovar=passou / reprovar=reprovou — o padrão é replicado aqui porque é
      // ele que diz se o caso trava um ramo N/A, e ramo N/A é metade do valor.
      aprovar: existsSync(join(dir, 'aprovar')) ? caso.aprovar?.estado || 'passou' : null,
      reprovar: existsSync(join(dir, 'reprovar')) ? caso.reprovar?.estado || 'reprovou' : null,
      porque: caso.porque || null,
    })
  }

  // sha256 de todos os caso.json juntos, em ordem de caminho: um hash só para 52
  // arquivos. Trocar o `porque` de um caso muda este hash e o portão acusa.
  const impressao = sha256(arquivos.map((a) => `${a.rel}\n${a.bruto}`).join('\n'))
  return { porRegra, quantos: arquivos.length, impressao, relBase }
}

// ──────────────────────────────────────────────────── taxonomia N0–N7

/**
 * A tabela de níveis do docs/PLANO.md §4. É markdown, mas é TABELA — colunas
 * fixas, oito linhas, uma por nível. Ler a tabela é derivar; transcrever o que
 * ela diz para dentro deste arquivo seria a cópia que a §7.2 proíbe.
 *
 * Quebra se a tabela sumir ou encolher, e essa é a intenção: o `nivel` de toda
 * regra aponta para esta tabela, e um artefato que diz "N1" sem saber o que N1
 * significa entrega ao modelo um rótulo sem conteúdo.
 */
function lerNiveis(rel) {
  const fonte = ler(rel)
  const linhas = []
  for (const m of fonte.matchAll(/^\|\s*\*\*(N[0-7])\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/gm)) {
    const limpo = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim()
    linhas.push({
      nivel: m[1],
      oQueE: limpo(m[2]),
      falhaComo: limpo(m[3]).replace(/^"|"$/g, ''),
      custoPorSessao: limpo(m[4]),
      linha: linhaDe(fonte, m.index),
    })
  }
  exigir(
    linhas.length === 8,
    `${rel}: a tabela N0–N7 da §4 devolveu ${linhas.length} linhas, e não 8`,
  )
  return { linhas, fonte }
}

// ─────────────────────────────────────────────────────── códigos de saída

/**
 * Os códigos de saída do rebar-check, do bloco "Códigos de saída" do cabeçalho
 * do index.mjs. Uma IA que não sabe que 127 é DEFEITO DO VERIFICADOR e não do
 * repositório vai "consertar" o repositório auditado — é a confusão que a §8.2
 * do plano nomeia, e ela custa uma sessão inteira quando acontece.
 */
function lerCodigosDeSaida(fonte, rel) {
  const bloco = /\/\/ Códigos de saída[^\n]*\n((?:\/\/.*\n)+)/.exec(fonte)
  exigir(bloco, `${rel}: não achei o bloco "Códigos de saída" no cabeçalho`)
  const codigos = {}
  for (const m of bloco[1].matchAll(/^\/\/\s+(\d+)\s{2,}(.+)$/gm)) codigos[m[1]] = m[2].trim()
  exigir(
    Object.keys(codigos).length >= 4,
    `${rel}: o bloco de códigos de saída rendeu ${Object.keys(codigos).length} códigos, e são 4`,
  )
  return codigos
}

// ─────────────────────────────────────────────────────────── o portão

/**
 * Os passos do `verificar`, na ORDEM em que rodam, do verificar.config.mjs —
 * que é um módulo ESM de built-ins, importável sem instalar nada.
 *
 * `process.execPath` sai do comando e vira "node": o caminho absoluto do
 * binário é diferente em cada máquina, e gravá-lo faria o portão de frescor
 * reprovar no Linux um artefato gerado no Windows sem que nada tivesse mudado.
 */
async function lerPortao(rel) {
  const mod = await import(pathToFileURL(join(RAIZ, ...rel.split('/'))).href)
  const passos = mod.default
  exigir(
    Array.isArray(passos) && passos.length,
    `${rel}: o default export não é uma lista de passos`,
  )
  return passos.map((p, i) => ({
    ordem: i + 1,
    nome: p.nome,
    // `comando:` roda um processo e já se prova sozinho; `funcao:` é código do
    // portão dentro do próprio config, e quem o prova é o passo `passos`.
    tipo: p.comando ? 'comando' : 'funcao',
    comando: p.comando ? p.comando.map((a) => (a === process.execPath ? 'node' : a)) : null,
    dica: p.dica || null,
  }))
}

// ──────────────────────────────────────────────── decisões já fechadas
//
// (d) do contrato: o artefato NÃO pode ser só a lista de regras. Uma IA que só
// recebe as 22 regras não sabe em que stack escrever, nem onde o conteúdo mora,
// e vai propor a env var que o dono já recusou uma vez em `Navesz/Galegos#1`.
//
// Cada decisão aqui carrega uma PROVA extraída de arquivo — nunca uma frase
// digitada neste gerador. E quando a decisão já é imposta por uma regra, ela
// APONTA para a regra em vez de repetir o motivo: repetir criaria a segunda
// fonte que a §7.2 proíbe.

function lerDecisoes(fonteCheck, relCheck) {
  const relNovo = 'novo/index.mjs'
  const fonteNovo = ler(relNovo)
  const relNext = 'novo/site/blocos/next.config.ts'
  const fonteNext = ler(relNext)
  const relPkg = 'package.json'
  const pkg = JSON.parse(ler(relPkg))

  // O cabeçalho `//` do novo/index.mjs é onde a stack do preset está nomeada
  // com versão. Extraído, não transcrito.
  const cabecalho = []
  for (const l of fonteNovo.split('\n').slice(1)) {
    if (!/^\/\//.test(l)) break
    cabecalho.push(l)
  }
  const stack = soTexto(paragrafos(cabecalho, 'cabecalho'))
  exigir(
    stack.some((p) => /shadcn/i.test(p)),
    `${relNovo}: o cabeçalho não menciona o shadcn — a stack deixou de ser derivável daqui`,
  )

  const argv = /'shadcn@latest',\n\s*'([^']+)'/.exec(fonteNovo)

  return [
    {
      id: 'stack-do-preset-site',
      decisao:
        'O scaffold é delegado ao `shadcn create`; o rebar aplica o preset `site` por cima e roda a régua no resultado.',
      prova: {
        arquivo: relNovo,
        linha: linhaDoPadrao(fonteNovo, /'shadcn@latest',/, relNovo),
        trecho: argv ? `shadcn@latest ${argv[1]}` : 'shadcn@latest',
      },
      porque: stack,
      regraQueImpoe: null,
    },
    {
      id: 'saida-estatica',
      decisao:
        'O preset `site` é SSG puro: `output: "export"` e `images.unoptimized`. Sem servidor, e por isso a og:image existe para quem não executa JavaScript.',
      prova: {
        arquivo: relNext,
        linha: linhaDoPadrao(fonteNext, /output: 'export'/, relNext),
        trecho: "output: 'export' · images.unoptimized: true",
      },
      porque: soTexto(paragrafos(fonteNext.split('\n'), 'cabecalho')),
      regraQueImpoe: null,
    },
    {
      id: 'conteudo-em-conteudo-json',
      decisao:
        'Conteúdo mora em `conteudo/*.json`, validado por esquema — não dentro de `src/` nem de `app/`.',
      prova: {
        arquivo: relCheck,
        linha: linhaDoPadrao(fonteCheck, /^const RE_CONTEUDO_JSON = /m, relCheck),
        trecho: 'RE_CONTEUDO_JSON',
      },
      porque: null, // está na regra; repetir aqui seria a segunda fonte
      regraQueImpoe: 'conteudo-fora-do-codigo',
    },
    {
      id: 'identidade-do-negocio-e-conteudo-nao-env',
      decisao:
        'Telefone, CNPJ e endereço são CONTEÚDO validado. Não são código e NÃO são variável de ambiente: com env var o build passa, o deploy sobe e o `wa.me` gera link sem destinatário.',
      prova: {
        arquivo: relCheck,
        linha: linhaDoPadrao(fonteCheck, /id: 'telefone',/, relCheck),
        trecho: "id: 'telefone'",
      },
      porque: null,
      regraQueImpoe: 'telefone',
    },
    {
      id: 'zero-dependencia-no-que-confere',
      decisao:
        'A raiz não tem dependência de produção, e o que confere não depende do que se confere. É o que faz `npx github:Navesz/rebar` rodar sem instalar nada.',
      prova: {
        arquivo: relPkg,
        linha: linhaDoPadrao(ler(relPkg), /"devDependencies"/, relPkg),
        trecho: `dependencies: ${Object.keys(pkg.dependencies || {}).length} · devDependencies: ${Object.keys(pkg.devDependencies || {}).join(', ')}`,
      },
      porque: null,
      regraQueImpoe: null,
    },
  ]
}

// ───────────────────────────────────────────────────────── referências
//
// O que só existe em PROSA não entra copiado — entra como PONTEIRO. E o
// ponteiro é DERIVADO também: a linha é procurada pelo título da seção, não
// digitada. Um `PLANO.md:517` digitado à mão apodrece no primeiro parágrafo
// inserido acima dele, e a IA que segue a referência não acha, não pergunta, e
// reescreve do zero — que é exatamente o que o passo `elos` do verificar existe
// para impedir na documentação.

function lerReferencias() {
  const alvos = [
    ['o-mcp-que-se-regenera', 'docs/PLANO.md', /^## 7\.2 /m, 'o desenho deste módulo'],
    ['taxonomia-n0-n7', 'docs/PLANO.md', /^# 4\. /m, 'o que cada nível significa e a regra-mãe'],
    [
      'as-tres-camadas-de-porta',
      'docs/PLANO.md',
      /^## 7\.3 /m,
      'verificar, hook, CI e branch protection',
    ],
    [
      'o-perfil-e-o-compilador',
      'docs/PLANO.md',
      /^## 7\.1 /m,
      'de onde a ideia de artefato gerado vem',
    ],
    ['objetivos-do-repositorio', 'docs/PLANO.md', /^# 0\. /m, 'os seis objetivos declarados'],
    [
      'stack-postgres',
      'docs/STACK.md',
      /^## O critério único/m,
      'o critério que derrubou Prisma e NestJS',
    ],
  ]
  return alvos.map(([assunto, rel, padrao, oQueEsta]) => ({
    assunto,
    arquivo: rel,
    linha: linhaDoPadrao(ler(rel), padrao, rel),
    oQueEsta,
  }))
}

// ──────────────────────────────────────────────────────── a montagem
//
// O NÚCLEO É OBRIGATÓRIO, O RESTO É POR SEÇÃO — e isto é a doutrina do N/A do
// próprio rebar-check, aplicada aqui.
//
// `ferramental/rebar-check/index.mjs` e `package.json` são o núcleo: sem eles
// não há artefato nenhum, e a geração sai 2. As outras fontes — o PLANO, o
// verificar.config, o novo/, os casos de prova — mandam cada uma numa SEÇÃO. Se
// uma delas não está NESTA árvore, a seção não é gerada E NÃO É COMPARADA.
//
// A razão é a mesma do `na()` do index.mjs, e o comentário de lá vale palavra
// por palavra: "O nada não conforma; o nada não se aplica." Uma árvore que não
// tem o `docs/PLANO.md` não pode testemunhar sobre a taxonomia. Gritar
// "DIVERGIU" ali seria acusar o artefato de estar velho quando o que está
// incompleto é a árvore — a acusação errada, apontando para quem não errou, que
// é o mesmo erro que o 127 contra o 1 existe para não cometer.
//
// ONDE ISSO APARECE DE VERDADE: a prova do passo `mcp`
// (`ferramental/verificar/provar-passos.mjs`) monta uma raiz temporária com
// APENAS `mcp/`, `ferramental/rebar-check/` sem `provas/`, e o `package.json` —
// de propósito, para provar que o portão de frescor roda sem
// `mcp/node_modules`. Nessa raiz, quatro das seis fontes não existem. Sem o N/A
// por seção, aquela prova pediria ao gerador para acusar a ausência de arquivos
// que ela mesma decidiu não copiar.
//
// O CUSTO, e ele é real: se alguém APAGAR o `docs/PLANO.md` do repositório de
// verdade, este portão para de conferir a taxonomia. O que sobra contra isso é
// a linha ⚠ impressa aqui nomeando a seção e a fonte que faltou, e o passo
// `elos` do verificar, que reprova link quebrado para arquivo que sumiu. Fica
// escrito porque é a fresta que esta decisão abre, e não a que ela fecha.

const existe = (rel) => existsSync(join(RAIZ, ...rel.split('/')))

/**
 * As seções derivadas e a fonte de cada uma. `podar()` usa a MESMA tabela para
 * tirar do lado do disco o que esta árvore não soube regenerar — a tabela é a
 * única fonte dessa correspondência, para que gerar e comparar não divirjam.
 */
const SECOES = [
  { chave: 'niveis', exige: ['docs/PLANO.md'] },
  { chave: 'portao', exige: ['verificar.config.mjs'] },
  {
    chave: 'decisoesFechadas',
    exige: ['novo/index.mjs', 'novo/site/blocos/next.config.ts', 'package.json'],
  },
  { chave: 'referencias', exige: ['docs/PLANO.md', 'docs/STACK.md'] },
  { chave: 'provas', exige: ['ferramental/rebar-check/provas/casos'] },
]

/** Seções que ESTA árvore não consegue gerar, com o que faltou para cada uma. */
function secoesAusentes() {
  return SECOES.map((s) => ({ ...s, faltando: s.exige.filter((r) => !existe(r)) })).filter(
    (s) => s.faltando.length,
  )
}

/**
 * Tira do objeto do DISCO exatamente o que esta árvore não regenerou, para que
 * a comparação não confunda "o artefato está velho" com "esta árvore é parcial".
 */
function podar(valor, ausentes) {
  if (!ausentes.length) return valor
  const copia = JSON.parse(JSON.stringify(valor))
  const chaves = new Set(ausentes.map((s) => s.chave))
  for (const c of chaves) {
    if (c === 'provas') for (const r of copia.regras || []) delete r.provas
    else delete copia[c]
  }
  // `fontes` acompanha: entrada de fonte que não está nesta árvore sai dos dois
  // lados, senão o sha256 de um arquivo ausente vira divergência sozinho.
  if (Array.isArray(copia.fontes)) {
    copia.fontes = copia.fontes.filter((f) => existe(f.arquivo.replace(/\/$/, '')))
  }
  return copia
}

async function montar() {
  const relCheck = 'ferramental/rebar-check/index.mjs'
  const relConfig = 'verificar.config.mjs'
  const relPlano = 'docs/PLANO.md'
  const fonteCheck = ler(relCheck)
  const ausentes = secoesAusentes()
  const pulou = (chave) => ausentes.some((s) => s.chave === chave)

  // A CONFERÊNCIA QUE TORNA A DERIVA ALTA. O texto e o módulo importado têm de
  // concordar na lista inteira, id a id, na mesma ordem. Se o prettier mudar a
  // indentação ou alguém escrever uma regra numa forma nova, o parser casa a
  // menos — e sem esta comparação a regra sumiria do artefato em SILÊNCIO, que é
  // o defeito exato que este módulo existe para não cometer.
  const noTexto = regrasNoTexto(fonteCheck, relCheck)
  const idsTexto = noTexto.map((r) => r.id).join(',')
  const idsModulo = REGRAS.map((r) => r.id).join(',')
  exigir(
    idsTexto === idsModulo,
    `${relCheck}: o texto casou ${noTexto.length} regra(s) e o módulo exporta ${REGRAS.length}.\n` +
      `  texto : ${idsTexto}\n  módulo: ${idsModulo}`,
  )

  const provas = pulou('provas') ? null : lerProvas(REGRAS.map((r) => r.id))
  const niveis = pulou('niveis') ? null : lerNiveis(relPlano)

  const regras = REGRAS.map((regra, i) => {
    const t = noTexto[i]
    exigir(
      regra.titulo && regra.classe && regra.nivel,
      `regra ${regra.id}: campo obrigatório vazio`,
    )
    exigir(
      !niveis || niveis.linhas.some((n) => n.nivel === regra.nivel),
      `regra ${regra.id}: nível "${regra.nivel}" não existe na tabela N0–N7`,
    )
    return {
      id: regra.id,
      titulo: regra.titulo,
      // determinística derruba o exit code; heurística só informa. É a
      // diferença entre "não entra na principal" e "fica anotado".
      classe: regra.classe,
      nivel: regra.nivel,
      fonte: { arquivo: relCheck, linha: t.linha },
      porque: t.porque,
      ...(provas ? { provas: provas.porRegra.get(regra.id) } : {}),
    }
  })

  const porNivel = (n) => regras.filter((r) => r.nivel === n).map((r) => r.id)

  const artefato = {
    $aviso:
      'ARTEFATO GERADO por mcp/gerar.mjs. Não edite à mão: o passo de frescor regenera em memória e reprova se o disco divergir. Para mudar qualquer coisa aqui, mude a FONTE listada em `fontes` e rode `node mcp/gerar.mjs`.',
    gerador: 'mcp/gerar.mjs',
    formato: 1,
    fontes: [
      {
        arquivo: relCheck,
        sha256: sha256(fonteCheck),
        daqui: 'as regras, o porque de cada uma e os códigos de saída',
      },
      ...(pulou('portao')
        ? []
        : [
            {
              arquivo: relConfig,
              sha256: sha256(ler(relConfig)),
              daqui: 'os passos do portão, na ordem',
            },
          ]),
      ...(niveis
        ? [
            {
              arquivo: relPlano,
              sha256: sha256(niveis.fonte),
              daqui: 'a taxonomia N0–N7 e os ponteiros de prosa',
            },
          ]
        : []),
      ...(provas
        ? [
            {
              arquivo: `${provas.relBase}/`,
              sha256: provas.impressao,
              daqui: `o porque de cada um dos ${provas.quantos} casos de prova`,
            },
          ]
        : []),
    ],
    codigosDeSaida: lerCodigosDeSaida(fonteCheck, relCheck),
    ...(niveis
      ? {
          niveis: niveis.linhas.map((n) => ({
            nivel: n.nivel,
            oQueE: n.oQueE,
            falhaComo: n.falhaComo,
            custoPorSessao: n.custoPorSessao,
            fonte: { arquivo: relPlano, linha: n.linha },
            regras: porNivel(n.nivel),
          })),
        }
      : {}),
    regras,
    ...(pulou('portao')
      ? {}
      : { portao: { comando: 'npm run verificar', passos: await lerPortao(relConfig) } }),
    ...(pulou('decisoesFechadas') ? {} : { decisoesFechadas: lerDecisoes(fonteCheck, relCheck) }),
    ...(pulou('referencias') ? {} : { referencias: lerReferencias() }),
    // O que este artefato deliberadamente NÃO carrega. Existe para que o
    // servidor nunca invente: perguntado sobre isto, ele aponta a referência em
    // vez de responder de memória — e memória de modelo é a fonte que a §7.2
    // classifica como "decisão que mora onde nenhuma máquina lê".
    naoDerivado: [
      'O texto das 120 decisões do painel (§5 do PLANO): é prosa, e prosa copiada volta a divergir. Está em `referencias`.',
      'As decisões de banco e contrato do docs/STACK.md: nada no rebar as impõe hoje, e artefato que promete o que ninguém confere é a promessa falsa que este repositório persegue.',
      'A implementação de cada regra: o artefato diz O QUE e POR QUE. O COMO é o `checar` no index.mjs, e ele muda sem que a decisão mude.',
    ],
  }
  return { artefato, ausentes }
}

// ──────────────────────────────────────────────────── comparar e escrever

/** Diferença por caminho. Devolve lista de `{ onde, disco, gerado }`. */
function diferencas(disco, gerado, onde = '') {
  const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (iguais(disco, gerado)) return []
  const objeto = (v) => v && typeof v === 'object'
  if (!objeto(disco) || !objeto(gerado) || Array.isArray(disco) !== Array.isArray(gerado)) {
    return [{ onde: onde || '(raiz)', disco, gerado }]
  }
  const chaves = [...new Set([...Object.keys(disco), ...Object.keys(gerado)])]
  const saida = []
  for (const k of chaves) {
    // Em lista de objetos identificados, o caminho usa o IDENTIFICADOR e não o
    // índice: `regras.telefone.titulo` diz o que mudou, `regras.17.titulo`
    // manda contar. E o índice ainda mente quando o que mudou foi a ORDEM —
    // inserir uma regra no meio faria toda regra abaixo dela aparecer como
    // divergente por posição, e as 5 linhas úteis do diff sumiriam no meio de 40.
    const rotulo =
      Array.isArray(disco) && (disco[k]?.id || gerado[k]?.id)
        ? disco[k]?.id || gerado[k]?.id
        : Array.isArray(disco) && (disco[k]?.nome || gerado[k]?.nome)
          ? disco[k]?.nome || gerado[k]?.nome
          : Array.isArray(disco) && (disco[k]?.arquivo || gerado[k]?.arquivo)
            ? disco[k]?.arquivo || gerado[k]?.arquivo
            : k
    const sub = onde ? `${onde}.${rotulo}` : rotulo
    if (!(k in disco)) saida.push({ onde: sub, disco: '(ausente no disco)', gerado: gerado[k] })
    else if (!(k in gerado))
      saida.push({ onde: sub, disco: disco[k], gerado: '(não é mais gerado)' })
    else saida.push(...diferencas(disco[k], gerado[k], sub))
  }
  return saida
}

const recortar = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  // 160 caracteres: cabe numa linha do terminal do dono com o `limite: 12` do
  // passo `mcp`, e um `porque` de 2.800 caracteres colado inteiro na saída do
  // verificar esconde as outras 19 divergências.
  return s === undefined ? 'undefined' : s.length > 160 ? `${s.slice(0, 160)}…` : s
}

/**
 * A comparação é SEMÂNTICA — JSON parseado dos dois lados —, e não byte a byte.
 *
 * O artefato está no .prettierignore, então o gerador é o dono único dos bytes
 * e um portão byte a byte até funcionaria. Semântico mesmo assim, por dois
 * motivos medidos: (1) byte a byte acusa "o MCP está velho" quando alguém só
 * mexeu em espaço em branco, e dica errada é pior que dica nenhuma; (2) foi
 * assim que se descobriu que o caminho contrário não fecha — com o prettier
 * mandando junto, `node mcp/gerar.mjs` deixava o passo `formato` vermelho, e o
 * ciclo "mudei a regra, regenerei, está verde" precisava de dois comandos.
 * FATO é assunto daqui; bytes são assunto de quem escreve o arquivo.
 */
function lerDoDisco() {
  if (!existsSync(ARTEFATO)) return { ausente: true }
  try {
    return { valor: JSON.parse(readFileSync(ARTEFATO, 'utf8')) }
  } catch (e) {
    return { ilegivel: e.message }
  }
}

/** ⚠ nomeando cada seção que ESTA árvore não soube gerar, e o que faltou. */
function avisarAusentes(ausentes) {
  for (const s of ausentes) {
    console.error(
      `  ⚠ seção "${s.chave}" NÃO gerada nem conferida — falta ${s.faltando.join(', ')} nesta árvore`,
    )
  }
}

function escrever(gerado, ausentes) {
  avisarAusentes(ausentes)
  const disco = lerDoDisco()
  // Idempotente de propósito: se o fato já é o mesmo, os bytes do disco ficam
  // como estão. É o que deixa o prettier ser dono da formatação sem que uma
  // regeneração desfaça o trabalho dele no commit seguinte.
  if (disco.valor && !diferencas(podar(disco.valor, ausentes), gerado).length) {
    console.log(`mcp/gerar: ${relative(RAIZ, ARTEFATO).replace(/\\/g, '/')} já está em dia`)
    return
  }
  writeFileSync(ARTEFATO, `${JSON.stringify(gerado, null, 2)}\n`, 'utf8')
  console.log(
    `mcp/gerar: escrito ${relative(RAIZ, ARTEFATO).replace(/\\/g, '/')} · ` +
      `${gerado.regras.length} regras · ${gerado.niveis?.length ?? '–'} níveis · ` +
      `${gerado.portao?.passos.length ?? '–'} passos · ` +
      `${gerado.regras.reduce((n, r) => n + (r.provas?.length || 0), 0)} provas`,
  )
}

function conferir(gerado, ausentes) {
  avisarAusentes(ausentes)
  const disco = lerDoDisco()
  if (disco.ausente) {
    console.error('mcp/gerar --verificar: DIVERGIU — mcp/regras.gerado.json não existe.')
    console.error('  O servidor MCP leria o nada. Rode: node mcp/gerar.mjs')
    return 1
  }
  if (disco.ilegivel) {
    console.error(`mcp/gerar --verificar: DIVERGIU — o artefato não é JSON: ${disco.ilegivel}`)
    console.error('  Rode: node mcp/gerar.mjs')
    return 1
  }
  // `podar` tira do lado do DISCO exatamente o que esta árvore não regenerou.
  // Sem isto, a raiz temporária da prova do passo `mcp` — que copia só `mcp/`, o
  // `rebar-check` sem `provas/` e o `package.json` — acusaria o artefato de
  // estar velho por causa de quatro arquivos que ela mesma decidiu não copiar.
  const diff = diferencas(podar(disco.valor, ausentes), gerado)
  if (!diff.length) {
    console.log(
      `mcp/gerar --verificar: em dia · ${gerado.regras.length} regras · ` +
        `${gerado.fontes.length} fonte(s) conferida(s)` +
        `${ausentes.length ? ` · ${ausentes.length} seção(ões) N/A nesta árvore` : ''}`,
    )
    return 0
  }
  // PONTEIRO DE LINHA VAI PARA O FIM, E VIRA UMA LINHA SÓ. Medido: inserir UM
  // comentário no topo do index.mjs desloca `fonte.linha` de todas as 22 regras
  // e de cada parágrafo de `porque` — 60 divergências, das quais 59 são a mesma
  // notícia ("o arquivo cresceu uma linha") e UMA é o fato que mudou. Com a
  // ordem crua, o teto de 20 estourava antes de chegar ao fato, e a saída do
  // portão passava a ser ruído. Regra que grita o irrelevante ensina a desligar
  // a saída inteira — é a mesma conta que mantém `conteudo-fora-do-codigo` como
  // heurística.
  const ponteiro = (d) => /\.linha$/.test(d.onde)
  const fatos = diff.filter((d) => !ponteiro(d))
  const ponteiros = diff.filter(ponteiro)

  console.error(
    `mcp/gerar --verificar: DIVERGIU. ${fatos.length} fato(s) mudaram` +
      `${ponteiros.length ? ` e ${ponteiros.length} ponteiro(s) de linha deslocaram` : ''}. ` +
      'A fonte mudou e o artefato do MCP ficou para trás.',
  )
  // FORMA DE DIFF UNIFICADO, e não é estética. O passo `mcp` do
  // verificar.config.mjs extrai da saída deste comando com `/^\s*(erro|✗|[-+] )/`
  // — sem o `- `/`+ ` no começo, nada casa e o executor cai nas últimas linhas,
  // que seriam a linha de conserto e não o que mudou. O CAMINHO vai em cada
  // linha, e não num cabeçalho acima: linha extraída sozinha tem de dizer sozinha
  // qual campo divergiu.
  //
  // Teto de 12, o mesmo `limite` que o passo `mcp` do verificar impõe à saída
  // deste comando: imprimir mais é escrever para um recorte que já cortou.
  for (const d of fatos.slice(0, 12)) {
    console.error(`  - ${d.onde} = ${recortar(d.disco)}   (disco, velho)`)
    console.error(`  + ${d.onde} = ${recortar(d.gerado)}   (fonte, hoje)`)
  }
  if (fatos.length > 12) console.error(`  … e mais ${fatos.length - 12} fato(s).`)
  if (ponteiros.length) {
    const exemplo = ponteiros[0]
    console.error(
      `  - ${ponteiros.length} ponteiro(s) de linha, ex. ${exemplo.onde}: ` +
        `${exemplo.disco} → ${exemplo.gerado}   (o arquivo mudou de tamanho acima deles)`,
    )
  }
  console.error('\n  Conserto: node mcp/gerar.mjs')
  return 1
}

// ───────────────────────────────────────────────────────────────── programa

const args = process.argv.slice(2)
const desconhecidas = args.filter((a) => !/^--(verificar|resumo)$/.test(a))
if (desconhecidas.length) {
  console.error(`mcp/gerar: opção desconhecida: ${desconhecidas.join(', ')}`)
  console.error('uso: node mcp/gerar.mjs [--verificar | --resumo]')
  process.exit(2)
}

let gerado
let ausentes
try {
  ;({ artefato: gerado, ausentes } = await montar())
} catch (e) {
  // Geração torta sai 2 e NUNCA 1: 1 quer dizer "o disco está velho, regenere",
  // e mandar regenerar com o gerador quebrado é mandar gravar lixo por cima do
  // artefato bom.
  console.error(`mcp/gerar: a GERAÇÃO quebrou — ${e.message}`)
  if (!(e instanceof Torto)) console.error(e.stack)
  process.exit(2)
}

if (args.includes('--resumo')) {
  avisarAusentes(ausentes)
  console.log(`${gerado.regras.length} regras · ${gerado.niveis?.length ?? 0} níveis`)
  for (const r of gerado.regras) {
    console.log(
      `  ${r.nivel} ${r.classe === 'determinística' ? 'D' : 'h'} ${r.id.padEnd(24)}` +
        ` porque:${String(r.porque.filter((x) => x.onde === 'cabecalho').length).padStart(2)}c` +
        `+${String(r.porque.filter((x) => x.onde === 'implementacao').length).padStart(2)}i` +
        ` provas:${String(r.provas?.length ?? 0).padStart(2)}`,
    )
  }
  process.exit(0)
}

process.exit(
  args.includes('--verificar') ? conferir(gerado, ausentes) : (escrever(gerado, ausentes), 0),
)
