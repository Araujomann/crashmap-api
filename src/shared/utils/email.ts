/** Forma canônica de um e-mail para busca e comparação. */
export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}
