import type { JsonValue } from "type-fest";
import * as v from "valibot";

export const EventSchema = v.object({
  subjectId: v.pipe(v.string(), v.minLength(1)),
  subjectCohort: v.nullish(v.string(), null),
  createdAt: v.number(),
  dedupeKey: v.nullish(v.string(), null),
  sequence: v.nullish(v.number(), null),
  eventName: v.pipe(v.string(), v.minLength(1)),
  properties: v.record(v.string(), v.unknown() as v.GenericSchema<JsonValue>),
});

export type MetricEvent = v.InferOutput<typeof EventSchema>;
