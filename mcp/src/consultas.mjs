// As consultas: funções puras sobre o artefato, sem SDK e sem I/O.
//
// Separadas do servidor de propósito. O index.mjs registra ferramentas e fala
// JSON-RPC; aqui só entra artefato e sai texto. Dá para rodar tudo isto com
// `node -e` sem subir servidor nenhum, que é como cada saída deste arquivo foi
// conferida antes de virar resposta de tool.
//
// REGRA DE TAMANHO, que vem da §7.2: NADA DE GUIA LONGO. O MCP do Herz serve 17
// guias, 1.961 linhas, 80 KB, e o próprio repositório admite que "ferramenta MCP é
// discricionária, o modelo decide se chama" — guia gordo é token pago toda sessão
// para ser ignorado. Aqui a resposta mais longa é o catálogo inteiro, 22 regras em
// ~35 linhas, e cada uma aponta o id para pedir o resto sob demanda.

/** Sem acento e em minúscula: "hex-crú" e "HEX CRU" têm de casar com `hex-cru`. */
export function normalizar(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** `determinística` é longo demais para uma coluna de tabela de 22 linhas. */
const SIGLA_CLASSE = { determinística: 'det', heurística: 'heu' }

/** Ordena por nível (N0 primeiro) e, dentro do nível, por id. */
function porNivelEId(a, b) {
  return a.nivel === b.nivel ? a.id.localeCompare(b.id) : a.nivel.localeCompare(b.nivel)
}

/**
 * O catálogo. É a resposta à pergunta que toda IA faz antes de escrever a primeira
 * linha: "o que vai me reprovar aqui?".
 *
 * Agrupado por nível porque o nível é a taxonomia que o projeto usa para decidir
 * ONDE a regra morde (N0 é o compilador, N5 é o hook), e uma lista plana de 22 ids
 * esconde justamente isso.
 */
export function catalogo(artefato, { nivel, classe, busca } = {}) {
  const alvoNivel = nivel ? normalizar(nivel) : null
  const alvoClasse = classe ? normalizar(classe) : null
  const alvoBusca = busca ? normalizar(busca) : null

  let regras = [...artefato.regras]
  if (alvoNivel) regras = regras.filter((r) => normalizar(r.nivel) === alvoNivel)
  if (alvoClasse) regras = regras.filter((r) => normalizar(r.classe).startsWith(alvoClasse))
  if (alvoBusca) {
    regras = regras.filter((r) => normalizar(`${r.id} ${r.titulo}`).includes(alvoBusca))
  }

  if (!regras.length) {
    const filtros = [nivel && `nível ${nivel}`, classe && `classe ${classe}`, busca && `"${busca}"`]
      .filter(Boolean)
      .join(' + ')
    return [
      `Nenhuma das ${artefato.regras.length} regras casa com ${filtros}.`,
      `Níveis com regra: ${[...new Set(artefato.regras.map((r) => r.nivel))].sort().join(', ')}.`,
      'Classes: determinística, heurística.',
    ].join('\n')
  }

  regras.sort(porNivelEId)
  const larguraId = Math.max(...regras.map((r) => r.id.length))
  const descricaoNivel = new Map((artefato.niveis ?? []).map((n) => [n.nivel, n]))

  const saida = []
  let nivelAtual = null
  for (const r of regras) {
    if (r.nivel !== nivelAtual) {
      nivelAtual = r.nivel
      const n = descricaoNivel.get(nivelAtual)
      saida.push('')
      saida.push(n ? `${n.nivel} · ${n.oQueE} — falha como: ${n.falhaComo}` : nivelAtual)
    }
    const sigla = SIGLA_CLASSE[r.classe] ?? r.classe
    saida.push(`  ${r.id.padEnd(larguraId)}  ${sigla}  ${r.titulo}`)
  }

  const det = regras.filter((r) => r.classe === 'determinística').length
  return [
    `${regras.length} regra(s) — ${det} determinística(s) reprovam, ${regras.length - det} heurística(s) só avisam.`,
    ...saida,
    '',
    'det = reprova o commit e o CI. heu = aparece no placar, não barra (só com --heuristicas).',
    'Para a razão medida de uma delas e as provas que a travam: rebar_porque { id }.',
  ].join('\n')
}

/** Índice id → objeto, para regras e decisões, que compartilham o espaço de nomes. */
function indexar(artefato) {
  const m = new Map()
  for (const r of artefato.regras) m.set(r.id, { tipo: 'regra', item: r })
  for (const d of artefato.decisoesFechadas ?? []) m.set(d.id, { tipo: 'decisao', item: d })
  return m
}

/** Sugestão para id errado: prefixo comum, ou substring. Barato e acerta o caso real. */
function parecidos(alvo, ids) {
  const a = normalizar(alvo)
  const perto = ids.filter((id) => {
    const n = normalizar(id)
    return n.includes(a) || a.includes(n) || n.slice(0, 4) === a.slice(0, 4)
  })
  return perto.slice(0, 6)
}

/**
 * O porquê de uma regra — a ferramenta que decide se a IA obedece ou discute.
 *
 * Existe porque regra sem razão é arbitrária, e IA negocia com o arbitrário: apaga o
 * teste, afrouxa o lint, pede exceção. A razão do rebar quase sempre traz o número
 * medido ("100% de falso positivo", "12 repositórios da máquina"), e número medido
 * não se negocia. Por isso o campo `porque` do artefato sai INTEIRO aqui, com o
 * arquivo:linha de onde ele foi lido — o modelo pode ir conferir.
 */
export function porque(artefato, id) {
  const achado = indexar(artefato).get(String(id).trim())
  if (!achado) {
    const ids = [
      ...artefato.regras.map((r) => r.id),
      ...(artefato.decisoesFechadas ?? []).map((d) => d.id),
    ]
    const sugestao = parecidos(id, ids)
    return {
      ok: false,
      texto: [
        `"${id}" não é id de regra nem de decisão fechada.`,
        sugestao.length ? `Perto disso: ${sugestao.join(', ')}` : '',
        'A lista completa sai em rebar_regras (regras) e rebar_decidir (decisões).',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  if (achado.tipo === 'decisao') return { ok: true, texto: formatarDecisao(achado.item, artefato) }
  return { ok: true, texto: formatarRegra(achado.item, artefato) }
}

function formatarRegra(r, artefato) {
  const nivel = (artefato.niveis ?? []).find((n) => n.nivel === r.nivel)
  const linhas = [
    `${r.id} — ${r.titulo}`,
    `${r.nivel}${nivel ? ` (${nivel.oQueE})` : ''} · ${r.classe} · implementada em ${r.fonte.arquivo}:${r.fonte.linha}`,
  ]

  const cabecalho = (r.porque ?? []).filter((p) => p.onde === 'cabecalho')
  const implementacao = (r.porque ?? []).filter((p) => p.onde !== 'cabecalho')

  if (cabecalho.length) {
    linhas.push('', 'POR QUE ELA EXISTE (do cabeçalho da regra, na fonte):')
    for (const p of cabecalho) linhas.push(`  · ${p.texto}  [${r.fonte.arquivo}:${p.linha}]`)
  }
  if (implementacao.length) {
    linhas.push('', 'DA IMPLEMENTAÇÃO (por que ela mede assim, e não do jeito ingênuo):')
    for (const p of implementacao) linhas.push(`  · ${p.texto}  [${r.fonte.arquivo}:${p.linha}]`)
  }

  if (r.provas?.length) {
    linhas.push('', `O QUE TRAVA ESTA REGRA — ${r.provas.length} caso(s) de prova:`)
    for (const p of r.provas) {
      linhas.push(`  ${p.caso}: lado aprovar ${p.aprovar}, lado reprovar ${p.reprovar}`)
      if (p.porque) linhas.push(`    ${p.porque}`)
    }
  }

  if (!cabecalho.length && !implementacao.length && !r.provas?.length) {
    linhas.push('', 'O artefato não trouxe razão escrita para esta regra. Leia a fonte acima.')
  }

  linhas.push('', `Para conferir: node ferramental/rebar-check/index.mjs --regra=${r.id} .`)
  return linhas.join('\n')
}

function formatarDecisao(d, artefato) {
  const linhas = [
    `${d.id} — DECISÃO FECHADA`,
    d.decisao,
    '',
    `Provada em ${d.prova.arquivo}:${d.prova.linha}${d.prova.trecho ? `  →  ${d.prova.trecho}` : ''}`,
  ]
  if (d.porque?.length) {
    linhas.push('', 'POR QUÊ:')
    for (const p of d.porque) linhas.push(`  · ${typeof p === 'string' ? p : p.texto}`)
  }
  if (d.regraQueImpoe) {
    const r = artefato.regras.find((x) => x.id === d.regraQueImpoe)
    linhas.push(
      '',
      `Imposta pela regra ${d.regraQueImpoe}${r ? ` (${r.nivel}, ${r.titulo})` : ''}.`,
    )
  } else {
    linhas.push(
      '',
      'NENHUMA REGRA IMPÕE ESTA DECISÃO HOJE. Ela está registrada e provada em código,',
      'mas o portão não reprova quem a contrariar — trate como acordo, não como barreira.',
    )
  }
  return linhas.join('\n')
}

/**
 * Quantos dos termos aparecem neste campo, casando por PALAVRA, não por substring.
 *
 * Medido: com `includes` cru, o assunto "cor" trazia `readme`, `notice` e `ci-gateia`
 * no topo — casava dentro de "reCORda", "aCORdo", "enCONTRar" — e a regra que
 * realmente fala de cor, `hex-cru`, ficava fora das oito primeiras. Resposta errada
 * com cara de resposta é o defeito que este módulo inteiro persegue.
 *
 * Ainda assim não dá para exigir igualdade: "cor" tem de achar "cores", flexão de
 * português é a regra e não a exceção. O corte é o TAMANHO DO TERMO, também medido:
 *
 *   4 letras ou mais → prefixo livre. "verific" acha "verificar" e "verificação",
 *                      e prefixo longo raramente cai em outra palavra.
 *   3 letras ou menos → só a palavra e o plural dela. Com prefixo livre, "cor"
 *                      trazia "corpo" e "correto", e o topo da lista virava ruído.
 */
function casa(texto, termos) {
  const palavras = normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  let n = 0
  for (const t of termos) {
    const bate =
      t.length >= 4 ? (p) => p.startsWith(t) : (p) => p === t || p === `${t}s` || p === `${t}es`
    if (palavras.some(bate)) n++
  }
  return n
}

/**
 * Onde o termo aparece pesa mais que quantas vezes.
 *
 * "tailwind" no id de uma regra é a resposta; "tailwind" no meio de um parágrafo de
 * justificativa é contexto. Sem peso por campo, o parágrafo longo sempre ganha do id
 * curto, porque tem mais palavras — e a lista sai ordenada por verbosidade.
 */
function pontuar(campos, termos) {
  let pontos = 0
  for (const [texto, peso] of campos) pontos += peso * casa(texto ?? '', termos)
  return pontos
}

// Palavras que não distinguem nada em português. Medido: "banco de dados" sem esta
// lista pontuava 35 entradas, porque "de" e "do" estão em todo parágrafo do artefato,
// e o topo saía ordenado por quem escreveu mais preposição.
// Vão junto as palavras de PERGUNTA ("posso", "como", "qual"): elas entram porque o
// modelo escreve a pergunta inteira no parâmetro, e "como" — 4 letras, prefixo livre —
// casava com "comando" e "completo" em metade do artefato.
const VAZIAS = new Set(
  // Uma string, e não uma lista literal: o prettier quebra lista de 43 itens curtos em
  // 43 linhas, e uma tela de preposição esconde as três linhas de código ao redor.
  (
    'a as ao aos com da das de do dos e em na nas no nos o os ou para pelo por que se sobre um uma ' +
    'como devo esta este isso nao onde pode posso qual quais quando ser sou tem ter'
  ).split(' '),
)

/**
 * "O que este projeto já decidiu sobre X?" — a ferramenta contra a IA que reabre
 * discussão fechada.
 *
 * Ela responde três coisas diferentes, e a terceira é a que importa:
 *   1. decisão fechada sobre o assunto, com o arquivo:linha que a prova;
 *   2. regra que impõe o assunto, com nível;
 *   3. NADA — e aí ela diz que nada impõe isso, em vez de inventar. O artefato tem
 *      um campo `naoDerivado` justamente para os assuntos que o rebar de propósito
 *      NÃO governa, e devolver esse campo é mais útil que devolver silêncio.
 */
export function decidir(artefato, assunto) {
  const termos = normalizar(assunto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !VAZIAS.has(t))
  if (!termos.length) return 'Diga o assunto. Exemplos: "tailwind", "cor", "env", "commit", "css".'

  const achados = []

  for (const d of artefato.decisoesFechadas ?? []) {
    const corpo = (d.porque ?? []).map((p) => (typeof p === 'string' ? p : p.texto)).join(' ')
    const p = pontuar(
      [
        [d.id.replace(/-/g, ' '), 8],
        [d.decisao, 4],
        [d.prova?.trecho, 3],
        [corpo, 1],
      ],
      termos,
    )
    if (p) {
      achados.push({
        // Decisão fechada é a resposta direta à pergunta "o que já foi decidido";
        // regra é o mecanismo. Empatou, a decisão vem primeiro.
        p: p + 1,
        linha: `[decisão] ${d.id} — ${d.decisao}`,
        detalhe: `           prova: ${d.prova.arquivo}:${d.prova.linha} · rebar_porque { id: "${d.id}" }`,
      })
    }
  }

  for (const r of artefato.regras) {
    const razoes = (r.porque ?? []).map((x) => x.texto).join(' ')
    const provas = (r.provas ?? []).map((x) => `${x.caso} ${x.porque ?? ''}`).join(' ')
    const p = pontuar(
      [
        [r.id.replace(/-/g, ' '), 8],
        [r.titulo, 4],
        [razoes, 1],
        [provas, 1],
      ],
      termos,
    )
    if (p) {
      achados.push({
        p,
        linha: `[regra ${r.nivel} ${SIGLA_CLASSE[r.classe] ?? r.classe}] ${r.id} — ${r.titulo}`,
        detalhe: `           rebar_porque { id: "${r.id}" }`,
      })
    }
  }

  for (const passo of artefato.portao?.passos ?? []) {
    const p = pontuar(
      [
        [passo.nome, 8],
        [(passo.comando ?? []).join(' '), 3],
        [passo.dica, 1],
      ],
      termos,
    )
    if (p) {
      achados.push({
        p,
        linha: `[portão passo ${passo.ordem}] ${passo.nome}`,
        detalhe: `           ${passo.comando ? passo.comando.join(' ') : 'função interna do verificar'}`,
      })
    }
  }

  for (const ref of artefato.referencias ?? []) {
    const p = pontuar(
      [
        [ref.assunto.replace(/-/g, ' '), 6],
        [ref.oQueEsta, 2],
      ],
      termos,
    )
    if (p) {
      achados.push({
        p,
        linha: `[prosa] ${ref.assunto} — ${ref.oQueEsta}`,
        detalhe: `           ${ref.arquivo}:${ref.linha}  (leia lá; não copio prosa para cá)`,
      })
    }
  }

  if (!achados.length) {
    return [
      `Nada no artefato decide "${assunto}".`,
      '',
      'Isso é resposta, não falha: significa que o portão do rebar NÃO impõe isso hoje,',
      'e portanto ninguém vai te reprovar por causa disso — mas também ninguém garante.',
      '',
      'O que o rebar de propósito NÃO derivou para cá:',
      ...(artefato.naoDerivado ?? []).map((s) => `  · ${s}`),
      '',
      'Se for decisão de projeto de verdade, ela ainda não existe legível por máquina.',
      'O lugar de nascer é a regra em ferramental/rebar-check/index.mjs — e aí o artefato',
      'a recebe de graça, no próximo `node mcp/gerar.mjs`.',
    ].join('\n')
  }

  achados.sort((a, b) => b.p - a.p)
  const topo = achados.slice(0, 8)
  return [
    `${achados.length} entrada(s) do artefato falam de "${assunto}"${achados.length > topo.length ? `; as ${topo.length} mais fortes` : ''}:`,
    '',
    ...topo.flatMap((a) => [a.linha, a.detalhe]),
  ].join('\n')
}

/**
 * O portão, na ordem, com o comando de cada passo.
 *
 * A §7.2 é explícita: O MCP NUNCA É A PORTA. Esta ferramenta existe para dizer onde
 * a porta fica, não para ser ela. Por isso ela devolve COMANDO — o mesmo que o hook
 * e o CI rodam — em vez de um veredito próprio.
 */
export function portao(artefato, passoPedido) {
  const passos = artefato.portao?.passos ?? []

  if (passoPedido) {
    const alvo = normalizar(passoPedido)
    const p = passos.find((x) => normalizar(x.nome) === alvo || String(x.ordem) === alvo)
    if (!p) {
      return `Passo "${passoPedido}" não existe. Os ${passos.length}: ${passos.map((x) => x.nome).join(', ')}.`
    }
    return [
      `Passo ${p.ordem} de ${passos.length}: ${p.nome}`,
      p.comando ? `comando: ${p.comando.join(' ')}` : 'tipo: função interna do verificar.mjs',
      '',
      'QUANDO ESTE REPROVA:',
      p.dica ?? '(o artefato não trouxe dica para este passo)',
    ].join('\n')
  }

  const largura = Math.max(...passos.map((p) => p.nome.length))
  const linhas = passos.map(
    (p) =>
      `  ${String(p.ordem).padStart(2)}. ${p.nome.padEnd(largura)}  ${p.comando ? p.comando.join(' ') : '(função interna)'}`,
  )

  const codigos = Object.entries(artefato.codigosDeSaida ?? {}).map(([k, v]) => `  ${k} = ${v}`)

  return [
    `A PORTA É ESTE COMANDO, não este MCP: ${artefato.portao?.comando ?? 'npm run verificar'}`,
    `${passos.length} passos, na ordem, parando no primeiro que reprovar:`,
    ...linhas,
    '',
    'Códigos de saída do rebar-check:',
    ...codigos,
    '',
    'Para o que fazer quando um passo reprova: rebar_portao { passo: "<nome>" }.',
  ].join('\n')
}
