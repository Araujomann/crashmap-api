-- Histórico da sincronização com os dados abertos da PRF.
-- Migração apenas aditiva: nenhuma tabela ou coluna existente é alterada.
CREATE TYPE "prf_import_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "prf_import_file_status" AS ENUM ('IMPORTED', 'UNCHANGED', 'NOT_PUBLISHED', 'FAILED');

CREATE TABLE "prf_import_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "status" "prf_import_run_status" NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "prf_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prf_import_runs_started_at_idx" ON "prf_import_runs"("started_at");

-- Trava contra execuções simultâneas: no máximo uma execução em andamento.
CREATE UNIQUE INDEX "prf_import_runs_single_running"
    ON "prf_import_runs"("status")
    WHERE "status" = 'RUNNING';

CREATE TABLE "prf_import_files" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "source_year" INTEGER NOT NULL,
    "source_url" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "file_sha256" TEXT,
    "remote_last_modified" TIMESTAMP(3),
    "status" "prf_import_file_status" NOT NULL,
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "rows_matched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "missing_from_source" INTEGER NOT NULL DEFAULT 0,
    "staff_edits_overwritten" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "prf_import_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prf_import_files_run_id_idx" ON "prf_import_files"("run_id");
CREATE INDEX "prf_import_files_source_year_status_idx" ON "prf_import_files"("source_year", "status");

ALTER TABLE "prf_import_files"
    ADD CONSTRAINT "prf_import_files_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "prf_import_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
