import { createHash, createHmac, randomInt } from "node:crypto";

/** HMAC-SHA256 em hexadecimal. */
export function hmacSha256Hex(secret: string, data: string): string {
    return createHmac("sha256", secret).update(data).digest("hex");
}

/** SHA-256 em hexadecimal (para tokens aleatórios guardados só como hash). */
export function sha256Hex(data: string): string {
    return createHash("sha256").update(data).digest("hex");
}

/** Código numérico de 6 dígitos, com zeros à esquerda. */
export function generateSixDigitCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
