import { AppError } from "../../shared/errors/app-error.js";

export class AuthError extends AppError {
    constructor(message: string, statusCode: number, code: string) {
        super(message, statusCode, code);
        this.name = "AuthError";
    }
}
