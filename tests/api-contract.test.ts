import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";

/**
 * Teste de caracterização do contrato público da API.
 *
 * Compara com um snapshot versionado:
 * - o documento OpenAPI (rotas, métodos, parâmetros e schemas de entrada e
 *   saída de cada rota);
 * - a árvore de rotas com os hooks de cada uma (guards de autenticação,
 *   limites de requisição, CORS), na ordem em que executam.
 *
 * Uma diferença aqui significa que o contrato mudou. Só regrave o snapshot
 * (`UPDATE_API_CONTRACT=1 pnpm test`) quando a mudança for intencional.
 */
const snapshotPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "__snapshots__",
    "api-contract.json",
);

async function captureContract() {
    const app = await buildApp({ rateLimit: true });
    await app.ready();

    try {
        return {
            openapi: JSON.parse(JSON.stringify(app.swagger())) as unknown,
            routes: app
                .printRoutes({ commonPrefix: false, includeHooks: true })
                .split("\n"),
        };
    } finally {
        await app.close();
    }
}

test("public API contract matches the recorded snapshot", async () => {
    const current = await captureContract();

    if (process.env.UPDATE_API_CONTRACT === "1") {
        mkdirSync(dirname(snapshotPath), { recursive: true });
        writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
        return;
    }

    assert.ok(
        existsSync(snapshotPath),
        "Snapshot ausente: rode com UPDATE_API_CONTRACT=1 para gravá-lo.",
    );

    const recorded = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
        openapi: unknown;
        routes: string[];
    };

    assert.deepEqual(current.openapi, recorded.openapi);
    assert.deepEqual(current.routes, recorded.routes);
});
