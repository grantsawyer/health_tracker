import { BadRequestError } from "./errors.js";
import { SOURCE_FAMILIES, addDays } from "./healthClient.js";
import { dataTypeById, type DataTypeInfo } from "../shared/dataTypes.js";

/**
 * Input checks shared by every host: the local server's routes and the
 * browser's direct calls validate requests the same way.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 366;

export function requireDataType(id: string): DataTypeInfo {
  const info = dataTypeById(id);
  if (!info) throw new BadRequestError(`Unknown data type: ${id}`);
  return info;
}

/** A civil-date range [start, end), at most MAX_RANGE_DAYS long. */
export function validateRange(start: string | undefined, end: string | undefined): { start: string; end: string } {
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    throw new BadRequestError("start and end are required as YYYY-MM-DD (end exclusive)");
  }
  if (start >= end) throw new BadRequestError("start must be before end");
  if (addDays(start, MAX_RANGE_DAYS) < end) throw new BadRequestError(`Range is limited to ${MAX_RANGE_DAYS} days`);
  return { start, end };
}

export function requireDate(value: string | undefined, label: string): string {
  if (!value || !ISO_DATE.test(value)) throw new BadRequestError(`${label} is required as YYYY-MM-DD`);
  return value;
}

/** UI source name ("all", "self", …) → dataSourceFamily resource, or undefined for all sources. */
export function sourceFamily(source: string | undefined): string | undefined {
  if (!source || source === "all") return undefined;
  const family = SOURCE_FAMILIES[source as keyof typeof SOURCE_FAMILIES];
  if (!family) throw new BadRequestError(`source must be one of: ${Object.keys(SOURCE_FAMILIES).join(", ")}`);
  return family;
}
