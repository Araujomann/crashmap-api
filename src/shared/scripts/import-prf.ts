import fs from "fs";
import { resolve } from "path";
import csvParser from "csv-parser";
import { prisma } from "../database/prisma.js";

// Tipagem baseada nos cabeçalhos reais do CSV da PRF
interface PrfCsvRow {
    id: string;
    data_inversa: string;
    dia_semana: string;
    horario: string;
    uf: string;
    br: string;
    km: string;
    municipio: string;
    causa_acidente: string;
    tipo_acidente: string;
    classificacao_acidente: string;
    fase_dia: string;
    sentido_via: string;
    condicao_metereologica: string; // no arquivo PRF às vezes vem escrito com 'e' ou sem
    tipo_pista: string;
    tracado_via: string;
    uso_solo: string;
    pessoas: string;
    mortos: string;
    feridos_leves: string;
    feridos_graves: string;
    ilesos: string;
    ignorados: string;
    feridos: string;
    veiculos: string;
    latitude: string;
    longitude: string;
    regional: string;
    delegacia: string;
    uop: string;
}

const BATCH_SIZE = 1000;

function parseDateAndHour(dataInversa: string, horario: string): Date {
    try {
        let datePart = dataInversa;
        // Se vier no padrão DD/MM/YYYY, inverte para YYYY-MM-DD
        if (datePart.includes("/")) {
            const [day, month, year] = datePart.split("/");
            datePart = `${year}-${month}-${day}`;
        }
        const timePart = horario || "00:00:00";
        const combined = new Date(`${datePart}T${timePart}`);
        if (!isNaN(combined.getTime())) {
            return combined;
        }
    } catch (e) {
        // ignora e cai pro fallback
    }
    return new Date(); // Fallback se não conseguir parsear
}

function mapSeverity(mortos: number, graves: number, leves: number): "low" | "medium" | "high" | "critical" {
    if (mortos > 0) return "critical";
    if (graves > 0) return "high";
    if (leves > 0) return "medium";
    return "low";
}

function mapCondicaoTempo(val: string | undefined): "ceu_claro" | "chuva" | "nublado" | "garoa" {
    if (!val) return "ceu_claro";
    const v = val.toLowerCase();
    if (v.includes("chuva")) return "chuva";
    if (v.includes("nublado")) return "nublado";
    if (v.includes("garoa") || v.includes("chuvisco")) return "garoa";
    return "ceu_claro"; // Default para Sol, Céu Claro, Ignorado, Vento, etc.
}

function mapClassificacao(mortos: number, graves: number, leves: number): "com_vitima" | "sem_vitima" {
    if (mortos > 0 || graves > 0 || leves > 0) return "com_vitima";
    return "sem_vitima";
}

// Função isolada para processar um único arquivo CSV
function processCsv(csvPath: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        console.log(`\n📄 Lendo arquivo: ${csvPath}`);
        
        let processedRows = 0;
        let filteredRows = 0; // Contagem de quantas eram de Imperatriz
        let insertedRows = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch: any[] = [];

        fs.createReadStream(csvPath)
            .pipe(
                csvParser({
                    separator: ';', 
                    mapHeaders: ({ header }) => header.trim().toLowerCase()
                })
            )
            .on("data", async (row: PrfCsvRow) => {
                processedRows++;

                try {
                    // Filtro de Localidade: APENAS Imperatriz - MA
                    const uf = row.uf?.trim().toUpperCase();
                    const municipio = row.municipio?.trim().toUpperCase();

                    // Remove acentuação e checa
                    if (uf !== "MA" || !municipio?.includes("IMPERATRIZ")) {
                        return; // Ignora o resto do Brasil
                    }

                    filteredRows++; // Entrou na regra de Imperatriz

                    const latStr = row.latitude?.replace(",", ".") || "";
                    const lngStr = row.longitude?.replace(",", ".") || "";
                    
                    const latitude = parseFloat(latStr);
                    const longitude = parseFloat(lngStr);
                    
                    if (isNaN(latitude) || isNaN(longitude)) {
                        return; 
                    }

                    const mortos = parseInt(row.mortos) || 0;
                    const graves = parseInt(row.feridos_graves) || 0;
                    const leves = parseInt(row.feridos_leves) || 0;
                    const veiculos = parseInt(row.veiculos) || 0;

                    const occurred_at = parseDateAndHour(row.data_inversa, row.horario);
                    const severity = mapSeverity(mortos, graves, leves);
                    
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const condicaoStr = row.condicao_metereologica || (row as any).condicao_meteorologica || "";
                    const condicao_meteorologica = mapCondicaoTempo(condicaoStr);
                    const classificacao_acidente = mapClassificacao(mortos, graves, leves);
                    
                    const descCausa = row.causa_acidente || "Não informada";
                    const descLocal = `BR-${row.br} Km ${row.km} (${row.municipio} - ${row.uf})`;
                    const description = `Causa: ${descCausa} | ${mortos} morto(s) e ${veiculos} veículo(s) envolvido(s) | ${descLocal}`;

                    batch.push({
                        tipo_acidente: row.tipo_acidente || "Acidente não especificado",
                        classificacao_acidente,
                        condicao_meteorologica,
                        description,
                        latitude,
                        longitude,
                        occurred_at,
                        severity,
                        source: "PRF"
                    });

                    if (batch.length >= BATCH_SIZE) {
                        const batchToInsert = [...batch];
                        batch.length = 0; 
                        
                        await prisma.accident.createMany({
                            data: batchToInsert,
                            skipDuplicates: true
                        });

                        insertedRows += batchToInsert.length;
                        console.log(` ✅ Lote importado: ${insertedRows} registros de Imperatriz salvos...`);
                    }
                } catch (err) {
                    console.error(` ⚠️ Erro processando a linha ${processedRows}:`, err);
                }
            })
            .on("end", async () => {
                if (batch.length > 0) {
                    await prisma.accident.createMany({
                        data: batch,
                        skipDuplicates: true
                    });
                    insertedRows += batch.length;
                }
                
                console.log(`\n🎉 Fim do arquivo!`);
                console.log(` 📊 Total lido (Brasil): ${processedRows}`);
                console.log(` 🔎 Total encontrado (Imperatriz-MA): ${filteredRows}`);
                console.log(` 💾 Salvos no Banco: ${insertedRows}`);
                resolvePromise();
            })
            .on("error", (error) => {
                console.error("❌ Ocorreu um erro ao ler o CSV:", error);
                rejectPromise(error);
            });
    });
}

async function importPrfAccidents() {
    // Pega todos os caminhos informados no comando de terminal
    const inputFiles = process.argv.slice(2);
    
    if (inputFiles.length === 0) {
        console.error("❌ Erro: Você deve informar o(s) caminho(s) do(s) arquivo(s) CSV.");
        console.error("Exemplo: pnpm exec tsx src/shared/scripts/import-prf.ts ./2022.csv ./2023.csv ./2024.csv");
        process.exit(1);
    }

    console.log(`\n🚀 Iniciando Importador PRF - Foco: Imperatriz-MA`);
    console.log(`Quantidade de arquivos na fila: ${inputFiles.length}`);

    for (const file of inputFiles) {
        const csvPath = resolve(process.cwd(), file);

        if (!fs.existsSync(csvPath)) {
            console.error(`\n❌ Arquivo ignorado (não encontrado): ${csvPath}`);
            continue;
        }

        await processCsv(csvPath);
    }

    console.log(`\n✨ IMPORTAÇÃO EM LOTE TOTALMENTE CONCLUÍDA! ✨\n`);
}

importPrfAccidents()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });