# Domínio · Privilégio de banco

**Estado: PROVADO** · 16/16 asserções verdes contra PostgreSQL 17.2 real · 26/08/2026

O primeiro domínio fechado do rebar. Não "o documento parece correto" — o critério é o
que foi combinado na revisão: `Claim` + `Assumptions` + migration + teste positivo +
teste hostil + modo de falha observado + nenhum bypass conhecido.

---

## Claim

> Abandonar a role operacional **nunca eleva privilégio**.

| | |
|---|---|
| **Owner** | PostgreSQL — `sql-set-role`, `ddl-priv`, `sql-createextension` |
| **Evidence** | `migrations/0001_papeis.sql`, `migrations/0002_tabela_protegida.sql`, e as 16 asserções de `privilegio.test.mjs` rodando contra PostgreSQL 17.2 |

### Assumptions — cada uma vira asserção

| Premissa | Prova executável |
|---|---|
| `session_user = app_login` | `SELECT session_user` |
| `app_login` não pode virar `db_owner` | `pg_has_role('app_login','db_owner','SET') = false` |
| `app_login` não herda `app` | `pg_has_role('app_login','app','USAGE') = false` |
| `app_login` pode virar `app` | `pg_has_role('app_login','app','SET') = true` |
| **Não existe `role` de connection-time** | `current_setting('role', true)` vazio após `RESET ROLE` |
| `PUBLIC` não oferece caminho privilegiado | `has_function_privilege(…,'EXECUTE') = false` na isca `SECURITY DEFINER` |
| Nenhuma das três roles é superusuário nem contorna RLS | `pg_roles` |
| O conjunto de memberships é exatamente `{app_login → app}` | `pg_auth_members` |

A premissa do connection-time é a que decide o caso e vinha **escondida atrás de uma
elipse** na citação do documento. São três vetores, e o terceiro não passa por SQL:
`ALTER ROLE`, `ALTER DATABASE`, e `options=-c role=app` na string de conexão ou `PGOPTIONS`.

---

## O que rodar

```bash
npm test
```

Precisa de um PostgreSQL em `127.0.0.1:55432` com o banco `rebar_teste` e as duas
migrations aplicadas — a 0001 como superusuário, a **0002 como `db_owner`**. Que a 0002
rode como `db_owner` faz parte do que o teste prova.

---

## Achado que só o código encontrou

Nem a revisão humana nem os seis agentes pegaram, porque só aparece quando a conexão
volta ao pool:

> **`onConnect` é barreira por conexão FÍSICA, não por checkout.**

```
checkout            current_user = app          ✓
RESET ROLE          current_user = app_login
release  →  pool
PRÓXIMO checkout    current_user = app_login    ← onConnect não rodou de novo
```

Neste desenho **falha fechado**: o request seguinte perde privilégio e toma `42501`. Mas
num desenho em que o `session_user` fosse privilegiado — **o estado atual do prumo**, onde
`POSTGRES_USER=prumo` é o superusuário do cluster — falharia **aberto**: uma conexão do
pool rodando como superusuário para *todo request seguinte*, não só para o que chamou
`RESET ROLE`.

Isso agrava o achado original. Não é "`RESET ROLE` dá superusuário neste request", é
"**neste request e em todos os próximos daquela conexão**".

### O conserto, e por que ele encaixa

```sql
BEGIN;
SET LOCAL ROLE app;   -- primeira instrução de toda transação, no UnitOfWork
…
COMMIT;               -- reverte sozinho, ninguém precisa lembrar de limpar
```

Medido: `SET LOCAL ROLE` **cura uma conexão já envenenada** e reverte no COMMIT. A Stack
já exige *"uma transação por caso de uso, aberta só no `UnitOfWork`"* — então o conserto
não adiciona disciplina nova, só move a existente para onde ela já estava.

`onConnect` continua, como barreira de aquisição e defesa em profundidade.

---

## Fronteira ainda aberta

**O canal de tenant não está fechado.** Custom GUC é `USERSET`: a própria sessão troca o
próprio contexto de tenant. Há um teste que **documenta a falha** em vez de escondê-la —
quando o canal for fechado, aquele teste inverte.

Por isso o domínio fecha em **isolamento de role**, não em isolamento de tenant. São dois
domínios, e misturá-los num commit só foi o que a revisão desaconselhou.

---

## Placar

| Categoria | Asserções |
|---|---|
| Positivo | 3 |
| Hostil | 5 |
| Catálogo (privilégio efetivo) | 3 |
| Barreira de aquisição (camada driver) | 1 |
| RLS | 2 — uma passa, uma documenta a fronteira aberta |
| Achado + conserto | 2 |
| **Total** | **16 verdes** |
