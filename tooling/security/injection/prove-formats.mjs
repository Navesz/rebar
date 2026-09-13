// THE CONFIG READERS, PROVED ALONE
//
// tooling/security/injection/formats.mjs is what the agent-config and MCP rules
// see instead of the file. If a reader keeps only the last duplicate, drops a
// comment into a value, or decodes an escape the client would not, the rule
// judges a different document than the client runs, and nothing turns red on
// its own. So each behaviour a rule relies on is pinned here.
//
// Every input is built at runtime. A backslash comes from `B`, and the escape
// letters are joined to it only inside the test, so this file spells no
// control escape and holds no raw control or invisible character.
//
//   node --test tooling/security/injection/prove-formats.mjs

import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import {
  FORMATO_POR_EXTENSAO,
  escapesDecodificados,
  lerFrontmatter,
  lerJsonc,
  lerToml,
  lerYaml,
} from './formats.mjs'

const B = String.fromCodePoint(0x5c)
const cp = (...n) => String.fromCodePoint(...n)
const semProto = (v) => JSON.parse(JSON.stringify(v))

describe('lerJsonc', () => {
  test('a nested duplicate is recorded with every occurrence, and valor keeps the last', () => {
    const r = lerJsonc('{"x": {"k": false, "k": true}, "y": 1}')
    assert.equal(r.erro, null)
    assert.equal(r.valor.x.k, true)
    assert.equal(r.duplicatas.length, 1)
    assert.equal(r.duplicatas[0].ponteiro, '/x/k')
    assert.deepEqual(
      r.duplicatas[0].ocorrencias.map((o) => [o.valor, o.linha, o.coluna]),
      [
        [false, 1, 8],
        [true, 1, 20],
      ],
    )
  })

  test('a top-level duplicate holding objects keeps both objects for the caller', () => {
    const r = lerJsonc('{"cfg": {"a": 1},\n "cfg": {}}')
    assert.deepEqual(semProto(r.duplicatas[0].ocorrencias.map((o) => o.valor)), [{ a: 1 }, {}])
    assert.deepEqual(semProto(r.valor), { cfg: {} })
  })

  test('strict JSON rejects a comment and a trailing comma; JSONC accepts both', () => {
    const comComentario = '{\n  // note\n  "a": 1\n}'
    const estrito = lerJsonc(comComentario, { estrito: true })
    assert.equal(estrito.valor, undefined)
    assert.deepEqual([estrito.erro.linha, estrito.erro.coluna], [2, 3])
    assert.match(estrito.erro.mensagem, /comment/)
    assert.equal(lerJsonc(comComentario).valor.a, 1)

    const virgula = '{"a": [1, 2,], "b": 3,}'
    assert.match(lerJsonc(virgula, { estrito: true }).erro.mensagem, /trailing comma/)
    assert.deepEqual(semProto(lerJsonc(virgula).valor), { a: [1, 2], b: 3 })
  })

  test('the nine JSONC edge cases measured in phase 1', () => {
    const comentarios = lerJsonc('{\n // c\n "a": 1, /* b */ "b": [1,2,],\n}')
    assert.ok(!comentarios.erro && comentarios.valor.a === 1 && comentarios.valor.b.length === 2)

    const barras = lerJsonc('{"u":"https://x//y /* z */"}')
    assert.equal(barras.valor.u, 'https://x//y /* z */', 'a comment marker inside a string is text')

    assert.equal(
      lerJsonc(`${cp(0xfeff)}{"a":true}`).valor.a,
      true,
      'one BOM at offset 0 is accepted',
    )

    const dup = lerJsonc('{"x":{"k":false,"k":true}}')
    assert.equal(dup.duplicatas[0].ocorrencias.map((o) => o.valor).join(), 'false,true')

    const aberto = lerJsonc('{\n"a":1 /* aberto')
    assert.deepEqual([aberto.erro.linha, aberto.erro.coluna], [2, 7])

    assert.ok(lerJsonc('{"a":1} x').erro, 'content after the value is an error')
    assert.equal(lerJsonc(`{"k":"${B}u0041"}`).valor.k, 'A')
    assert.ok(lerJsonc('').erro, 'an empty document is an error')

    const proto = lerJsonc('{"__proto__":{"p":1}}')
    assert.equal({}.p, undefined, 'no prototype was polluted')
    assert.equal(proto.valor.__proto__.p, 1)
    assert.equal(Object.getPrototypeOf(proto.valor), null)
  })

  test('keys are compared AFTER decoding, so an escaped key is the same key', () => {
    const r = lerJsonc(`{"modeX": 1, "mode${B}u0058": 2}`)
    assert.deepEqual(Object.keys(r.valor), ['modeX'])
    assert.equal(r.duplicatas[0].ponteiro, '/modeX')
  })

  test('pointers escape ~ and /, and positions count code points', () => {
    const r = lerJsonc(`{"${cp(0x1f600)}": {"a/b~c": [10, 20]}}`)
    assert.ok(r.posicoes.has(`/${cp(0x1f600)}/a~1b~0c/1`))
    assert.deepEqual(r.posicoes.get(`/${cp(0x1f600)}/a~1b~0c`), { linha: 1, coluna: 8 })
  })

  test('a raw control character inside a string and a bad escape are errors', () => {
    assert.match(lerJsonc(`{"a":"x${cp(0x09)}y"}`).erro.mensagem, /control/)
    assert.match(lerJsonc(`{"a":"${B}q"}`).erro.mensagem, /escape/)
  })

  test('nesting has a ceiling, so a hostile file cannot overflow the stack', () => {
    const r = lerJsonc('['.repeat(5000) + ']'.repeat(5000))
    assert.match(r.erro.mensagem, /nesting/)
  })
})

describe('lerToml', () => {
  test('an inline table with an escaped value is decoded', () => {
    const texto = `[mcp_servers.x]\nenv = { NAME = "a${B}u0041${B}x42", nested.k = 'lit${B}n' }\n`
    const r = lerToml(texto)
    assert.equal(r.erro, null)
    assert.equal(r.valor.mcp_servers.x.env.NAME, 'aAB')
    assert.equal(r.valor.mcp_servers.x.env.nested.k, `lit${B}n`, 'a literal string decodes nothing')
    assert.deepEqual(r.posicoes.get('/mcp_servers/x/env/NAME'), { linha: 2, coluna: 9 })
  })

  test('tables, arrays of tables, dotted and quoted keys', () => {
    const texto = [
      '# comment',
      'top = true',
      '[ a . "b.c" ]',
      'd.e = 1979-05-27 07:32:00Z',
      '[[srv]]',
      'n = 1',
      '[[srv]]',
      'n = +2.5',
      '[a]',
      'late = "ok"',
    ].join('\n')
    const r = lerToml(texto)
    assert.equal(r.erro, null)
    assert.deepEqual(semProto(r.valor), {
      top: true,
      a: { 'b.c': { d: { e: '1979-05-27 07:32:00Z' } }, late: 'ok' },
      srv: [{ n: '1' }, { n: '+2.5' }],
    })
    assert.equal(
      r.duplicatas.length,
      0,
      'a table made implicit by [a."b.c"] may get its own header once',
    )
  })

  test('redefining a key or a table is a duplicate, and valor keeps the last', () => {
    const r = lerToml('approval = "a"\napproval = "b"\n[t]\nx = 1\n[t]\ny = 2\n')
    assert.deepEqual(
      r.duplicatas.map((d) => d.ponteiro),
      ['/approval', '/t'],
    )
    assert.deepEqual(
      r.duplicatas[0].ocorrencias.map((o) => [o.valor, o.linha]),
      [
        ['a', 1],
        ['b', 2],
      ],
    )
    assert.equal(r.valor.approval, 'b')
  })

  test('multi-line strings: trimmed first newline, line-ending backslash, extra quotes', () => {
    const texto = `s = """\nline ${B}\n   more """""\nl = '''\nraw ${B}e'''\narr = [\n  "x", # c\n  "y",\n]\n`
    const r = lerToml(texto)
    assert.equal(r.erro, null)
    assert.equal(r.valor.s, 'line more ""')
    assert.equal(r.valor.l, `raw ${B}e`)
    assert.deepEqual(r.valor.arr, ['x', 'y'])
  })

  test('outside the subset is an error, never a guess', () => {
    assert.ok(lerToml('a = bare').erro)
    assert.ok(lerToml(`a = "${B}ud800"`).erro, 'a surrogate escape is not a scalar value')
    assert.ok(lerToml('a = "open').erro)
    assert.ok(lerToml('[a\nb = 1').erro)
  })
})

describe('lerYaml and lerFrontmatter', () => {
  test('a frontmatter quoted key is read, with positions in file coordinates', () => {
    const texto = `---\n"allowed-tools": Bash\n'model': x\ndescription: hello\n---\n# Body\n`
    const fm = lerFrontmatter(texto)
    assert.equal(fm.presente, true)
    assert.equal(fm.erro, null)
    assert.deepEqual(semProto(fm.valor), {
      'allowed-tools': 'Bash',
      model: 'x',
      description: 'hello',
    })
    assert.deepEqual(fm.posicoes.get('/allowed-tools'), { linha: 2, coluna: 1 })
    assert.equal(fm.indice, 4)
    assert.equal(texto.slice(fm.indice, fm.indice + fm.yaml.length), fm.yaml)
  })

  test('no frontmatter unless it starts at offset 0 and closes', () => {
    assert.equal(lerFrontmatter('# title\n---\na: 1\n---\n').presente, false)
    assert.equal(lerFrontmatter('---\na: 1\nno close\n').presente, false)
    const crlf = lerFrontmatter('---\r\na: 1\r\n---\r\nbody')
    assert.deepEqual(semProto(crlf.valor), { a: 1 })
  })

  test('unparseable frontmatter is an error with a file line, and valor null', () => {
    const fm = lerFrontmatter('---\nname: x\nhooks: &h\n  a: 1\n---\n')
    assert.equal(fm.presente, true)
    assert.equal(fm.valor, null)
    assert.equal(fm.erro.linha, 3)
    assert.match(fm.erro.mensagem, /anchors/)
  })

  test('block and flow collections, multi-line quoted and plain scalars, block scalars', () => {
    const texto = [
      'list:',
      '  - plain',
      '  - key: 1',
      '    other: [a, "b",',
      '      {c: d}]',
      '- not part of the list',
    ]
    assert.ok(lerYaml(texto.join('\n')).erro, 'a sequence where a mapping key belongs is an error')
    const bom = [
      'list:',
      '- plain',
      '- key: 1',
      '  other: [a, "b",',
      '    {c: d}]',
      `dq: "one${B}u0041`,
      '  two"',
      "sq: 'it''s",
      "  fine'",
      'plain: first',
      '  second',
      'lit: |2-',
      '    kept',
      '  indent',
      'fold: >',
      '  a',
      '  b',
      '',
      '  c',
      'typed: [~, true, 0x1F, 1.5, .inf, text]',
    ].join('\n')
    const r = lerYaml(bom)
    assert.equal(r.erro, null)
    assert.deepEqual(semProto(r.valor), {
      list: ['plain', { key: 1, other: ['a', 'b', { c: 'd' }] }],
      dq: 'oneA two',
      sq: "it's fine",
      plain: 'first second',
      lit: '  kept\nindent',
      fold: 'a b\nc\n',
      typed: [null, true, 31, 1.5, null, 'text'],
    })
    assert.equal(r.valor.typed[4], Infinity)
    assert.deepEqual(r.posicoes.get('/list/1/other/2/c'), { linha: 5, coluna: 6 })
  })

  test('a repeated key is recorded with every occurrence, block and flow, and valor keeps the last', () => {
    const r = lerYaml('a: 1\nb:\n  c: [x]\n  c: {d: "y"}\na: 2\nf: {g: 1, g: 3}\n')
    assert.equal(r.erro, null)
    assert.deepEqual(semProto(r.valor), { a: 2, b: { c: { d: 'y' } }, f: { g: 3 } })
    assert.deepEqual(
      r.duplicatas.map((d) => [
        d.ponteiro,
        d.ocorrencias.map((o) => [JSON.stringify(o.valor), o.linha, o.coluna]),
      ]),
      [
        [
          '/b/c',
          [
            ['["x"]', 3, 3],
            ['{"d":"y"}', 4, 3],
          ],
        ],
        [
          '/a',
          [
            ['1', 1, 1],
            ['2', 5, 1],
          ],
        ],
        [
          '/f/g',
          [
            ['1', 6, 5],
            ['3', 6, 11],
          ],
        ],
      ],
    )
    const fm = lerFrontmatter(
      '---\nname: s\nallowed-tools: Bash(*)\nallowed-tools: Read\n---\nbody\n',
    )
    assert.equal(fm.erro, null)
    assert.equal(fm.valor['allowed-tools'], 'Read')
    assert.deepEqual(
      fm.duplicatas[0].ocorrencias.map((o) => [o.valor, o.linha]),
      [
        ['Bash(*)', 3],
        ['Read', 4],
      ],
    )
  })

  test('anchors, aliases, tags, merge keys and a second document are errors', () => {
    for (const [texto, padrao] of [
      ['a: &x 1\nb: *x\n', /anchors/],
      ['a: !!str 1\n', /tags/],
      ['<<: {a: 1}\n', /merge/],
      ['a: 1\n---\nb: 2\n', /more than one/],
      ['? complex\n: v\n', /complex/],
      ['a:\n\t- x\n', /tab/],
      ['a: b: c\n', /mapping value/],
    ]) {
      const r = lerYaml(texto)
      assert.equal(r.valor, undefined, JSON.stringify(texto))
      assert.match(r.erro.mensagem, padrao, JSON.stringify(texto))
    }
  })
})

describe('escapesDecodificados', () => {
  test('an even-parity backslash before u001b is not reported; odd parity is', () => {
    const par = `{"a": "${B}${B}u001b[1m"}`
    assert.deepEqual(escapesDecodificados(par, 'json'), [])
    const impar = `{"a": "${B}${B}${B}u001b[1m"}`
    const achados = escapesDecodificados(impar, 'json')
    assert.deepEqual(achados, [{ indice: 9, cp: 0x1b, forma: 'json:u' }])
    assert.equal(impar[achados[0].indice], B)
  })

  test('JSON: surrogate pairs joined, U+0000 omitted, comments and the everyday escapes ignored', () => {
    const texto = [
      `{"k${B}u200b": "${B}ud83d${B}ude00 ${B}u0000 ${B}n${B}t${B}r${B}" ${B}b ${B}f",`,
      ` // "${B}u200b"`,
      ` /* "${B}u200b" */ "z": 1}`,
    ].join('\n')
    assert.deepEqual(
      escapesDecodificados(texto, 'json').map((a) => [a.cp, a.forma]),
      [
        [0x200b, 'json:u'],
        [0x1f600, 'json:u'],
        [0x08, 'json:b'],
        [0x0c, 'json:f'],
      ],
    )
  })

  test('YAML: double-quoted scalars only, block scalars skipped, multi-line quotes followed', () => {
    const texto = [
      `a: "x${B}e[1m"`,
      `b: 'x${B}e'`,
      'c: |',
      `  "${B}e"`,
      `  also ${B}x9b`,
      `d: plain "${B}e"`,
      '- key: |',
      `    body "${B}e"`,
      `  sibling: "${B}x9b"`,
      `e: [ "${B}U000E0041", '${B}e', "${B}N${B}_${B}L${B}P${B}0${B}a${B}v" ]`,
      `f: "first line`,
      `  second ${B}u200B"`,
      `"k${B}e": 1 # "${B}e" in a comment`,
    ].join('\n')
    const achados = escapesDecodificados(texto, 'yaml')
    assert.deepEqual(
      achados.map((a) => [a.cp, a.forma]),
      [
        [0x1b, 'yaml:e'],
        [0x9b, 'yaml:x'],
        [0xe0041, 'yaml:U'],
        [0x85, 'yaml:N'],
        [0xa0, 'yaml:_'],
        [0x2028, 'yaml:L'],
        [0x2029, 'yaml:P'],
        [0x00, 'yaml:0'],
        [0x07, 'yaml:a'],
        [0x0b, 'yaml:v'],
        [0x200b, 'yaml:u'],
        [0x1b, 'yaml:e'],
      ],
    )
    for (const a of achados) assert.equal(texto[a.indice], B)
  })

  test('YAML flow collections: a value glued to a quoted key is decoded, as js-yaml decodes it', () => {
    // `{"k":"v"}` is valid YAML 1.2 in flow context (js-yaml 4.3.2 returns the
    // escaped code point), and the spaced form was already read.
    for (const texto of [
      `{"k":"x${B}u200b"}`,
      `{"k" :"x${B}u200b"}`,
      `a: ["k":"x${B}u200b"]`,
      `{"k": "x${B}u200b"}`,
    ]) {
      assert.deepEqual(
        escapesDecodificados(texto, 'yaml').map((a) => [a.cp, texto[a.indice]]),
        [[0x200b, B]],
        texto,
      )
    }
    // A plain word glued to a colon in a flow map is not a quoted key.
    assert.deepEqual(escapesDecodificados(`{k:"x${B}u200b"}`, 'yaml'), [])
    const skill = `---\n{"name":"x","description":"dates${B}U000E0061${B}U000E0062"}\n---\nbody\n`
    const fm = lerFrontmatter(skill)
    assert.equal(fm.erro, null)
    assert.deepEqual(
      escapesDecodificados(fm.yaml, 'yaml').map((a) => a.cp),
      [0xe0061, 0xe0062],
    )
  })

  test('YAML: a bracket inside a block plain scalar opens nothing, so the next quoted value is decoded', () => {
    // js-yaml reads `a: x "{"` as the plain scalar `x "{"` and still decodes b.
    // Counted as a flow opener, the brace let the next quote open a scalar no
    // parser sees, and that fake scalar swallowed the escape of b.
    for (const primeira of ['a: x "{"', "a: x '['", 'a: x "{" y [', '- x {']) {
      const texto = `${primeira}\nb: "${B}e[8m"\n`
      assert.deepEqual(
        escapesDecodificados(texto, 'yaml').map((a) => [a.cp, texto[a.indice]]),
        [[0x1b, B]],
        primeira,
      )
    }
    // Flow collections still nest wherever a node may start.
    for (const texto of [`a: {k: "${B}e"}`, `a: [x, {k: "${B}e"}]`, `- [ "${B}e" ]`]) {
      assert.deepEqual(
        escapesDecodificados(texto, 'yaml').map((a) => a.cp),
        [0x1b],
        texto,
      )
    }
    // The same shape in a skill's frontmatter: an earlier plain value with a brace.
    const skill =
      `---\nname: demo\ndescription: uses "{" in text\n` +
      `argument-hint: "no${B}u200Btes"\n---\nbody\n`
    const fm = lerFrontmatter(skill)
    assert.equal(fm.erro, null)
    assert.deepEqual(
      escapesDecodificados(fm.yaml, 'yaml').map((a) => a.cp),
      [0x200b],
    )
  })

  test('JSON5: single-quoted strings, hex and vertical-tab escapes, and line continuations', () => {
    const texto = [
      `{ title: 'no${B}u200Btes', "d": "${B}x1b[8m",`,
      `  e: 'it${B}'s ${B}v', f: "a ${B}`,
      `b ${B}u200d", // '${B}x1b'`,
      `  g: 'nul ${B}x00 and ${B}U0001F600' }`,
    ].join('\n')
    assert.deepEqual(
      escapesDecodificados(texto, 'json5').map((a) => [a.cp, a.forma, texto[a.indice]]),
      [
        [0x200b, 'json5:u', B],
        [0x1b, 'json5:x', B],
        [0x0b, 'json5:v', B],
        [0x200d, 'json5:u', B],
      ],
    )
    // Strict JSON reads neither the single quotes nor the hex escape.
    assert.deepEqual(escapesDecodificados(`{ "t": "${B}x1b", "u": 'x${B}u200b' }`, 'json'), [])
    assert.equal(FORMATO_POR_EXTENSAO.json5, 'json5')
  })

  test('YAML frontmatter: the caller adds fm.indice to land on the file', () => {
    const arquivo = `---\ndescription: "hi ${B}e[31m"\n---\nbody "${B}e"\n`
    const fm = lerFrontmatter(arquivo)
    const achados = escapesDecodificados(fm.yaml, 'yaml').map((a) => a.indice + fm.indice)
    assert.equal(achados.length, 1, 'the body is not YAML and is not decoded')
    assert.equal(arquivo.slice(achados[0], achados[0] + 2), `${B}e`)
  })

  test('TOML: basic and multi-line basic strings only; literals and comments skipped', () => {
    const texto = [
      `a = "${B}e"`,
      `b = '${B}e'`,
      `# "${B}e"`,
      'c = """',
      `${B}u001B and ${B}${B}e"""`,
      `d = '''${B}e'''`,
      `"k${B}x1b" = 1`,
      `f = "${B}U0010FFFF ${B}b ${B}f ${B}t"`,
    ].join('\n')
    assert.deepEqual(
      escapesDecodificados(texto, 'toml').map((a) => [a.cp, a.forma]),
      [
        [0x1b, 'toml:e'],
        [0x1b, 'toml:u'],
        [0x1b, 'toml:x'],
        [0x10ffff, 'toml:U'],
        [0x08, 'toml:b'],
        [0x0c, 'toml:f'],
      ],
    )
  })

  test('forma never spells the escape it names, and an unknown format throws', () => {
    for (const formato of ['json', 'json5', 'yaml', 'toml']) {
      for (const a of escapesDecodificados(`"${B}u001b ${B}e ${B}x1b"`, formato)) {
        assert.ok(!a.forma.includes(B), `${formato}: ${a.forma}`)
      }
    }
    assert.throws(() => escapesDecodificados('x', 'xml'), /unknown format/)
  })
})
