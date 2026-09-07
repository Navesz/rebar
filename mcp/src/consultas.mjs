// The queries: pure functions over the artifact, no SDK and no I/O.
//
// Kept apart from the server on purpose. index.mjs registers tools and speaks
// JSON-RPC; here only the artifact goes in and text comes out. All of this runs
// under `node -e` with no server up at all, which is how every output of this
// file was checked before it became a tool answer.
//
// SIZE RULE, straight out of §7.2: NO LONG GUIDES. The Herz MCP serves 17 guides,
// 1,961 lines, 80 KB, and that repository itself admits "ferramenta MCP é
// discricionária, o modelo decide se chama" [an MCP tool is discretionary, the
// model decides whether to call it] — a fat guide is a token paid every session
// to be ignored. Here the longest answer is the whole catalog, 22 rules in ~35
// lines, and each one points at the id to ask for the rest on demand.

/** Unaccented and lowercase: "hex-crú" and "HEX CRU" have to match `hex-cru`. */
export function normalizar(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

// The keys stay in Portuguese: they are the class VALUES the artifact carries,
// not prose. Translating them makes every lookup miss and the column go blank.
/** `determinística` is too long for a column in a 22-row table. */
const SIGLA_CLASSE = { determinística: 'det', heurística: 'heu' }

/** Sorts by level (N0 first) and, inside a level, by id. */
function porNivelEId(a, b) {
  return a.nivel === b.nivel ? a.id.localeCompare(b.id) : a.nivel.localeCompare(b.nivel)
}

/**
 * The catalog. It is the answer to the question every AI asks before writing the
 * first line: "what is going to fail me here?".
 *
 * Grouped by level because the level is the taxonomy the project uses to decide
 * WHERE the rule bites (N0 is the compiler, N5 is the hook), and a flat list of 22
 * ids hides exactly that.
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
    const filtros = [nivel && `level ${nivel}`, classe && `class ${classe}`, busca && `"${busca}"`]
      .filter(Boolean)
      .join(' + ')
    return [
      `None of the ${artefato.regras.length} rules match ${filtros}.`,
      `Levels with a rule: ${[...new Set(artefato.regras.map((r) => r.nivel))].sort().join(', ')}.`,
      // The two class names stay in Portuguese: they are the values the caller has
      // to pass and the values the artifact stores. Translated, the filter misses.
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
      saida.push(n ? `${n.nivel} · ${n.oQueE} — fails as: ${n.falhaComo}` : nivelAtual)
    }
    const sigla = SIGLA_CLASSE[r.classe] ?? r.classe
    // Which binary runs the rule, and only when it is NOT the default one.
    //
    // Without this mark the list mixes the two modules and whoever reads it tries
    // `npx rebar --rule=env-committed`, which does not know the rule and exits
    // with code 2. Marking the 23 of rebar-check too would fill the column with
    // noise to say "the usual one"; marking only the exception is what reads fast.
    const onde = r.modulo && r.modulo !== 'rebar-check' ? '  ⟨seg⟩' : ''
    saida.push(`  ${r.id.padEnd(larguraId)}  ${sigla}  ${r.titulo}${onde}`)
  }

  const det = regras.filter((r) => r.classe === 'determinística').length
  return [
    `${regras.length} rule(s) — ${det} deterministic one(s) fail, ${regras.length - det} heuristic one(s) only warn.`,
    ...saida,
    '',
    'det = fails the commit and the CI. heu = shows in the scoreboard, does not block (only with --heuristics).',
    ...(regras.some((r) => r.modulo === 'rebar-security')
      ? ['⟨seg⟩ = a rebar-security rule. Runs with `rebar-security`, not with `rebar`.']
      : []),
    'For the measured reason behind one of them and the proofs that lock it: rebar_porque { id }.',
  ].join('\n')
}

/** Index id → object, for rules and decisions, which share the name space. */
function indexar(artefato) {
  const m = new Map()
  for (const r of artefato.regras) m.set(r.id, { tipo: 'regra', item: r })
  for (const d of artefato.decisoesFechadas ?? []) m.set(d.id, { tipo: 'decisao', item: d })
  return m
}

/** Suggestion for a wrong id: common prefix, or substring. Cheap, and it hits the real case. */
function parecidos(alvo, ids) {
  const a = normalizar(alvo)
  const perto = ids.filter((id) => {
    const n = normalizar(id)
    return n.includes(a) || a.includes(n) || n.slice(0, 4) === a.slice(0, 4)
  })
  return perto.slice(0, 6)
}

/**
 * The why of a rule — the tool that decides whether the AI obeys or argues.
 *
 * It exists because a rule without a reason is arbitrary, and AI negotiates with the
 * arbitrary: deletes the test, loosens the lint, asks for an exception. A rebar
 * reason almost always brings the measured number ("100% false positive", "12
 * repositories on the machine"), and a measured number is not negotiable. That is
 * why the artifact's `porque` field comes out WHOLE here, with the file:line it was
 * read from — the model can go check.
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
        `"${id}" is not a rule id nor a closed-decision id.`,
        // prova-cliente.mjs matches this line by regex to check that the wrong id
        // gets a neighbour and the id from another world gets none. Change the
        // wording here and change it there, or the contract stops being checked.
        sugestao.length ? `Close to that: ${sugestao.join(', ')}` : '',
        'The full list comes out of rebar_regras (rules) and rebar_decidir (decisions).',
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
    `${r.nivel}${nivel ? ` (${nivel.oQueE})` : ''} · ${r.classe} · implemented at ${r.fonte.arquivo}:${r.fonte.linha}`,
  ]

  const cabecalho = (r.porque ?? []).filter((p) => p.onde === 'cabecalho')
  const implementacao = (r.porque ?? []).filter((p) => p.onde !== 'cabecalho')

  if (cabecalho.length) {
    linhas.push('', 'WHY IT EXISTS (from the rule header, in the source):')
    for (const p of cabecalho) linhas.push(`  · ${p.texto}  [${r.fonte.arquivo}:${p.linha}]`)
  }
  if (implementacao.length) {
    linhas.push('', 'FROM THE IMPLEMENTATION (why it measures this way, and not the naive way):')
    for (const p of implementacao) linhas.push(`  · ${p.texto}  [${r.fonte.arquivo}:${p.linha}]`)
  }

  if (r.provas?.length) {
    linhas.push('', `WHAT LOCKS THIS RULE — ${r.provas.length} proof case(s):`)
    for (const p of r.provas) {
      linhas.push(`  ${p.caso}: pass side ${p.aprovar}, fail side ${p.reprovar}`)
      if (p.porque) linhas.push(`    ${p.porque}`)
    }
  }

  if (!cabecalho.length && !implementacao.length && !r.provas?.length) {
    linhas.push('', 'The artifact brought no written reason for this rule. Read the source above.')
  }

  linhas.push('', `To check it: node tooling/rebar-check/index.mjs --rule=${r.id} .`)
  return linhas.join('\n')
}

function formatarDecisao(d, artefato) {
  const linhas = [
    `${d.id} — CLOSED DECISION`,
    d.decisao,
    '',
    `Proved at ${d.prova.arquivo}:${d.prova.linha}${d.prova.trecho ? `  →  ${d.prova.trecho}` : ''}`,
  ]
  if (d.porque?.length) {
    linhas.push('', 'WHY:')
    for (const p of d.porque) linhas.push(`  · ${typeof p === 'string' ? p : p.texto}`)
  }
  if (d.regraQueImpoe) {
    const r = artefato.regras.find((x) => x.id === d.regraQueImpoe)
    linhas.push('', `Enforced by rule ${d.regraQueImpoe}${r ? ` (${r.nivel}, ${r.titulo})` : ''}.`)
  } else {
    linhas.push(
      '',
      'NO RULE ENFORCES THIS DECISION TODAY. It is recorded and proved in code,',
      'but the gate does not fail whoever contradicts it — treat it as an agreement, not a barrier.',
    )
  }
  return linhas.join('\n')
}

/**
 * How many of the terms show up in this field, matching by WORD, not by substring.
 *
 * The example words below stay in Portuguese, and so do the `${t}s`/`${t}es` plurals
 * in the code: they are the measurement, and the artifact text being searched is
 * Portuguese. Translated, the examples stop describing what was measured.
 *
 * Measured: with raw `includes`, the subject "cor" pulled `readme`, `notice` and
 * `ci-gateia` to the top — it matched inside "reCORda", "aCORdo", "enCONTRar" — and
 * the rule that really talks about color, `hex-cru`, fell outside the first eight. A
 * wrong answer with the face of an answer is the defect this whole module chases.
 *
 * Even so, equality cannot be demanded: "cor" has to find "cores"; inflection is the
 * rule in Portuguese, not the exception. The cut is the TERM LENGTH, also measured:
 *
 *   4 letters or more → free prefix. "verific" finds "verificar" and "verificação",
 *                       and a long prefix rarely lands in another word.
 *   3 letters or less → only the word and its plural. With a free prefix, "cor"
 *                       pulled "corpo" and "correto", and the top of the list turned
 *                       to noise.
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
 * Where the term shows up weighs more than how many times.
 *
 * "tailwind" in a rule id is the answer; "tailwind" in the middle of a paragraph of
 * justification is context. Without a per-field weight, the long paragraph always
 * beats the short id, because it has more words — and the list comes out sorted by
 * verbosity.
 */
function pontuar(campos, termos) {
  let pontos = 0
  for (const [texto, peso] of campos) pontos += peso * casa(texto ?? '', termos)
  return pontos
}

// Words that distinguish nothing in Portuguese. THE LIST ITSELF STAYS PORTUGUESE:
// it is the stopword filter for the subject the caller types, and the artifact it
// searches is written in Portuguese. Translate the words and the filter stops
// filtering. Measured: "banco de dados" without this list scored 35 entries, because
// "de" and "do" are in every paragraph of the artifact, and the top came out sorted
// by whoever wrote the most prepositions.
// The QUESTION words go in too ("posso", "como", "qual"): they are here because the
// model writes the whole question into the parameter, and "como" — 4 letters, free
// prefix — matched "comando" and "completo" in half the artifact.
const VAZIAS = new Set(
  // One string, and not a literal list: prettier breaks a list of 43 short items into
  // 43 lines, and a screenful of prepositions hides the three code lines around it.
  (
    'a as ao aos com da das de do dos e em na nas no nos o os ou para pelo por que se sobre um uma ' +
    'como devo esta este isso nao onde pode posso qual quais quando ser sou tem ter'
  ).split(' '),
)

/**
 * "What has this project already decided about X?" — the tool against the AI that
 * reopens a closed discussion.
 *
 * It answers three different things, and the third is the one that matters:
 *   1. a closed decision on the subject, with the file:line that proves it;
 *   2. a rule that enforces the subject, with its level;
 *   3. NOTHING — and then it says nothing enforces that, instead of inventing. The
 *      artifact has a `naoDerivado` field precisely for the subjects rebar on
 *      purpose does NOT govern, and returning that field beats returning silence.
 */
export function decidir(artefato, assunto) {
  const termos = normalizar(assunto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !VAZIAS.has(t))
  // "cor" stays as it is: the examples are queries run against the artifact's own
  // text, which is Portuguese. An English example here would return nothing.
  if (!termos.length) return 'Say the subject. Examples: "tailwind", "cor", "env", "commit", "css".'

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
        // A closed decision is the direct answer to "what was already decided";
        // a rule is the mechanism. On a tie, the decision comes first.
        p: p + 1,
        linha: `[decision] ${d.id} — ${d.decisao}`,
        detalhe: `           proof: ${d.prova.arquivo}:${d.prova.linha} · rebar_porque { id: "${d.id}" }`,
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
        linha: `[rule ${r.nivel} ${SIGLA_CLASSE[r.classe] ?? r.classe}] ${r.id} — ${r.titulo}`,
        detalhe: `           rebar_porque { id: "${r.id}" }`,
      })
    }
  }

  for (const passo of artefato.gate?.passos ?? []) {
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
        linha: `[gate step ${passo.ordem}] ${passo.nome}`,
        detalhe: `           ${passo.comando ? passo.comando.join(' ') : 'internal function of the verifier'}`,
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
        linha: `[prose] ${ref.assunto} — ${ref.oQueEsta}`,
        detalhe: `           ${ref.arquivo}:${ref.linha}  (read it there; I do not copy prose over here)`,
      })
    }
  }

  if (!achados.length) {
    return [
      `Nothing in the artifact decides "${assunto}".`,
      '',
      'That is an answer, not a failure: it means the rebar gate does NOT enforce this',
      'today, so nobody will fail you over it — and nobody guarantees it either.',
      '',
      'What rebar on purpose did NOT derive over here:',
      ...(artefato.naoDerivado ?? []).map((s) => `  · ${s}`),
      '',
      'If it is a real project decision, it does not exist machine-readable yet.',
      'The place to be born is the rule in tooling/rebar-check/index.mjs — and then the',
      'artifact gets it for free, on the next `node mcp/generate.mjs`.',
    ].join('\n')
  }

  achados.sort((a, b) => b.p - a.p)
  const topo = achados.slice(0, 8)
  return [
    `${achados.length} artifact entry(ies) talk about "${assunto}"${achados.length > topo.length ? `; the ${topo.length} strongest` : ''}:`,
    '',
    ...topo.flatMap((a) => [a.linha, a.detalhe]),
  ].join('\n')
}

/**
 * The gate, in order, with the command of each step.
 *
 * §7.2 is explicit: THE MCP IS NEVER THE DOOR. This tool exists to say where the
 * door is, not to be it. That is why it returns a COMMAND — the same one the hook
 * and the CI run — instead of a verdict of its own.
 */
export function portao(artefato, passoPedido) {
  const passos = artefato.gate?.passos ?? []

  if (passoPedido) {
    const alvo = normalizar(passoPedido)
    const p = passos.find((x) => normalizar(x.nome) === alvo || String(x.ordem) === alvo)
    if (!p) {
      return `Step "${passoPedido}" does not exist. The ${passos.length}: ${passos.map((x) => x.nome).join(', ')}.`
    }
    return [
      `Step ${p.ordem} of ${passos.length}: ${p.nome}`,
      p.comando ? `command: ${p.comando.join(' ')}` : 'type: internal function of verificar.mjs',
      '',
      'WHEN THIS ONE FAILS:',
      p.dica ?? '(the artifact brought no hint for this step)',
    ].join('\n')
  }

  const largura = Math.max(...passos.map((p) => p.nome.length))
  const linhas = passos.map(
    (p) =>
      `  ${String(p.ordem).padStart(2)}. ${p.nome.padEnd(largura)}  ${p.comando ? p.comando.join(' ') : '(internal function)'}`,
  )

  const codigos = Object.entries(artefato.codigosDeSaida ?? {}).map(([k, v]) => `  ${k} = ${v}`)

  return [
    `THE DOOR IS THIS COMMAND, not this MCP: ${artefato.gate?.comando ?? 'npm run verify'}`,
    `${passos.length} steps, in order, stopping at the first one that fails:`,
    ...linhas,
    '',
    'Exit codes of rebar-check:',
    ...codigos,
    '',
    'For what to do when a step fails: rebar_portao { passo: "<name>" }.',
  ].join('\n')
}
