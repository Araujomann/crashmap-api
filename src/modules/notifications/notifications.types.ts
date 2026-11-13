export type PushPlatform = "android" | "ios";

export interface RegisterPushTokenBody {
    token: string;
    platform: PushPlatform;
}

export interface UnregisterPushTokenBody {
    token: string;
}

export interface AdministrativeNoticeBody {
    message: string;
}
