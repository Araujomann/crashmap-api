-- CreateEnum
CREATE TYPE "accident_classificacao" AS ENUM ('com_vitima', 'sem_vitima');

-- CreateEnum
CREATE TYPE "accident_condicao_meteorologica" AS ENUM ('ceu_claro', 'chuva', 'nublado', 'garoa');

-- AlterTable
ALTER TABLE "Accident" ADD COLUMN     "classificacao_acidente" "accident_classificacao" NOT NULL DEFAULT 'sem_vitima',
ADD COLUMN     "condicao_meteorologica" "accident_condicao_meteorologica" NOT NULL DEFAULT 'ceu_claro';
