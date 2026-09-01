#!/usr/bin/env node
// medir-conteudo — recontar o número que RECUSA a promoção de
// `conteudo-fora-do-codigo` a determinística.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O comentário da regra, em `index.mjs`, carrega o número mais caro do
// repositório: "Medido depois: 37 de 262 (14,1%)" de vocabulário de interface
// entre as frases que a definição de literal de conteúdo acha. É esse 14,1% que
// mantém a regra heurística — com 14% de ruído, determinística barra merge por
// rótulo de campo.
//
// O número não se reproduzia. A auditoria de 31/08 chegou a outra contagem
// porque REIMPLEMENTOU a definição a partir da prosa do comentário em vez de
// executá-la, e este repositório já publicou número errado quatro vezes pelo
// mesmo mecanismo. A resposta certa não é recontar à mão uma quinta vez: é
// tornar RECONTÁVEL. Daí a regra deste arquivo:
//
//   NADA DA DEFINIÇÃO É REESCRITO AQUI. Tudo vem por `import` do index.mjs.
//
// `frasesDeConteudo`, `PRECO_BRL`, `RE_JSX`, `semComentarioNemImport` e
// `lerRepo` são importados, e não copiados, porque a definição são os CINCO
// juntos e não só o casador de frases: `lerRepo` é quem decide QUAIS arquivos
// entram (produção, sem teste, sem fixture, sem `.rebarignore`, sem
// `novo/portao/` nem `novo/site/blocos/`), e o denominador é metade do número.
// Reimplementar a seleção de arquivos é exatamente o erro que a auditoria
// cometeu. Se um dia a definição mudar no index.mjs, esta ferramenta muda junto
// sem ninguém tocar nela — e é para isso que ela serve.
//
// SOBRE A CLASSIFICAÇÃO, E POR QUE ELA PODE ENUMERAR AQUI
//
// "Vocabulário de interface" era uma classificação FEITA À MÃO, frase a frase.
// Mão não se reproduz. Aqui ela é um LÉXICO — marcadores nomeados, escritos
// abaixo, que qualquer um lê e contesta por número de linha.
//
// Isso parece contradizer o comentário da própria regra, que recusa enumerar
// verbo de instrução. Não contradiz, e a diferença é o que a coisa FAZ com o
// achado: a regra ACUSA, e lista incompleta que acusa reprova merge por rótulo
// de campo; este arquivo CONTA, e lista incompleta que conta erra um número que
// vem impresso ao lado da lista que o produziu. Enumeração é proibida no
// enforcement e é a única forma honesta de medição. Por isso `--frases`
// existe: discordar de uma classificação aqui é apontar uma linha, não uma
// impressão.
//
// Este arquivo NUNCA reprova. Sai 0 em qualquer medição — ele mede, não julga.
// Sai 2 só quando a invocação está errada, que não é medição nenhuma.
//
// Uso:
//   node ferramental/rebar-check/medir-conteudo.mjs <repo>...
//   node ferramental/rebar-check/medir-conteudo.mjs <repo>... --frases
//   node ferramental/rebar-check/medir-conteudo.mjs <repo>... --json

import { PRECO_BRL, RE_JSX, frasesDeConteudo, lerRepo, semComentarioNemImport } from './index.mjs'

// ─────────────────────────────────────────────────────────────── o léxico

/**
 * Os marcadores de VOCABULÁRIO DE INTERFACE: texto que fala do PROGRAMA em vez
 * de falar do negócio. Ordem importa — a frase é classificada pelo primeiro que
 * casa, para que a soma por marcador feche com o total sem contar duas vezes.
 *
 * Cada um saiu de frases que estão na amostra, e a nota diz qual, para que
 * ninguém precise adivinhar de onde veio o padrão.
 */
const MARCADORES = [
  {
    id: 'estado-vazio',
    // A frase ANUNCIA ausência de dado, e só conta no COMEÇO dela: "Nenhuma
    // proposta salva ainda." é estado vazio, "Cada peça recebe número próprio"
    // que menciona nenhum no meio não é. Seis na amostra, todas de tela vazia.
    re: /^nenhum(a|as|s)?\b/i,
  },
  {
    id: 'estado-de-erro',
    // Fala de falha do programa. "Não deu para gerar o arquivo:" e "Não deu
    // para falar com o Banco Central agora" são as duas formas do ducado; "Um
    // erro escapou de todos os tratamentos" é o boundary do LinhaK.
    re: /não deu para|não foi possível|\berros?\b|falhou|falha ao|tente novamente|deu errado/i,
  },
  {
    id: 'carregando',
    // Estado transitório. ZERO na amostra dos 11 — o "Carregando o índice de
    // preços…" que a auditoria nomeou mora num `<div>`, e `<div>` não está em
    // PROSA. O marcador fica porque a ausência dele é o achado.
    re: /\bcarregando\b|\baguarde\b|\bprocessando\b|\bsalvando\b|\benviando\b/i,
  },
  {
    id: 'instrucao',
    // Imperativo de INTERAÇÃO, na segunda pessoa. Duas restrições, e as duas
    // custaram medição:
    //
    // O INFINITIVO FICA FORA, e é ele que separa as duas vozes nesta amostra:
    // "Selecionar tampo inteiro, plano e com umidade adequada" é etapa de
    // produção de móvel, "Selecione a forma de pagamento" é operar a tela. As
    // cinco linhas de tarefa do caderno da DÉCIMA ("Pesquisar", "Definir",
    // "Verificar", "Confirmar", "Manter") saem por aqui, sem exceção escrita.
    //
    // O VERBO TEM DE ABRIR ORAÇÃO — começo da frase, depois de pontuação forte,
    // ou depois de travessão/ponto médio, que é como rótulo de interface encadeia
    // ("Opcional — use para tirar ingredientes"). Casar em qualquer posição
    // custava DOIS falsos nas 262, os dois em homógrafo verbo/substantivo:
    // "Reflexo difuso, toque visual nobre e melhor tolerância a micro-riscos" e
    // "Abaixo disso, use apenas o símbolo e preserve o ponto central". Não
    // custou nenhum verdadeiro: "Verifique sua conexão e recarregue a página"
    // entra pelo "Verifique", que abre a segunda oração.
    re: /(?:^|[.!?:…]\s+|[—–·]\s*)(?:clique|toque|arraste|solte|digite|informe|preencha|complete|selecione|escolha|marque|adicione|registre|baixe|envie|salve|confira|verifique|recarregue|use|monte|role|aperte|pressione|abra|feche|tente|refaça)\b/iu,
  },
  {
    id: 'nome-do-programa',
    // O texto chama o programa pelo nome. Léxico curto de propósito: cada termo
    // aqui foi conferido contra as 262, e os que acusavam prosa de negócio
    // FICARAM DE FORA — `servidor` casava "o servidor preenche" do protocolo
    // KWP2000 do LinhaK, e `campos` casava "Este documento define os campos" do
    // certificado da DÉCIMA. Termo que erra numa amostra de 262 não entra.
    // `programa` entrou pelo mesmo teste e passou: um único casamento nas 262
    // ("Seu cofre sai daqui em formato que outro programa abre"), zero falsos.
    re: /\b(o app|este aplicativo|esta página|a página|as telas|a navegação|javascript|navegador|deste computador|neste computador|neste aparelho|os filtros|a busca|programa)\b/i,
  },
  {
    id: 'sobra-de-depuracao',
    // Texto que nunca foi escrito para o visitante. Um na amostra:
    // "esperado 0x… · recebido 0x …", que o próprio comentário da regra já
    // tinha nomeado ao conferir as seis frases em minúscula.
    re: /\b0x/,
  },
]

function classificar(frase) {
  for (const m of MARCADORES) if (m.re.test(frase)) return m.id
  return null
}

// ─────────────────────────────────────────────────────────────── a medição

/**
 * Aplica a definição IMPORTADA a um repositório. As duas formas de literal
 * saem separadas porque elas se contam diferente no index.mjs, e juntá-las é
 * como se erra o total: a FRASE conta uma por nó de texto, o PREÇO conta um
 * por ARQUIVO (`PRECO_BRL.exec` roda uma vez e o achado é registrado uma vez).
 */
function medir(dir) {
  const r = lerRepo(dir)
  if (r.erro) return { dir, erro: r.erro }

  let arquivosJsx = 0
  let arquivosComPreco = 0
  const frases = []

  for (const [rel, bruto] of r.fontes) {
    const t = semComentarioNemImport(bruto)
    if (PRECO_BRL.test(t)) arquivosComPreco++
    if (!RE_JSX.test(rel)) continue
    arquivosJsx++
    for (const frase of frasesDeConteudo(t)) {
      frases.push({ rel, frase, marcador: classificar(frase) })
    }
  }

  return { dir, nome: r.nome, arquivosJsx, arquivosComPreco, frases }
}

// ─────────────────────────────────────────────────────────────────── saída

const cor = process.stdout.isTTY && !process.env.NO_COLOR
const forte = (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s)
const fraco = (s) => (cor ? `\x1b[2m${s}\x1b[0m` : s)

/** Percentual com UMA casa e vírgula: é o formato em que o número foi publicado. */
function pct(parte, todo) {
  if (!todo) return '—'
  return `${(Math.round((parte / todo) * 1000) / 10).toFixed(1).replace('.', ',')}%`
}

function imprimir(medicoes, mostrarFrases) {
  const larg = Math.max(12, ...medicoes.map((m) => (m.nome ?? m.dir).length))
  console.log(
    `\n${forte('repositório'.padEnd(larg))}  ${forte('jsx'.padStart(5))} ` +
      `${forte('frases'.padStart(7))} ${forte('preços'.padStart(7))} ` +
      `${forte('literais'.padStart(9))} ${forte('interface'.padStart(10))} ` +
      `${forte('conteúdo'.padStart(9))}`,
  )

  const tot = { jsx: 0, frases: 0, precos: 0, interface: 0 }
  for (const m of medicoes) {
    if (m.erro) {
      console.log(`${(m.nome ?? m.dir).padEnd(larg)}  ${m.erro}`)
      continue
    }
    const vi = m.frases.filter((f) => f.marcador).length
    tot.jsx += m.arquivosJsx
    tot.frases += m.frases.length
    tot.precos += m.arquivosComPreco
    tot.interface += vi
    console.log(
      `${m.nome.padEnd(larg)}  ${String(m.arquivosJsx).padStart(5)} ` +
        `${String(m.frases.length).padStart(7)} ${String(m.arquivosComPreco).padStart(7)} ` +
        `${String(m.frases.length + m.arquivosComPreco).padStart(9)} ` +
        `${String(vi).padStart(10)} ${String(m.frases.length - vi).padStart(9)}`,
    )
  }

  console.log(
    `${forte('TOTAL'.padEnd(larg))}  ${String(tot.jsx).padStart(5)} ` +
      `${String(tot.frases).padStart(7)} ${String(tot.precos).padStart(7)} ` +
      `${String(tot.frases + tot.precos).padStart(9)} ` +
      `${String(tot.interface).padStart(10)} ` +
      `${String(tot.frases - tot.interface).padStart(9)}`,
  )

  console.log(
    `\n${forte('vocabulário de interface')}: ${tot.interface} de ${tot.frases} = ` +
      forte(pct(tot.interface, tot.frases)),
  )
  console.log(fraco('  (é o número que recusa a promoção da regra a determinística)'))

  console.log(`\n${forte('por marcador')}`)
  for (const mk of MARCADORES) {
    const n = medicoes.reduce(
      (s, m) => s + (m.frases ?? []).filter((f) => f.marcador === mk.id).length,
      0,
    )
    console.log(`  ${mk.id.padEnd(20)} ${String(n).padStart(4)}  ${fraco(String(mk.re))}`)
  }

  if (mostrarFrases) {
    console.log(`\n${forte('as frases, uma a uma')}`)
    let i = 0
    for (const m of medicoes) {
      for (const f of m.frases ?? []) {
        i++
        const rot = f.marcador ? `[${f.marcador}]` : '[conteúdo]'
        console.log(`${String(i).padStart(4)} ${rot.padEnd(22)} ${m.nome}/${f.rel}`)
        console.log(`     ${f.frase}`)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
const mostrarFrases = args.includes('--frases')
const json = args.includes('--json')
const desconhecidas = args.filter((a) => a.startsWith('--') && !/^--(frases|json)$/.test(a))
const alvos = args.filter((a) => !a.startsWith('--'))

if (desconhecidas.length) {
  console.error(`medir-conteudo: opção desconhecida: ${desconhecidas.join(', ')}`)
  process.exit(2)
}
if (!alvos.length) {
  console.error('medir-conteudo: informe pelo menos um repositório.')
  console.error(
    'uso: node ferramental/rebar-check/medir-conteudo.mjs <repo>... [--frases] [--json]',
  )
  process.exit(2)
}

const medicoes = alvos.map(medir)

if (json) {
  const frases = medicoes.flatMap((m) => m.frases ?? [])
  console.log(
    JSON.stringify(
      {
        marcadores: MARCADORES.map((m) => ({ id: m.id, re: String(m.re) })),
        repositorios: medicoes,
        total: {
          frases: frases.length,
          interface: frases.filter((f) => f.marcador).length,
          precos: medicoes.reduce((s, m) => s + (m.arquivosComPreco ?? 0), 0),
        },
      },
      null,
      2,
    ),
  )
} else {
  imprimir(medicoes, mostrarFrases)
}

// Medir não é julgar: sai 0 mesmo quando um alvo não é repositório git — o erro
// dele aparece na linha dele, e o resto da tabela continua valendo.
process.exit(0)
