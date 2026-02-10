import * as v from 'valibot'

import {
	EventsQueue,
	ProjectStatsEventSchema,
	SessionEndEventSchema,
	SessionStartEventSchema,
	type MetricsEvent,
	type ProjectStatsEvent,
	type SessionEndEvent,
	type SessionStartEvent,
} from './events.js'

export type Options = {
	fetch?: (
		input: string | URL | Request,
		options?: RequestInit,
	) => Promise<Response>
	heartbeatInterval?: number
	metricsEndpoint: string
	retryInterval?: number
	// TODO: Somewhat clunky API but TS gets difficult when trying to do conditional types
	storage: {
		getEvents: () => Array<MetricsEvent>
		// TODO: null vs separate method?
		setEvents: (queue: Array<MetricsEvent> | null) => void

		getTimestamp: (type: 'heartbeat' | 'session_end') => number | null
		// TODO: null vs separate method?
		setTimestamp: (
			type: 'heartbeat' | 'session_end',
			value: number | null,
		) => void
	}
}

export class ComapeoMetricsClient {
	#activeSessionId: string | null = null
	#eventsQueue
	#fetch
	#flushingPromise: Promise<Response> | null = null
	#heartbeatInterval
	#heartbeatIntervalId: NodeJS.Timeout | null = null
	#metricsEndpoint
	#retryInterval
	#retryIntervalId: NodeJS.Timeout | null = null
	#storage

	constructor({
		fetch = globalThis.fetch,
		metricsEndpoint,
		heartbeatInterval = 5_000,
		retryInterval = 10_000,
		storage,
	}: Options) {
		this.#eventsQueue = new EventsQueue({
			storage: { get: storage.getEvents, set: storage.setEvents },
		})
		this.#fetch = fetch
		this.#heartbeatInterval = heartbeatInterval
		this.#metricsEndpoint = metricsEndpoint
		this.#retryInterval = retryInterval
		this.#storage = storage

		// TODO: debounce #flushEvents()
		// this.#flushEvents = debounce(this.#flushEvents.bind(this), 1000)
	}

	setOnline(isOnline: boolean) {
		if (this.#retryIntervalId) {
			clearInterval(this.#retryIntervalId)
			this.#retryIntervalId = null
		}

		if (isOnline) {
			this.#flushEvents()

			this.#retryIntervalId = setInterval(() => {
				this.#flushEvents()
			}, this.#retryInterval)
		}
	}

	addEvent(
		// TODO: supporting BaseEvent causes inference looseness with known events
		event:
			| SessionStartEvent
			| SessionEndEvent
			| ProjectStatsEvent
			| MetricsEvent,
	) {
		// TODO: Dedupe if `dedupeKey` is present

		if (event.eventName === SessionStartEventSchema.entries.eventName.literal) {
			v.assert(SessionStartEventSchema, event)

			this.#activeSessionId = generateSessionId()

			const lastHeartbeat = this.#storage.getTimestamp('heartbeat')

			const now = Date.now()

			if (
				typeof lastHeartbeat === 'number' &&
				now - lastHeartbeat > this.#heartbeatInterval
			) {
				this.#eventsQueue.add({
					...event,
					eventName: 'session_end',
					properties: {
						sessionId: this.#activeSessionId,
						endTime: lastHeartbeat,
					},
				} satisfies SessionEndEvent)
			}

			const lastSessionEnd = this.#storage.getTimestamp('session_end')

			// TODO: Check logic
			if (
				typeof lastSessionEnd === 'number' &&
				now - lastSessionEnd < this.#heartbeatInterval
			) {
				this.#storage.setTimestamp('session_end', null)
			}

			this.#eventsQueue.add({
				...event,
				properties: {
					...event.properties,
					sessionId: this.#activeSessionId,
				},
			})

			this.#heartbeatIntervalId = setInterval(() => {
				this.#storage.setTimestamp('heartbeat', Date.now())
			}, this.#heartbeatInterval)
		} else if (
			event.eventName === SessionEndEventSchema.entries.eventName.literal
		) {
			v.assert(SessionEndEventSchema, event)

			try {
				this.#eventsQueue.add({
					...event,
					properties: {
						...event.properties,
						sessionId: this.#activeSessionId,
					},
				})

				this.#storage.setTimestamp('session_end', event.properties.endTime)
			} finally {
				// TODO: Setting this causes flushEvent to no-op. Review expected behavior.
				this.#activeSessionId = null
			}

			if (this.#heartbeatIntervalId) {
				clearInterval(this.#heartbeatIntervalId)
				this.#heartbeatIntervalId = null
			}
		} else if (
			event.eventName === ProjectStatsEventSchema.entries.eventName.literal
		) {
			v.assert(ProjectStatsEventSchema, event)

			this.#eventsQueue.add(event)
		} else {
			this.#eventsQueue.add(event)
		}

		// TODO: Need to add catch handler here?
		this.#flushEvents()
	}

	async #flushEvents() {
		// TODO: Is this desired?
		if (!this.#activeSessionId) return

		if (this.#eventsQueue.length === 0) return

		await this.#flushingPromise

		const eventsToSend = [...this.#eventsQueue.value]

		this.#eventsQueue.clear()

		try {
			this.#flushingPromise = this.#fetch(this.#metricsEndpoint, {
				method: 'POST',
				body: JSON.stringify({ events: ndjson(eventsToSend) }),
			})

			const response = await this.#flushingPromise

			if (!response.ok) {
				throw new Error(`Response status: ${response.status}`)
			}
		} catch (_error) {
			// TODO: Do something with error?
			this.#eventsQueue.add(...eventsToSend)
		} finally {
			this.#flushingPromise = null
		}
	}
}

// TODO: Figure out proper implementation
function generateSessionId(): string {
	return Date.now().toString()
}

function ndjson(events: Array<unknown>): string {
	return events.map((event) => JSON.stringify(event)).join('\n')
}
