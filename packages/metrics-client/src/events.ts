import type { JsonValue } from 'type-fest'
import * as v from 'valibot'

const MetricsEventSchema = v.object({
	eventName: v.pipe(v.string(), v.minLength(1)),
	subjectId: v.pipe(v.string(), v.minLength(1)),
	subjectCohort: v.optional(v.string()),
	dedupeKey: v.optional(v.string()),
	sequence: v.optional(v.number()),
	properties: v.optional(
		v.record(v.string(), v.unknown() as v.GenericSchema<JsonValue>),
	),
})
export type MetricsEvent = v.InferInput<typeof MetricsEventSchema>

export const SessionStartEventSchema = v.object({
	...MetricsEventSchema.entries,
	eventName: v.literal('session_start'),
	properties: v.objectWithRest(
		{ startTime: v.number() },
		v.unknown() as v.GenericSchema<JsonValue>,
	),
})
export type SessionStartEvent = v.InferInput<typeof SessionStartEventSchema>

export const SessionEndEventSchema = v.object({
	...MetricsEventSchema.entries,
	eventName: v.literal('session_end'),
	properties: v.objectWithRest(
		{ endTime: v.number() },
		v.unknown() as v.GenericSchema<JsonValue>,
	),
})
export type SessionEndEvent = v.InferInput<typeof SessionEndEventSchema>

export const ProjectStatsEventSchema = v.object({
	...MetricsEventSchema.entries,
	eventName: v.literal('project_stats'),
	dedupeKey: v.string(),
	sequence: v.number(),
	properties: v.objectWithRest(
		{
			recordType: v.union([
				v.literal('observation'),
				v.literal('track'),
				v.literal('member'),
			]),
			week: v.string(),
			count: v.number(),
			averagePerDay: v.number(),
		},
		v.unknown() as v.GenericSchema<JsonValue>,
	),
})
export type ProjectStatsEvent = v.InferInput<typeof ProjectStatsEventSchema>

type Storage = {
	// TODO: null or separate method?
	set: (value: Array<MetricsEvent> | null) => void
	get: () => Array<MetricsEvent>
}

export class EventsQueue {
	#queue: Array<MetricsEvent>
	#storage: Storage

	constructor({ storage }: { storage: Storage }) {
		this.#queue = storage.get()
		this.#storage = storage
	}

	get length() {
		return this.#queue.length
	}

	get value() {
		return this.#queue
	}

	add(...events: Array<MetricsEvent>) {
		this.#queue.push(...events)
		this.#storage.set(this.#queue)
	}

	clear() {
		this.#queue = []
		this.#storage.set(null)
	}
}
