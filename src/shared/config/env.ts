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

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: readPort(process.env.PORT),
    DATABASE_URL: readRequiredEnv("DATABASE_URL"),
    ACCESS_TOKEN_SECRET: readRequiredEnv("ACCESS_TOKEN_SECRET"),
    REFRESH_TOKEN_SECRET: readRequiredEnv("REFRESH_TOKEN_SECRET"),
    ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN ?? "15m",
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d",
    SMTP_USER: process.env.SMTP_USER?.trim() ?? "",
    SMTP_PASS: process.env.SMTP_PASS?.replace(/\s/g, "") ?? "",
    SMTP_FROM:
        process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
    CLOUDINARY_CLOUD_NAME: cloudinaryConfig.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: cloudinaryConfig.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: cloudinaryConfig.CLOUDINARY_API_SECRET,
    CLOUDINARY_URL: cloudinaryConfig.CLOUDINARY_URL,
} as const;
