import { BadRequestError } from "./errors.js";
import { batchDeleteDataPoints, createDataPoint, isDataPointName, type Operation } from "./healthClient.js";
import { platform } from "./platform.js";
import { MEAL_TYPES } from "../shared/dataTypes.js";

/**
 * Data explorer write tools (shared by the server routes and the browser).
 */

/**
 * Write probe: one anonymous nutrition-log entry, to confirm the API accepts
 * nutrition writes and to see the response shape. Anonymous-food logs can't be
 * edited, but can be deleted with deletePoints().
 */
export async function writeTestEntry(body: unknown): Promise<{ operation: Operation }> {
  const b = (body ?? {}) as { startTime?: unknown; utcOffsetSeconds?: unknown; kcal?: unknown; mealType?: unknown; foodDisplayName?: unknown };
  if (typeof b.startTime !== "string" || Number.isNaN(Date.parse(b.startTime))) throw new BadRequestError("startTime (RFC 3339) is required");
  if (typeof b.utcOffsetSeconds !== "number" || Math.abs(b.utcOffsetSeconds) > 14 * 3600) throw new BadRequestError("utcOffsetSeconds is required");
  const kcal = b.kcal ?? 1;
  if (typeof kcal !== "number" || kcal < 0 || kcal > 100_000) throw new BadRequestError("kcal must be 0–100000");
  const mealType = b.mealType ?? "SNACK";
  if (typeof mealType !== "string" || !(MEAL_TYPES as readonly string[]).includes(mealType)) throw new BadRequestError(`mealType must be one of ${MEAL_TYPES.join(", ")}`);

  const start = new Date(b.startTime);
  const end = new Date(start.getTime() + 60_000);
  const offset = `${Math.round(b.utcOffsetSeconds)}s`;
  const operation = await createDataPoint("nutrition-log", {
    nutritionLog: {
      interval: { startTime: start.toISOString(), startUtcOffset: offset, endTime: end.toISOString(), endUtcOffset: offset },
      energy: { kcal },
      mealType,
      foodDisplayName: typeof b.foodDisplayName === "string" ? b.foodDisplayName : "Health Tracker test entry",
    },
  });
  await platform().cache.invalidateType("nutrition-log");
  return { operation };
}

/** Delete data points by resource name (users/me/dataTypes/{type}/dataPoints/{id}). */
export async function deletePoints(names: unknown): Promise<{ operation: Operation[] }> {
  if (!Array.isArray(names) || names.length === 0 || names.length > 1000 || !names.every((n) => typeof n === "string" && isDataPointName(n))) {
    throw new BadRequestError("names must be a non-empty array of names like users/me/dataTypes/{type}/dataPoints/{id}");
  }
  const operation = await batchDeleteDataPoints(names as string[]);
  for (const type of new Set((names as string[]).map((n) => n.split("/")[3]))) if (type) await platform().cache.invalidateType(type);
  return { operation };
}
