-- Domínio: privilégio de banco. Migration 0002.
--
-- Uma tabela real para o teste hostil ter o que atacar. Rodada como db_owner,
-- nunca como o superusuário — é essa a diferença que o teste precisa provar.

CREATE TABLE IF NOT EXISTS pedido (
  id        bigserial PRIMARY KEY,
  tenant_id text      NOT NULL,
  descricao text      NOT NULL,
  version   bigint    NOT NULL DEFAULT 1
);

-- FORCE: sem isto o dono da tabela ignora a própria política.
ALTER TABLE pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido FORCE ROW LEVEL SECURITY;

CREATE POLICY pedido_por_tenant ON pedido
  USING (tenant_id = current_setting('rebar.tenant_id', true));

-- `app` recebe DML. `app_login` não recebe nada — é o ponto do desenho.
GRANT SELECT, INSERT, UPDATE, DELETE ON pedido TO app;
GRANT USAGE, SELECT ON SEQUENCE pedido_id_seq TO app;

-- O incremento de version não pode depender de o agente lembrar.
-- `SET version = version + 1` protege *aquele* UPDATE; um agente escreve
-- `UPDATE pedido SET descricao = $1 WHERE id = $2` e a barreira otimista morre
-- sem erro. O trigger tira isso da memória e põe na tabela.
CREATE OR REPLACE FUNCTION incrementa_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp   -- schema gravável fora, pg_temp por último
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pedido_version ON pedido;
CREATE TRIGGER pedido_version BEFORE UPDATE ON pedido
  FOR EACH ROW EXECUTE FUNCTION incrementa_version();

-- Isca para o teste hostil: uma SECURITY DEFINER de propriedade do db_owner.
-- Se PUBLIC mantiver EXECUTE, app_login a chama e roda com privilégio do dono.
CREATE OR REPLACE FUNCTION vazamento() RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT count(*) FROM public.pedido $$;

-- O ALTER DEFAULT PRIVILEGES da 0001 só vale para objetos futuros criados por
-- db_owner. Esta função é criada agora, por db_owner — então é coberta. O
-- revoke explícito existe para o caso de alguém rodar isto fora de ordem.
REVOKE EXECUTE ON FUNCTION vazamento() FROM PUBLIC;
