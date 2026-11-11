import { describe, expect, it } from "vitest";
import { AccountNotLinkedError, BadRequestError, FoodInputError, HealthApiError, NotEditableError, OffError, ReauthRequiredError } from "../../core/errors.js";
import { toApiError } from "../../src/api.browser.js";

/** The UI branches on these status codes and `error` keys (sign in again, read-only entries, …). */
describe("toApiError", () => {
  it.each([
    [new BadRequestError("bad range"), 400, "bad_request"],
    [new FoodInputError("Name is required"), 400, "bad_request"],
    [new NotEditableError("written by another app"), 403, "not_editable"],
    [new ReauthRequiredError("no session"), 401, "reauth_required"],
    [new AccountNotLinkedError(), 409, "account_not_linked"],
    [new OffError(429, "slow down"), 429, "food_database"],
    [new HealthApiError(500, { error: { message: "x" } }, "Google Health API 500: x"), 502, "google_api_error"],
    [new Error("boom"), 500, "internal"],
  ])("%o → %i %s", (err, status, key) => {
    const e = toApiError(err);
    expect(e.status).toBe(status);
    expect(e.body.error).toBe(key);
    expect(e.message).toBe((err as Error).message);
  });
});
