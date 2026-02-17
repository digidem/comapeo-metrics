import type { JsonValue } from 'type-fest'
import * as v from 'valibot'

export const MetricsEventSchema = v.object({
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
		this.#storage.set(this.#queue)
		this.#queue.push(...events)
	}

	clear() {
		this.#storage.set(null)
		this.#queue = []
	}
}

/**
 * Concatenation of an event name and a dedupe key.
 */
type EventDedupeId = `${string}:${string}`

/**
 * Produces an array of events that removes duplicates based on the `eventName` and `dedupeKey` fields.
 * The last occurring duplicate is kept.
 *
 * @param events Collection of events to dedupe
 * @returns Deduped collection of events
 */
export function dedupeEvents(events: Array<MetricsEvent>): Array<MetricsEvent> {
	const idToEventMap = new Map<EventDedupeId, MetricsEvent>()

	// List of events or an event dedupe ID "marker" that's later replaced with the appropriate event.
	const result: Array<MetricsEvent | EventDedupeId> = []

	for (const e of events) {
		if (!e.dedupeKey) {
			result.push(e)
			continue
		}

		const id = `${e.eventName}:${e.dedupeKey}` as const

		// If the event name + dedupe key combo has been encountered before,
		// we move the existing marker to the end of the result.
		if (idToEventMap.has(id)) {
			const index = result.findLastIndex((v) => v === id)

			if (index < 0) {
				throw new Error(`Unreachable state. Expected to find key ${id}`)
			}

			result.splice(index, 1)
		}

		idToEventMap.set(id, e)

		result.push(id)
	}

	return result.map((v) => {
		// Replace any markers with the actual events of interest
		return typeof v === 'string' ? idToEventMap.get(v)! : v
	})
}
