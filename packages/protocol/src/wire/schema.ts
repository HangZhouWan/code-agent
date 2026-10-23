/**
 * Wire 层通用 zod schema
 */

import { z } from "zod";
import { ERROR_CODES } from "../errors.js";
import type { JsonValue } from "../json.js";
import { SESSION_EVENT_TYPES } from "../events/session-events.js";

export const isoTimestampSchema = z.string().min(1);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
) as z.ZodType<JsonValue>;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const serializedErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  details: jsonValueSchema.optional(),
});

export const sessionEventTypeSchema = z.enum(SESSION_EVENT_TYPES);
