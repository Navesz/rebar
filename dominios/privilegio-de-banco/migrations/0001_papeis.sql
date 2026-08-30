-- Domínio: privilégio de banco. Migration 0001.
--
-- Três identidades, não duas. A propriedade que isto existe para garantir:
--
--   abandonar a role operacional NUNCA eleva privilégio.
--
-- O defeito que motivou: em prumo, `POSTGRES_USER=prumo` faz do usuário de
-- runtime o superusuário do cluster. `SET ROLE prumo_app` restringe o
-- current_user, mas RESET ROLE devolve o session_user — e RESET ROLE não é
-- privilegiado: "These forms can be executed by any user" (sql-set-role).
--
-- Rodada como o superusuário de bootstrap. É a ÚNICA vez que ele aparece.

-- ---------------------------------------------------------------- db_owner
-- Dono do schema. Roda migrations. NUNCA usado pelo runtime.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'db_owner') THEN
    CREATE ROLE db_owner LOGIN PASSWORD 'owner_dev_only'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- --------------------------------------------------------------------- app
-- A role operacional. Só DML. Sem LOGIN: ninguém autentica como ela.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- --------------------------------------------------------------- app_login
-- Só serve para autenticar. NOINHERIT é a peça que faz a coisa funcionar:
-- sem ela, app_login teria o DML de `app` automaticamente e o RESET ROLE o
-- deixaria com ele.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_login') THEN
    CREATE ROLE app_login LOGIN PASSWORD 'app_dev_only'
      NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE app_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- INHERIT FALSE: não recebe `app` automaticamente.
-- SET TRUE:      pode virar `app` explicitamente, via SET ROLE.
-- ADMIN FALSE:   não pode redistribuir a membership.
-- Requer PostgreSQL 16+.
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

-- DELIBERADAMENTE AUSENTE: `ALTER ROLE app_login SET role = app`.
-- Pareceria reforço e é o contrário — o RESET ROLE passaria a cair em `app`,
-- que tem o DML, e o teste hostil deixaria de fazer sentido.

-- ------------------------------------------------------------------ PUBLIC
-- app_login nunca teve "zero privilégio": PUBLIC recebe CONNECT e TEMPORARY
-- em databases, EXECUTE em funções, USAGE em linguagens e tipos (ddl-priv).
-- O caminho de escalada é SECURITY DEFINER com EXECUTE para PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE rebar_teste FROM PUBLIC;

-- ------------------------------------------------------------------ schema
GRANT CREATE, USAGE ON SCHEMA public TO db_owner;
GRANT USAGE ON SCHEMA public TO app;
-- app_login NÃO recebe USAGE: ele não existe para consultar nada.
