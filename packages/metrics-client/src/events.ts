import type { JsonValue } from 'type-fest'
import * as v from 'valibot'

const BaseEventSchema = v.object({
	subjectId: v.pipe(v.string(), v.minLength(1)),
	subjectCohort: v.optional(v.string()),
	dedupeKey: v.optional(v.string()),
	sequence: v.optional(v.number()),
	eventName: v.pipe(v.string(), v.minLength(1)),
	properties: v.optional(
		v.record(v.string(), v.unknown() as v.GenericSchema<JsonValue>),
	),
})
export type BaseEvent = v.InferInput<typeof BaseEventSchema>

export const SessionStartEventSchema = v.object({
	...BaseEventSchema.entries,
	eventName: v.literal('session_start'),
	// TODO: object or looseObject?
	properties: v.looseObject({
		startTime: v.number(),
	}),
})
export type SessionStartEvent = v.InferInput<typeof SessionStartEventSchema>

export const SessionEndEventSchema = v.object({
	...BaseEventSchema.entries,
	eventName: v.literal('session_end'),
	// TODO: object or looseObject?
	properties: v.looseObject({
		endTime: v.number(),
	}),
})
export type SessionEndEvent = v.InferInput<typeof SessionEndEventSchema>

export const ProjectStatsEventSchema = v.object({
	...BaseEventSchema.entries,
	eventName: v.literal('project_stats'),
	dedupeKey: v.string(),
	sequence: v.number(),
	// TODO: object or looseObject?
	properties: v.looseObject({
		recordType: v.union([
			v.literal('observation'),
			v.literal('track'),
			v.literal('member'),
		]),
		week: v.string(),
		count: v.number(),
		averagePerDay: v.number(),
	}),
})
export type ProjectStatsEvent = v.InferInput<typeof ProjectStatsEventSchema>

type SessionEventInternal = (SessionStartEvent | SessionEndEvent) & {
	properties: {
		sessionId: string
	}
}

// TODO: Handles storage of queue when calling relevant methods
export class EventsQueue extends Array {}
