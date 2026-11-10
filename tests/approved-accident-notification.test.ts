import assert from "node:assert/strict";
import test from "node:test";
import { buildApprovedAccidentPushMessage } from "../src/modules/notifications/notifications.service.js";

test("approved accident push carries its event type and accident ID", () => {
    const message = buildApprovedAccidentPushMessage(
        "ExponentPushToken[test]",
        "accident-id",
    );

    assert.deepEqual(message.data, {
        type: "ACCIDENT_APPROVED",
        accidentId: "accident-id",
    });
});
