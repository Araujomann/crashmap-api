import { Transform, type Readable } from "node:stream";
import csvParser from "csv-parser";
import type { PrfCsvRow } from "./prf-sync.types.js";


export const PRF_REQUIRED_COLUMNS = [
    "id",
    "data_inversa",
    "horario",
    "uf",
    "br",
    "km",
    "municipio",
    "causa_acidente",
    "tipo_acidente",
    "mortos",
    "feridos_leves",
    "feridos_graves",
    "veiculos",
    "latitude",
    "longitude",
] as const;

export class PrfFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PrfFormatError";
    }
}






function windows1252ToUtf8(): Transform {
    const decoder = new TextDecoder("windows-1252");
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            callback(null, Buffer.from(decoder.decode(chunk, { stream: true })));
        },
    });
}

export function validatePrfHeaders(headers: string[]): void {
    const present = new Set(headers);
    const missing = PRF_REQUIRED_COLUMNS.filter((column) => !present.has(column));
    if (
        !present.has("condicao_metereologica") &&
        !present.has("condicao_meteorologica")
    ) {
        missing.push("condicao_metereologica" as never);
    }
    if (missing.length > 0) {
        throw new PrfFormatError(
            `Cabecalho do CSV da PRF invalido; colunas ausentes: ${missing.join(", ")}.`,
        );
    }
}





export async function* readPrfCsv(input: Readable): AsyncGenerator<PrfCsvRow> {
    let headersChecked = false;
    const parser = input.pipe(windows1252ToUtf8()).pipe(
        csvParser({
            separator: ";",
            mapHeaders: ({ header }) =>
                header.replace(/^﻿/, "").trim().toLowerCase(),
        }),
    );

    let headerError: Error | undefined;
    parser.on("headers", (headers: string[]) => {
        try {
            validatePrfHeaders(headers);
        } catch (error) {
            headerError = error as Error;
        }
        headersChecked = true;
    });
    input.on("error", (error) => parser.destroy(error));

    for await (const row of parser) {
        if (headerError) {
            parser.destroy();
            throw headerError;
        }
        yield row as PrfCsvRow;
    }

    if (headerError) throw headerError;
    if (!headersChecked) {
        throw new PrfFormatError("O CSV da PRF esta vazio.");
    }
}
