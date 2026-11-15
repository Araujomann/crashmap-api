-- Registro do aceite dos Termos de Uso e da Política de Privacidade (LGPD).
-- Contas criadas antes desta migração ficam sem aceite e o aplicativo pede o
-- aceite no próximo acesso.
ALTER TABLE "User" ADD COLUMN "terms_version" TEXT;
ALTER TABLE "User" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);
