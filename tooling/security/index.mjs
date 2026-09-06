#!/usr/bin/env node
// rebar-security — a régua de segurança, contra repositório que JÁ EXISTE.
//
// Uso:
//   node tooling/security/index.mjs <dir>              placar de um repositório
//   node tooling/security/index.mjs --json <dir>       para CI
//   node tooling/security/index.mjs --rule=<id> <dir>  uma regra só
//   node tooling/security/index.mjs --heuristics <dir> heurística também derruba
//
// CÓDIGOS DE SAÍDA — os mesmos do rebar-check, e pelo mesmo motivo:
//   0    tudo que se aplica passou
//   1    reprovou — violação real
//   2    alvo inválido ou invocação errada
//   127  QUEBROU: uma regra lançou. Defeito DESTA ferramenta, não do alvo.
//
// ─────────────────────────────────────────────────── de onde estas regras vêm
//
// De 16 vídeos técnicos brasileiros sobre segurança, lidos e destilados em
// 163 falhas candidatas. Cada uma passou por três céticos independentes — um
// perguntando "dá para decidir isto sem rodar a aplicação?", outro "em quantos
// repositórios honestos isto dispararia errado?", o terceiro "o rebar já não
// checa isso?". 82 sobreviveram. O inventário inteiro está em
// `docs/security/INVENTARIO.md`, com o placar de frequência e — mais
// importante — os 8 casos que NÃO viram regra.
//
// ───────────────────────────────────── os invariantes, e por que são poucos
//
// Dez invariantes saíram da repetição dos falsos positivos que os relatores
// nomearam. Três decidem quase tudo, e estão escritos aqui porque toda regra
// nova entra provando que os respeita:
//
//   I1. ESCOPO REPO-WIDE, NUNCA POR ARQUIVO. Sempre que o falso positivo
//       previsto for "a defesa está em outro arquivo" (middleware, policy,
//       serializer), a regra olha o repositório inteiro ou não existe.
//
//   I4. RAMO `na()` OBRIGATÓRIO. Sem o pré-requisito — sem código de servidor,
//       sem git, sem manifesto — o veredito é "não avaliado" e a classe SAI DO
//       DENOMINADOR. Silêncio por ausência nunca vira "aprovado".
//
//   I7. COMENTÁRIO NÃO CONTA. Medido neste repositório com outra regra: 7
//       ocorrências, ZERO verdadeiro positivo, cinco delas comentários sobre a
//       própria regra. Todo detector que contém o padrão que procura se acusa
//       sem esta guarda.
//
// ─────────────────────────────────── o vocabulário é bilíngue, e isso é medido
//
// Durante a tradução deste projeto para o inglês eu troquei `'provas'` por
// `'proofs'` numa lista que o checker usa para RECONHECER pasta de teste nos
// repositórios dos outros. A regra ficou cega, e o caso de prova caiu na hora
// — ele dizia, escrito antes: "se o segmento `provas` sair do reconhecedor, o
// lado aprovar sai 1".
//
// A lição vale dobrado aqui: este módulo audita repositório BRASILEIRO. Um
// detector de senha que procure só `password` não vê `senha`; um de segredo
// que procure só `secret` não vê `chave`. Toda lista de vocabulário abaixo tem
// os dois idiomas, e é por medição, não por simetria.

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lerRepo, semComentarioNemImport } from '../rebar-check/index.mjs'

/** "Não se aplica" — o terceiro estado. Sai do denominador, não do placar. */
const na = (motivo) => ({ na: motivo })

const ler = (dir, rel) => {
  try {
    return readFileSync(join(dir, rel), 'utf8')
  } catch {
    return null
  }
}

/**
 * Arquivos de código de PRODUÇÃO, já sem fixture, sem teste e sem exemplo.
 *
 * `r.fontes` vem do rebar-check e já exclui fixture e teste (I5). Aqui sobra
 * tirar `*.example`, `*.sample`, `*.template`, `*.dist` e os equivalentes em
 * português — invariante I6, e é dívida medida: o varredor de segredo deste
 * mesmo repositório produz dois falsos positivos exatamente neste ponto.
 */
const EXEMPLO = /\.(example|exemplo|sample|template|dist|modelo)(\.|$)/i

/**
 * `r.fontes` vem como pares `[caminho, texto]`, não como lista de caminhos.
 *
 * Custou o primeiro par de provas vermelho: eu tratei como lista de caminhos,
 * o `filter` comparou regex contra um array (que vira string com o arquivo
 * inteiro dentro), e a leitura recebeu o par como se fosse caminho. Toda regra
 * ficou cega em silêncio — `defesa-desligada` disse "passou" sobre uma árvore
 * com `rejectUnauthorized: false`, que é o pior desfecho possível para uma
 * régua de segurança.
 *
 * O texto vir junto é vantagem: nenhuma regra reabre arquivo, e o comentário
 * sai uma vez só (I7).
 */
const codigo = (r) =>
  (r.fontes || [])
    .filter(([rel]) => !EXEMPLO.test(rel))
    .map(([rel, texto]) => [rel, semComentarioNemImport(texto)])

/** Para arquivo que não é fonte — Dockerfile, settings.py, workflow. */
const corpo = (dir, rel) => {
  const t = ler(dir, rel)
  return t === null ? null : semComentarioNemImport(t)
}

// ═════════════════════════════════════════════════════════════════════ regras

export const REGRAS = [
  // ──────────────────────────────────────────────────────────────────── S1
  {
    id: 'env-versionado',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'nenhum .env rastreado pelo git',
    /**
     * A classe mais comum do inventário inteiro: segredo versionado aparece em
     * 7 dos 16 vídeos. Esta é a fatia mais barata dela — um `git ls-files`.
     *
     * NÃO é o varredor de segredo, que já existe em `tooling/secret/`. Aquele
     * olha o CONTEÚDO em stage; este olha o NOME rastreado. São achados
     * diferentes: um `.env` pode estar rastreado e vazio hoje, e receber a
     * chave amanhã sem ninguém notar, porque o arquivo já passou pela revisão.
     *
     * Falso positivo previsto e excluído: `.env.example`, `.env.sample`,
     * `.env.template`, `.env.dist` e `.env.exemplo` são o CONSERTO desta falha,
     * não a falha. Um repositório que documenta as variáveis num `.env.example`
     * rastreado está fazendo a coisa certa.
     *
     * N5 e não N1 porque o conserto depois do commit não é apagar o arquivo: é
     * rotacionar a credencial. O lugar de barrar é antes do commit existir.
     */
    checar: (r) => {
      const alvos = (r.arquivos || []).filter((a) => {
        const nome = basename(a)
        if (!/^\.env(\..+)?$/.test(nome)) return false
        return !EXEMPLO.test(nome)
      })
      if (!alvos.length) return null
      return (
        `${alvos.length} arquivo(s) .env rastreado(s): ${alvos.join(', ')} — ` +
        'apagar não basta, o segredo já está no histórico; rotacione a credencial'
      )
    },
  },

  // ──────────────────────────────────────────────────────────────────── S2
  {
    id: 'defesa-desligada',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'nenhuma proteção de framework desligada por literal',
    /**
     * A lacuna mais barata que a auditoria do inventário encontrou, e ela nem
     * estava no inventário: nenhum vídeo mostrou, mas é o padrão mais
     * determinístico que existe num repositório feito com IA.
     *
     * Cada literal desta lista é uma DECISÃO HUMANA registrada em uma linha —
     * alguém desligou uma proteção para o demo parar de dar erro, e nunca
     * religou. Não há dataflow, não há schema, não há prova de ausência: o
     * literal está lá ou não está. Por isso o falso positivo tende a zero e o
     * achado se explica sozinho.
     *
     * Traz CSRF (CWE-352, terceiro do CWE Top 25) para dentro do módulo, que
     * de outra forma ficaria sem nenhuma regra.
     *
     * FALSO POSITIVO PREVISTO E TRATADO: o próprio arquivo que documenta estes
     * padrões — este aqui — casaria todos eles. É o que `semComentarioNemImport`
     * resolve (I7), e é a razão de o corpo ser lido sem comentário.
     */
    checar: (r) => {
      // Fonte ja vem com o texto; config e workflow precisam de leitura.
      const config = [
        ...(r.arquivos || []).filter((a) =>
          /(^|\/)(Dockerfile|docker-compose\.ya?ml|settings\.py)$/i.test(a),
        ),
        ...(r.workflows || []),
      ]
      const alvos = [
        ...codigo(r),
        ...config.map((rel) => [rel, corpo(r.dir, rel)]).filter(([, x]) => x !== null),
      ]
      if (!alvos.length) return na('nenhum arquivo de código ou configuração')

      // Conjunto FECHADO. Cada entrada é um literal, não uma heurística.
      const DESLIGAM = [
        [
          /rejectUnauthorized\s*:\s*false/,
          'rejectUnauthorized: false — TLS sem verificar certificado',
        ],
        [
          /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"`]?0/,
          'NODE_TLS_REJECT_UNAUTHORIZED=0 — desliga TLS no processo inteiro',
        ],
        [/\bverify\s*=\s*False\b/, 'verify=False — requests sem verificar certificado'],
        [
          /InsecureSkipVerify\s*:\s*true/,
          'InsecureSkipVerify: true — TLS sem verificar certificado',
        ],
        [/@csrf_exempt\b/, '@csrf_exempt — rota sem proteção CSRF'],
        [
          /skip_before_action\s+:verify_authenticity_token/,
          'skip_before_action :verify_authenticity_token — CSRF desligado',
        ],
        [/contentSecurityPolicy\s*:\s*false/, 'helmet com contentSecurityPolicy: false — sem CSP'],
        [/curl\s+(-[a-zA-Z]*k|--insecure)\b/, 'curl -k — download sem verificar certificado'],
      ]

      const achados = []
      for (const [rel, t] of alvos) {
        for (const [padrao, motivo] of DESLIGAM) {
          if (padrao.test(t)) achados.push(`${rel}: ${motivo}`)
        }
        // DEBUG ligado só conta junto de host liberado: `DEBUG = True` sozinho
        // é o default de desenvolvimento e acusá-lo pinta todo settings.py.
        if (/^\s*DEBUG\s*=\s*True/m.test(t) && /ALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]/.test(t)) {
          achados.push(`${rel}: DEBUG = True com ALLOWED_HOSTS = ['*'] — modo de depuração exposto`)
        }
      }
      if (!achados.length) return null
      return `${achados.length} proteção(ões) desligada(s): ${achados.join(' · ')}`
    },
  },

  // ──────────────────────────────────────────────────────────────────── S3
  {
    id: 'senha-sem-kdf',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'senha nunca comparada em texto puro nem por hash rápido',
    /**
     * Terceira classe mais comum do inventário — 4 dos 16 vídeos. Escolhida
     * antes de `mass-assignment`, que aparece em 5, por um motivo de custo: o
     * mass assignment só decide a severidade lendo a coluna privilegiada do
     * schema, o que exige parser de `schema.prisma` ou de SQL. Esta aqui é
     * textual inteira.
     *
     * DOIS SINAIS, e os dois precisam de vocabulário bilíngue:
     *
     *   (a) comparação direta — `u.password === req.body.password`, ou o mesmo
     *       com `senha`. Se a comparação é `===`, não passou por KDF: bcrypt,
     *       argon2 e scrypt devolvem hash com sal embutido e exigem `compare`.
     *
     *   (b) hash rápido em caminho de autenticação — `createHash('sha256')`,
     *       `md5`, `sha1`. Rápido é o defeito: o que protege senha é ser lento.
     *
     * FALSO POSITIVO PREVISTO E EXCLUÍDO: PRÉ-HASH LEGÍTIMO. `bcrypt` trunca
     * silenciosamente em 72 bytes, e a defesa recomendada é passar um sha256 da
     * senha para o bcrypt. Um arquivo que faz `bcrypt.hash(sha256(senha))` está
     * CERTO, e acusá-lo seria punir quem conhece o problema. Por isso o sinal
     * (b) só vale onde não há primitiva lenta no mesmo arquivo.
     */
    checar: (r) => {
      const fontes = codigo(r)
      if (!fontes.length) return na('nenhum arquivo de código de produção')

      // Vocabulário BILÍNGUE. Ver a nota do topo: a lista só em inglês é cega
      // exatamente nos repositórios que este módulo existe para auditar.
      const SENHA = '(?:password|senha|passwd|pwd)' // rebar-segredo-ok: vocabulario de regex, nao credencial -- e a lista que a regra PROCURA
      const LENTA = /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i
      const RAPIDA =
        /createHash\(\s*['"`](md5|sha1|sha256|sha512)['"`]\s*\)|hashlib\.(md5|sha1|sha256)\(/i
      const COMPARA = new RegExp(
        `${SENHA}\\s*(===|==|!==|!=)\\s*[a-zA-Z_$][\\w$.\\[\\]'"]*${SENHA}`,
        'i',
      )

      const achados = []
      let viuAuth = false
      for (const [rel, t] of fontes) {
        const falaDeSenha = new RegExp(SENHA, 'i').test(t)
        if (falaDeSenha) viuAuth = true

        if (COMPARA.test(t)) achados.push(`${rel}: senha comparada com === (texto puro)`)
        else if (falaDeSenha && RAPIDA.test(t) && !LENTA.test(t)) {
          achados.push(
            `${rel}: hash rápido em caminho de senha, sem bcrypt/argon2/scrypt no arquivo`,
          )
        }
      }
      if (!viuAuth) return na('nenhum código toca senha')
      if (!achados.length) return null
      return `${achados.length} ocorrência(s): ${achados.join(' · ')}`
    },
  },
]

// ═════════════════════════════════════════════════════════════════ o executor

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
      // QUEBROU é defeito DESTA ferramenta. Nunca entra na nota do alvo, e o
      // 127 domina o 1: não se acusa repositório com uma régua que quebrou.
      return { ...base, estado: 'quebrou', motivo: `${e.message}` }
    }
    if (saida === null || saida === undefined) return { ...base, estado: 'passou' }
    if (typeof saida === 'object' && saida.na) return { ...base, estado: 'na', motivo: saida.na }
    return { ...base, estado: 'reprovou', motivo: String(saida) }
  })
  return { dir, nome: r.nome, resultados }
}

const c = process.stdout.isTTY && !process.env.NO_COLOR
const cor = (n, s) => (c ? `[${n}m${s}[0m` : s)
const verde = (s) => cor(32, s)
const vermelho = (s) => cor(31, s)
const fraco = (s) => cor(90, s)

function imprimir(a) {
  console.log(`\nrebar-security · ${a.nome}`)
  if (a.erro) {
    console.log(`  ${vermelho('✗')} ${a.erro}`)
    return
  }
  const largura = Math.max(...a.resultados.map((x) => x.id.length))
  for (const x of a.resultados) {
    const marca = {
      passou: verde('✓'),
      reprovou: vermelho('✗'),
      na: fraco('–'),
      quebrou: vermelho('!'),
    }[x.estado]
    const motivo =
      x.estado === 'passou' ? '' : `  ${x.estado === 'na' ? fraco(x.motivo) : x.motivo}`
    console.log(`  ${marca} ${x.id.padEnd(largura)}  ${x.titulo}${motivo}`)
  }
  const aplicaveis = a.resultados.filter((x) => x.estado === 'passou' || x.estado === 'reprovou')
  const passaram = aplicaveis.filter((x) => x.estado === 'passou').length
  const naS = a.resultados.filter((x) => x.estado === 'na').length
  console.log(`  ${passaram} de ${aplicaveis.length}${naS ? `  ·  ${naS} não se aplica` : ''}`)
}

function principal(argv) {
  const json = argv.includes('--json')
  const heuristicasBarram = argv.includes('--heuristics')
  const regraArg = argv.find((a) => a.startsWith('--rule='))
  const filtro = regraArg ? regraArg.slice('--rule='.length) : null

  const desconhecida = argv.find((a) => a.startsWith('--') && !/^--(json|heuristics|rule=)/.test(a))
  if (desconhecida) {
    console.error(`rebar-security: opção desconhecida: ${desconhecida}`)
    process.exit(2)
  }
  if (filtro && !REGRAS.some((x) => x.id === filtro)) {
    console.error(`rebar-security: regra desconhecida: ${filtro}`)
    console.error(`  conhecidas: ${REGRAS.map((x) => x.id).join(', ')}`)
    process.exit(2)
  }

  const alvos = argv.filter((a) => !a.startsWith('--'))
  if (!alvos.length) alvos.push('.')

  const avaliacoes = alvos.map((d) => avaliar(d, filtro))
  if (json) console.log(JSON.stringify(avaliacoes, null, 2))
  else avaliacoes.forEach(imprimir)

  if (avaliacoes.some((a) => a.erro)) return 2
  const todos = avaliacoes.flatMap((a) => a.resultados)
  if (todos.some((x) => x.estado === 'quebrou')) return 127
  const reprovou = todos.some(
    (x) => x.estado === 'reprovou' && (x.classe === 'determinística' || heuristicasBarram),
  )
  return reprovou ? 1 : 0
}

// `pathToFileURL`, nao interpolacao: no Windows `argv[1]` vem com barra
// invertida e `import.meta.url` com barra normal, entao a comparacao direta
// e sempre falsa e o binario nao imprime nada -- foi o primeiro defeito
// deste arquivo, e ele sai calado, que e o pior jeito de sair.
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  process.exitCode = principal(process.argv.slice(2))
}
