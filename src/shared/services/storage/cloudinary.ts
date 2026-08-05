import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";

cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
});

function hasCloudinaryCredentials() {
    return Boolean(
        env.CLOUDINARY_CLOUD_NAME &&
        env.CLOUDINARY_API_KEY &&
        env.CLOUDINARY_API_SECRET,
    );
}

export async function uploadImageToCloudinary(
    fileBuffer: Buffer,
    folder: string,
): Promise<{ secureUrl: string; publicId: string }> {
    if (!hasCloudinaryCredentials()) {
        throw new AppError(
            "Cloudinary is not configured for image uploads",
            503,
            "CLOUDINARY_NOT_CONFIGURED",
        );
    }

    if (fileBuffer.length === 0) {
        throw new AppError("Image file is empty", 400, "EMPTY_IMAGE_FILE");
    }

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: "image",
            },
            (error, result) => {
                if (error || !result) {
                    const detail = error?.message ?? "Unknown Cloudinary error";
                    reject(
                        new AppError(
                            `Failed to upload image to Cloudinary: ${detail}`,
                            502,
                            "CLOUDINARY_UPLOAD_FAILED",
                        ),
                    );
                    return;
                }

                resolve({
                    secureUrl: result.secure_url,
                    publicId: result.public_id,
                });
            },
        );

        uploadStream.end(fileBuffer);
    });
}
