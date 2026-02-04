import * as v from 'valibot'

import {
	ProjectStatsEventSchema,
	SessionEndEventSchema,
	SessionStartEventSchema,
	type ProjectStatsEvent,
	type SessionEndEvent,
	type SessionStartEvent,
} from './events.js'

type Options = {
	fetch?: (
		input: string | URL | Request,
		options?: RequestInit,
	) => Promise<Response>
	heartbeatInterval?: number
	metricsEndpoint: string
	retryInterval?: number
	storage: {
		// TODO: Ideally narrow return type based on key
		get: (key: 'events_queue' | 'heartbeat' | 'session_end') => unknown

		// TODO: Ideally narrow value type based on key
		set: (
			key: 'events_queue' | 'heartbeat' | 'session_end',
			value: unknown,
		) => void

		remove: (key: 'heartbeat' | 'session_end' | 'events_queue') => void
	}
}

export class ComapeoMetricsClient {
	#eventsQueue: Array<unknown>
	#fetch
	#retryInterval
	#flushingPromise: Promise<Response> | null = null
	#heartbeatInterval
	#heartbeatIntervalId: NodeJS.Timeout | null = null
	#metricsEndpoint
	#retryIntervalId: NodeJS.Timeout | null = null
	#storage
	#sessionIsActive = false

	constructor({
		fetch = globalThis.fetch,
		metricsEndpoint,
		heartbeatInterval = 5_000,
		retryInterval = 10_000,
		storage,
	}: Options) {
		// TODO: Initialize using storage
		this.#eventsQueue = []
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

	// TODO: ideally can support user-defined events
	addEvent(event: SessionStartEvent | SessionEndEvent | ProjectStatsEvent) {
		if (v.is(SessionStartEventSchema, event)) {
			this.#sessionIsActive = true

			const lastHeartbeat = this.#storage.get('heartbeat')

			if (
				typeof lastHeartbeat === 'number' &&
				Date.now() - lastHeartbeat > this.#heartbeatInterval
			) {
				// TODO: Push session_end event to queue with endTime = lastHeartbeat
				this.#eventsQueue.push({
					...event,
					eventName: 'session_end',
					properties: {
						endTime: lastHeartbeat,
					},
				} satisfies SessionEndEvent)
			}

			const lastSessionEnd = this.#storage.get('session_end')

			// TODO: Check logic
			if (
				typeof lastSessionEnd === 'number' &&
				Date.now() - lastSessionEnd < this.#heartbeatInterval
			) {
				this.#storage.remove('session_end')
				return
			}

			this.#heartbeatIntervalId = setInterval(() => {
				this.#storage.set('heartbeat', Date.now())
			}, this.#heartbeatInterval)

			this.#eventsQueue.push(event)
		} else if (v.is(SessionEndEventSchema, event)) {
			this.#sessionIsActive = false

			this.#eventsQueue.push(event)

			if (this.#heartbeatIntervalId) {
				clearInterval(this.#heartbeatIntervalId)
				this.#heartbeatIntervalId = null
			}
		} else if (v.is(ProjectStatsEventSchema, event)) {
			this.#eventsQueue.push(event)
		} else {
			this.#eventsQueue.push(event)
		}

		this.#flushEvents()
	}

	async #flushEvents() {
		if (!this.#sessionIsActive) return

		if (this.#eventsQueue.length === 0) return

		await this.#flushingPromise

		const eventsToSend = [...this.#eventsQueue]

		this.#eventsQueue = []

		try {
			this.#flushingPromise = this.#fetch(this.#metricsEndpoint, {
				method: 'POST',
				body: JSON.stringify({ events: ndjson(this.#eventsQueue) }),
			})

			await this.#flushingPromise
		} catch (error) {
			this.#eventsQueue.unshift(...eventsToSend)
		} finally {
			this.#flushingPromise = null
		}
	}
}

function ndjson(events: Array<unknown>): string {
	return events.map((event) => JSON.stringify(event)).join('\n')
}
