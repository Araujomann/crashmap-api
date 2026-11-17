import { createHash, createHmac, randomInt } from "node:crypto";


export function hmacSha256Hex(secret: string, data: string): string {
    return createHmac("sha256", secret).update(data).digest("hex");
}


export function sha256Hex(data: string): string {
    return createHash("sha256").update(data).digest("hex");
}


export function generateSixDigitCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
