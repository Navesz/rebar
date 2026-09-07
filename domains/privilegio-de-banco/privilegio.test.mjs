// Domain: database privilege. Fitness test.
//
// A catalog assertion proves the CONFIGURATION was applied.
// Hostile execution proves the ESCAPE does not work. They are different
// questions, and only the second one is about security.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const HOST = '127.0.0.1'
const PORT = 55432
const DB = 'rebar_teste'

/** Runtime pool: authenticates as app_login and becomes app at the barrier. */
function poolDeRuntime(extra = {}) {
  return new pg.Pool({
    host: HOST,
    port: PORT,
    database: DB,
    user: 'app_login',
    password: 'app_dev_only',
    max: 4,
    connectionTimeoutMillis: 5_000,
    // The acquisition barrier. Not `pool.on('connect')`: that one hands over
    // the client before validating, and pg 9.0 will remove the queue that
    // saves it today.
    onConnect: async (client) => {
      await client.query('SET ROLE app')
      await client.query("SET TIME ZONE 'UTC'")
    },
    ...extra,
  })
}

/**
 * Disposable pool for a test that dirties the connection's role state.
 *
 * Needed because of the finding documented below: `onConnect` is a barrier per
 * PHYSICAL connection, not per checkout. A `RESET ROLE` survives the release
 * and contaminates whoever takes the connection afterwards — another test
 * included.
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

// ─────────────────────────────────────────────────────── positive

test('the runtime connection has session_user app_login and current_user app', async () => {
  const { rows } = await runtime.query(
    'SELECT session_user, current_user, current_setting($1) AS tz',
    ['TimeZone'],
  )
  assert.equal(rows[0].session_user, 'app_login')
  assert.equal(rows[0].current_user, 'app')
  assert.equal(rows[0].tz, 'UTC')
})

test('app does DML on the table granted to it', async () => {
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

test('the trigger increments version without the UPDATE mentioning it', async () => {
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    const ins = await c.query(
      'INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2) RETURNING id, version',
      ['acme', 'v'],
    )
    const { id, version } = ins.rows[0]
    // Notice: the UPDATE does NOT talk about version. It is exactly what an agent would write.
    const upd = await c.query('UPDATE pedido SET descricao = $1 WHERE id = $2 RETURNING version', [
      'w',
      id,
    ])
    assert.equal(
      Number(upd.rows[0].version),
      Number(version) + 1,
      'version has to rise on its own — otherwise the optimistic barrier depends on memory',
    )
  } finally {
    c.release()
  }
})

// ────────────────────────────────────────────────────── hostile

test('HOSTILE · RESET ROLE does not elevate privilege: it falls to app_login, which reads nothing', async () => {
  await comPoolDescartavel(async (pool) => {
    const c = await pool.connect()
    try {
      await c.query('RESET ROLE')
      const { rows } = await c.query('SELECT current_user')
      assert.equal(
        rows[0].current_user,
        'app_login',
        'RESET has to fall to app_login, never to app',
      )
      await assert.rejects(
        () => c.query('SELECT * FROM pedido'),
        (e) => e.code === '42501', // insufficient_privilege
        'app_login cannot read the protected table',
      )
    } finally {
      c.release()
    }
  })
})

test('HOSTILE · SET ROLE db_owner is refused', async () => {
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

test('HOSTILE · there is no connection-time setting of role', async () => {
  // The premise that decides the RESET ROLE case, and that was hidden behind an
  // ellipsis in the quotation. Three vectors: ALTER ROLE, ALTER DATABASE, and
  // `options=-c role=...` in the connection string — this last one does not go
  // through SQL.
  await comPoolDescartavel(async (pool) => {
    const c = await pool.connect()
    try {
      await c.query('RESET ROLE')
      const { rows } = await c.query("SELECT coalesce(current_setting('role', true), '') AS r")
      assert.ok(
        rows[0].r === '' || rows[0].r === 'none',
        `a connection-time role exists (${rows[0].r}) — the RESET would fall into it`,
      )
    } finally {
      c.release()
    }
  })
})

test('HOSTILE · app does not do DDL', async () => {
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

test('HOSTILE · the SECURITY DEFINER is not executable by PUBLIC', async () => {
  const c = await runtime.connect()
  try {
    await assert.rejects(
      () => c.query('SELECT vazamento()'),
      (e) => e.code === '42501',
      'an accessible SECURITY DEFINER function owned by db_owner is privilege escalation',
    )
  } finally {
    c.release()
  }
})

// ────────────────────────────────────────────── catalog: effective privilege

test('CATALOG · effective capability, not attribute', async () => {
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
    assert.equal(r.pode_virar_owner, false, 'app_login cannot become db_owner')
    assert.equal(r.herda_app, false, 'INHERIT FALSE: does not inherit app without SET ROLE')
    assert.equal(r.pode_virar_app, true, 'it has to be able to become app')
    assert.equal(r.le_pedido, false, 'app_login does not read the table directly')
    assert.equal(r.executa_isca, false, 'PUBLIC cannot execute the SECURITY DEFINER')
  } finally {
    c.release()
  }
})

test('CATALOG · attributes of the three roles', async () => {
  const c = await runtime.connect()
  try {
    const { rows } = await c.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin
        FROM pg_roles WHERE rolname IN ('db_owner','app','app_login') ORDER BY rolname`)
    const por = Object.fromEntries(rows.map((r) => [r.rolname, r]))
    for (const nome of ['db_owner', 'app', 'app_login']) {
      assert.ok(por[nome], `role ${nome} exists`)
      assert.equal(por[nome].rolsuper, false, `${nome} is not a superuser`)
      assert.equal(por[nome].rolbypassrls, false, `${nome} does not bypass RLS`)
      assert.equal(por[nome].rolcreatedb, false)
      assert.equal(por[nome].rolcreaterole, false)
    }
    assert.equal(por.app.rolcanlogin, false, 'app is NOLOGIN: nobody authenticates as it')
    assert.equal(
      por.app_login.rolinherit,
      false,
      'app_login is NOINHERIT — the piece that makes it work',
    )
  } finally {
    c.release()
  }
})

test('CATALOG · the set of memberships is exactly the expected one', async () => {
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
    assert.deepEqual(real, ['app_login->app'], `unexpected membership: ${JSON.stringify(real)}`)
  } finally {
    c.release()
  }
})

// ───────────────────────────────────── the acquisition barrier, driver layer

test('BARRIER · an onConnect that fails destroys the connection and rejects the acquire', async () => {
  const ruim = new pg.Pool({
    host: HOST,
    port: PORT,
    database: DB,
    user: 'app_login',
    password: 'app_dev_only',
    max: 2,
    connectionTimeoutMillis: 5_000,
    onConnect: async (client) => {
      // The role name stays in Portuguese: PostgreSQL echoes it back inside the
      // error text, and the regex in the assertion below matches on it.
      await client.query('SET ROLE inexistente')
    },
  })
  try {
    await assert.rejects(
      () => ruim.connect(),
      /inexistente|does not exist|42704/i,
      'the acquire has to reject — the client can never be handed over with the wrong privilege',
    )
    assert.equal(ruim.totalCount, 0, 'the connection has to be destroyed, not returned to the pool')
  } finally {
    await ruim.end()
  }
})

// ──────────────────────────────────── RLS: what works and what does not yet

test('RLS · a tenant does not see another tenant row', async () => {
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    await c.query('INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2)', ['acme', 'da acme'])
    await c.query("SELECT set_config('rebar.tenant_id', 'outra', false)")
    const { rows } = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.equal(rows[0].n, 0, 'with another tenant in context, no acme row shows up')
  } finally {
    c.release()
  }
})

test('RLS · KNOWN FINDING: the tenant GUC is USERSET — app swaps its own context', async () => {
  // This is NOT a regression: it is the boundary the review pointed at and that
  // still has no solution in the document. The test exists so that it stops
  // being invisible — when the tenant channel is closed, this test inverts.
  const c = await runtime.connect()
  try {
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    await c.query('INSERT INTO pedido (tenant_id, descricao) VALUES ($1,$2)', ['acme', 'segredo'])
    await c.query("SELECT set_config('rebar.tenant_id', 'invasor', false)")
    const antes = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.equal(antes.rows[0].n, 0)
    // The session itself restores the other tenant's context. Nothing stops it.
    await c.query("SELECT set_config('rebar.tenant_id', 'acme', false)")
    const depois = await c.query('SELECT count(*)::int AS n FROM pedido')
    assert.ok(
      depois.rows[0].n > 0,
      'documented: a custom GUC is USERSET, so tenant isolation is NOT closed',
    )
  } finally {
    c.release()
  }
})

// ────────────────────── NEW FINDING: the barrier is per connection, not per use

test('FINDING · onConnect is a barrier per PHYSICAL connection — RESET ROLE survives the release', async () => {
  // Found by running the code, not by reading the document. Neither the human
  // review nor the six agents caught it: it only shows up when the connection
  // goes back to the pool.
  //
  // Here it FAILS CLOSED — the next request loses privilege and takes a 42501.
  // In a design where the session_user were privileged (prumo's current state),
  // it would fail OPEN: one pool connection running as superuser for every
  // request that follows, not just for the one that called RESET ROLE.
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
        'documented: onConnect does NOT run again on the next checkout',
      )
    } finally {
      b.release()
    }
  })
})

test('FIX · SET LOCAL ROLE in the UnitOfWork cures the poisoned connection and reverts on its own', async () => {
  // The Stack already demands "uma transação por caso de uso, aberta só no
  // UnitOfWork" [one transaction per use case, opened only in the UnitOfWork].
  // It is enough for the UnitOfWork to open with SET LOCAL ROLE: it holds per
  // transaction, it cures a dirty connection, and it reverts at COMMIT without
  // anyone having to remember to clean up.
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
        'SET LOCAL ROLE restores even on an already poisoned connection',
      )
      await c.query("SELECT set_config('rebar.tenant_id', 'acme', true)")
      await c.query('SELECT count(*) FROM pedido') // does not throw: the privilege is back
      await c.query('COMMIT')

      assert.equal(
        (await c.query('SELECT current_user')).rows[0].current_user,
        'app_login',
        'and it reverts on its own at the end of the transaction — LOCAL is the point',
      )
    } finally {
      c.release()
    }
  })
})
