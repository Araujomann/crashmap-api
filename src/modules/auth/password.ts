import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;


export function hashPassword(password: string): string {
    const salt = randomBytes(PASSWORD_SALT_BYTES).toString("hex");
    const derivedKey = scryptSync(password, salt, PASSWORD_KEY_BYTES).toString(
        "hex",
    );

    return `${salt}:${derivedKey}`;
}

export function verifyPassword(
    password: string,
    passwordHash: string,
): boolean {
    const [salt, storedDerivedKey] = passwordHash.split(":");

    if (!salt || !storedDerivedKey) {
        return false;
    }

    const derivedKeyBuffer = scryptSync(password, salt, PASSWORD_KEY_BYTES);
    const storedBuffer = Buffer.from(storedDerivedKey, "hex");

    if (derivedKeyBuffer.length !== storedBuffer.length) {
        return false;
    }

    return timingSafeEqual(derivedKeyBuffer, storedBuffer);
}
