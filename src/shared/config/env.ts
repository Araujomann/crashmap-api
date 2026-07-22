import "dotenv/config.js";

function readRequiredEnv(name: string) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
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

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: readPort(process.env.PORT),
    DATABASE_URL: readRequiredEnv("DATABASE_URL"),
    ACCESS_TOKEN_SECRET: readRequiredEnv("ACCESS_TOKEN_SECRET"),
    REFRESH_TOKEN_SECRET: readRequiredEnv("REFRESH_TOKEN_SECRET"),
    ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN ?? "15m",
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d",
} as const;
