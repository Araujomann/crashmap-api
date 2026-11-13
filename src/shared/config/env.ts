import "dotenv/config.js";

function readRequiredEnv(name: string) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

function readCloudinaryConfig() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || "";
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || "";
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || "";
    const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim() || "";

    if (cloudinaryUrl) {
        return {
            CLOUDINARY_CLOUD_NAME: cloudName || "",
            CLOUDINARY_API_KEY: apiKey || "",
            CLOUDINARY_API_SECRET: apiSecret || "",
            CLOUDINARY_URL: cloudinaryUrl,
        };
    }

    if (!cloudName || !apiKey || !apiSecret) {
        return {
            CLOUDINARY_CLOUD_NAME: cloudName,
            CLOUDINARY_API_KEY: apiKey,
            CLOUDINARY_API_SECRET: apiSecret,
            CLOUDINARY_URL: "",
        };
    }

    return {
        CLOUDINARY_CLOUD_NAME: cloudName,
        CLOUDINARY_API_KEY: apiKey,
        CLOUDINARY_API_SECRET: apiSecret,
        CLOUDINARY_URL: "",
    };
}

function readPort(value: string | undefined) {
    if (!value) {
        return 3333;
    }

    const port = Number(value);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("PORT must be a valid TCP port number");
    }

    return port;
}

const cloudinaryConfig = readCloudinaryConfig();
const nodeEnv = process.env.NODE_ENV ?? "development";
const frontendUrl = process.env.FRONTEND_URL?.trim() || "http://localhost:19006";

function readList(value: string | undefined) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim().replace(/\/+$/, ""))
        .filter(Boolean);
}

/**
 * Origens de navegador autorizadas (CORS). O painel não entra aqui: ele fala
 * com a API pelo servidor (BFF), não pelo navegador. O app nativo também não
 * passa por CORS. Sobra o app rodando na web (Expo web), por isso o padrão
 * fora de produção é o FRONTEND_URL; em produção, só o que for listado.
 */
function readCorsOrigins() {
    const configured = readList(process.env.CORS_ORIGINS);
    if (configured.length > 0) return configured;
    return nodeEnv === "production" ? [] : [frontendUrl.replace(/\/+$/, "")];
}

/**
 * De quem a API aceita o cabeçalho X-Forwarded-For (o IP real do cliente).
 * - vazio: em desenvolvimento confia só em loopback (o painel local); em
 *   produção não confia em ninguém;
 * - "true": confia em qualquer proxy (só atrás de um balanceador que
 *   sobrescreve o cabeçalho);
 * - número: quantidade de proxies à frente;
 * - lista de IPs/CIDRs separados por vírgula.
 */
function readTrustProxy(): boolean | number | string[] {
    const value = process.env.TRUST_PROXY?.trim();
    if (!value) {
        return nodeEnv === "production" ? false : ["127.0.0.1", "::1"];
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return Number(value);
    return readList(value);
}

export const env = {
    NODE_ENV: nodeEnv,
    CORS_ORIGINS: readCorsOrigins(),
    TRUST_PROXY: readTrustProxy(),
    // Válvula para depuração local; em produção, sempre ligado.
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== "false",
    PORT: readPort(process.env.PORT),
    DATABASE_URL: readRequiredEnv("DATABASE_URL"),
    ACCESS_TOKEN_SECRET: readRequiredEnv("ACCESS_TOKEN_SECRET"),
    REFRESH_TOKEN_SECRET: readRequiredEnv("REFRESH_TOKEN_SECRET"),
    ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN ?? "15m",
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d",
    FRONTEND_URL: frontendUrl,
    // Painel administrativo: base dos links de convite de moderador.
    ADMIN_PANEL_URL: (
        process.env.ADMIN_PANEL_URL?.trim() || "http://localhost:3000"
    ).replace(/\/+$/, ""),
    SMTP_USER: process.env.SMTP_USER?.trim() ?? "",
    SMTP_PASS: process.env.SMTP_PASS?.replace(/\s/g, "") ?? "",
    SMTP_FROM:
        process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
    CLOUDINARY_CLOUD_NAME: cloudinaryConfig.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: cloudinaryConfig.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: cloudinaryConfig.CLOUDINARY_API_SECRET,
    CLOUDINARY_URL: cloudinaryConfig.CLOUDINARY_URL,
} as const;
