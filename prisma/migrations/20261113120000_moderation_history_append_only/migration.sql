-- Contas removidas que têm trilha de moderação são anonimizadas, não apagadas.
ALTER TABLE "User" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- O histórico de moderação é somente-inserção: decisões registradas não podem
-- ser alteradas nem apagadas pela aplicação.
--
-- Válvula de escape só para limpeza de testes/manutenção: dentro de uma
-- transação, `SELECT set_config('crashmap.allow_history_purge', 'on', true)`
-- libera DELETE (nunca UPDATE) até o fim daquela transação.
CREATE FUNCTION "forbid_moderation_history_mutation"() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('crashmap.allow_history_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'AccidentModerationHistory é somente-inserção (% bloqueado)', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accident_moderation_history_append_only"
BEFORE UPDATE OR DELETE ON "AccidentModerationHistory"
FOR EACH ROW EXECUTE FUNCTION "forbid_moderation_history_mutation"();
