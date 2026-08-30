// Domínio: privilégio de banco. Fitness test.
//
// Asserção de catálogo prova que a CONFIGURAÇÃO foi aplicada.
// Execução hostil prova que a FUGA não funciona. São perguntas diferentes,
// e só a segunda é sobre segurança.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const HOST = '127.0.0.1'
const PORT = 55432
const DB = 'rebar_teste'

/** Pool de runtime: autentica como app_login e vira app na barreira. */
function poolDeRuntime(extra = {}) {
  return new pg.Pool({
    host: HOST,
    port: PORT,
    database: DB,
    user: 'app_login',
    password: 'app_dev_only',
    max: 4,
    connectionTimeoutMillis: 5_000,
    // A barreira de aquisição. Não `pool.on('connect')`: aquele entrega o
    // client antes de validar, e o pg 9.0 vai remover a fila que hoje o salva.
    onConnect: async (client) => {
      await client.query('SET ROLE app')
      await client.query("SET TIME ZONE 'UTC'")
    },
    ...extra,
  })
}

/**
 * Pool descartável para teste que suja o estado de role da conexão.
 *
 * Necessário por causa do achado documentado abaixo: `onConnect` é barreira
 * por conexão FÍSICA, não por checkout. Um `RESET ROLE` sobrevive ao release e
 * contamina quem pegar a conexão depois — inclusive outro teste.
 */
async function comPoolDescartavel(fn) {
  const p = poolDeRuntime({ max: 1 })
  try {
    await fn(p)
  } finally {
    await p.end()
  }
}

let runtime

before(() => {
  runtime = poolDeRuntime()
})
after(async () => {
  await runtime?.end()
})

// ─────────────────────────────────────────────────────── positivo

test('a conexão de runtime tem session_user app_login e current_user app', async () => {
  const { rows } = await runtime.query(
    'SELECT session_user, current_user, current_setting($1) AS tz',
    ['TimeZone'],
  )
  assert.equal(rows[0].session_user, 'app_login')
  assert.equal(rows[0].current_user, 'app')
  assert.equal(rows[0].tz, 'UTC')
})

test('app faz DML na tabela que lhe foi concedida', async () => {
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    await c.query('INSERT INTO pedido (tenant_id, descricao) VALUES ($1, $2)', ['acme', 'primeiro'])
    const { rows } = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.ok(rows[0].n >= 1)
  } finally {
    c.release()
  }
})

test('o trigger incrementa version sem o UPDATE mencioná-la', async () => {
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    const ins = await c.query(
      'INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2) RETURNING id, version',
      ['acme', 'v'],
    )
    const { id, version } = ins.rows[0]
    // Repare: o UPDATE NÃO fala de version. É exatamente o que um agente escreveria.
    const upd = await c.query('UPDATE pedido SET descricao = $1 WHERE id = $2 RETURNING version', [
      'w',
      id,
    ])
    assert.equal(
      Number(upd.rows[0].version),
      Number(version) + 1,
      'version tem de subir sozinha — senão a barreira otimista depende de memória',
    )
  } finally {
    c.release()
  }
})

// ─────────────────────────────────────────────────────── hostil

test('HOSTIL · RESET ROLE não eleva privilégio: cai em app_login, que não lê nada', async () => {
  await comPoolDescartavel(async (pool) => {
    const c = await pool.connect()
    try {
      await c.query('RESET ROLE')
      const { rows } = await c.query('SELECT current_user')
      assert.equal(
        rows[0].current_user,
        'app_login',
        'RESET tem de cair em app_login, nunca em app',
      )
      await assert.rejects(
        () => c.query('SELECT * FROM pedido'),
        (e) => e.code === '42501', // insufficient_privilege
        'app_login não pode ler a tabela protegida',
      )
    } finally {
      c.release()
    }
  })
})

test('HOSTIL · SET ROLE db_owner é recusado', async () => {
  const c = await runtime.connect()
  try {
    await assert.rejects(
      () => c.query('SET ROLE db_owner'),
      (e) => e.code === '42501',
    )
  } finally {
    c.release()
  }
})

test('HOSTIL · não há connection-time setting de role', async () => {
  // A premissa que decide o caso do RESET ROLE, e que estava escondida atrás de
  // uma elipse na citação. Três vetores: ALTER ROLE, ALTER DATABASE, e
  // `options=-c role=...` na string de conexão — este último não passa por SQL.
  await comPoolDescartavel(async (pool) => {
    const c = await pool.connect()
    try {
      await c.query('RESET ROLE')
      const { rows } = await c.query("SELECT coalesce(current_setting('role', true), '') AS r")
      assert.ok(
        rows[0].r === '' || rows[0].r === 'none',
        `role de connection-time existe (${rows[0].r}) — o RESET cairia nela`,
      )
    } finally {
      c.release()
    }
  })
})

test('HOSTIL · app não faz DDL', async () => {
  const c = await runtime.connect()
  try {
    await assert.rejects(
      () => c.query('CREATE TABLE intruso (id int)'),
      (e) => e.code === '42501',
    )
  } finally {
    c.release()
  }
})

test('HOSTIL · a SECURITY DEFINER não é executável por PUBLIC', async () => {
  const c = await runtime.connect()
  try {
    await assert.rejects(
      () => c.query('SELECT vazamento()'),
      (e) => e.code === '42501',
      'função SECURITY DEFINER do db_owner acessível é escalada de privilégio',
    )
  } finally {
    c.release()
  }
})

// ────────────────────────────────────────────── catálogo: privilégio efetivo

test('CATÁLOGO · capacidade efetiva, não atributo', async () => {
  const c = await runtime.connect()
  try {
    const {
      rows: [r],
    } = await c.query(`
      SELECT pg_has_role('app_login','db_owner','SET')                 AS pode_virar_owner,
             pg_has_role('app_login','app','USAGE')                    AS herda_app,
             pg_has_role('app_login','app','SET')                      AS pode_virar_app,
             has_table_privilege('app_login','public.pedido','SELECT') AS le_pedido,
             has_function_privilege('app_login','public.vazamento()','EXECUTE') AS executa_isca`)
    assert.equal(r.pode_virar_owner, false, 'app_login não pode virar db_owner')
    assert.equal(r.herda_app, false, 'INHERIT FALSE: não herda app sem SET ROLE')
    assert.equal(r.pode_virar_app, true, 'precisa poder virar app')
    assert.equal(r.le_pedido, false, 'app_login não lê a tabela diretamente')
    assert.equal(r.executa_isca, false, 'PUBLIC não pode executar a SECURITY DEFINER')
  } finally {
    c.release()
  }
})

test('CATÁLOGO · atributos das três roles', async () => {
  const c = await runtime.connect()
  try {
    const { rows } = await c.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
        FROM pg_roles WHERE rolname IN ('db_owner','app','app_login') ORDER BY rolname`)
    const por = Object.fromEntries(rows.map((r) => [r.rolname, r]))
    for (const nome of ['db_owner', 'app', 'app_login']) {
      assert.ok(por[nome], `role ${nome} existe`)
      assert.equal(por[nome].rolsuper, false, `${nome} não é superusuário`)
      assert.equal(por[nome].rolbypassrls, false, `${nome} não contorna RLS`)
      assert.equal(por[nome].rolcreatedb, false)
      assert.equal(por[nome].rolcreaterole, false)
    }
    assert.equal(por.app.rolcanlogin, false, 'app é NOLOGIN: ninguém autentica como ela')
    assert.equal(
      por.app_login.rolinherit,
      false,
      'app_login é NOINHERIT — a peça que faz funcionar',
    )
  } finally {
    c.release()
  }
})

test('CATÁLOGO · o conjunto de memberships é exatamente o esperado', async () => {
  const c = await runtime.connect()
  try {
    const { rows } = await c.query(`
      SELECT m.rolname AS membro, g.rolname AS grupo
        FROM pg_auth_members am
        JOIN pg_roles m ON m.oid = am.member
        JOIN pg_roles g ON g.oid = am.roleid
       WHERE m.rolname IN ('db_owner','app','app_login')
          OR g.rolname IN ('db_owner','app','app_login')
       ORDER BY 1,2`)
    const real = rows.map((r) => `${r.membro}->${r.grupo}`).sort()
    assert.deepEqual(real, ['app_login->app'], `membership inesperada: ${JSON.stringify(real)}`)
  } finally {
    c.release()
  }
})

// ──────────────────────────────────── a barreira de aquisição, camada driver

test('BARREIRA · onConnect que falha destrói a conexão e rejeita o acquire', async () => {
  const ruim = new pg.Pool({
    host: HOST,
    port: PORT,
    database: DB,
    user: 'app_login',
    password: 'app_dev_only',
    max: 2,
    connectionTimeoutMillis: 5_000,
    onConnect: async (client) => {
      await client.query('SET ROLE inexistente')
    },
  })
  try {
    await assert.rejects(
      () => ruim.connect(),
      /inexistente|does not exist|42704/i,
      'o acquire tem de rejeitar — o client nunca pode ser entregue com o privilégio errado',
    )
    assert.equal(ruim.totalCount, 0, 'a conexão tem de ser destruída, não devolvida ao pool')
  } finally {
    await ruim.end()
  }
})

// ──────────────────────────────────── RLS: o que funciona e o que ainda não

test('RLS · tenant não vê linha de outro tenant', async () => {
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    await c.query('INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2)', ['acme', 'da acme'])
    await c.query("SELECT set_config('rebar.tenant_id', 'outra', false)")
    const { rows } = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.equal(rows[0].n, 0, 'com outro tenant no contexto, nenhuma linha da acme aparece')
  } finally {
    c.release()
  }
})

test('RLS · ACHADO CONHECIDO: o GUC de tenant é USERSET — app troca o próprio contexto', async () => {
  // Isto NÃO é uma regressão: é a fronteira que a revisão apontou e que ainda
  // não tem solução no documento. O teste existe para que ela pare de ser
  // invisível — quando o canal de tenant for fechado, este teste inverte.
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    await c.query('INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2)', ['acme', 'segredo'])
    await c.query("SELECT set_config('rebar.tenant_id', 'invasor', false)")
    const antes = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.equal(antes.rows[0].n, 0)
    // A própria sessão restaura o contexto do outro tenant. Nada impede.
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    const depois = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.ok(
      depois.rows[0].n > 0,
      'documentado: custom GUC é USERSET, então o isolamento de tenant NÃO está fechado',
    )
  } finally {
    c.release()
  }
})

// ─────────────────────────── ACHADO NOVO: a barreira é por conexão, não por uso

test('ACHADO · onConnect é barreira por conexão FÍSICA — RESET ROLE sobrevive ao release', async () => {
  // Encontrado rodando o código, não lendo o documento. Nem a revisão humana
  // nem os seis agentes pegaram: só aparece quando a conexão volta ao pool.
  //
  // Aqui FALHA FECHADO — o próximo request perde privilégio e toma 42501.
  // Num desenho em que o session_user fosse privilegiado (o estado atual do
  // prumo), falharia ABERTO: uma conexão do pool rodando como superusuário
  // para todo request seguinte, não só para o que chamou RESET ROLE.
  await comPoolDescartavel(async (pool) => {
    const a = await pool.connect()
    await a.query('RESET ROLE')
    a.release()

    const b = await pool.connect()
    try {
      const { rows } = await b.query('SELECT current_user')
      assert.equal(
        rows[0].current_user,
        'app_login',
        'documentado: onConnect NÃO roda de novo no checkout seguinte',
      )
    } finally {
      b.release()
    }
  })
})

test('CONSERTO · SET LOCAL ROLE no UnitOfWork cura a conexão envenenada e reverte sozinho', async () => {
  // A Stack já exige "uma transação por caso de uso, aberta só no UnitOfWork".
  // Basta o UnitOfWork abrir com SET LOCAL ROLE: vale por transação, cura
  // conexão suja, e reverte no COMMIT sem ninguém precisar lembrar de limpar.
  await comPoolDescartavel(async (pool) => {
    const c = await pool.connect()
    try {
      await c.query('RESET ROLE')
      assert.equal((await c.query('SELECT current_user')).rows[0].current_user, 'app_login')

      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE app')
      assert.equal(
        (await c.query('SELECT current_user')).rows[0].current_user,
        'app',
        'SET LOCAL ROLE restaura mesmo numa conexão já envenenada',
      )
      await c.query("SELECT set_config('rebar.tenant_id', 'acme', true)")
      await c.query('SELECT count(*) FROM pedido') // não lança: o privilégio voltou
      await c.query('COMMIT')

      assert.equal(
        (await c.query('SELECT current_user')).rows[0].current_user,
        'app_login',
        'e reverte sozinho ao fim da transação — LOCAL é o ponto',
      )
    } finally {
      c.release()
    }
  })
})
