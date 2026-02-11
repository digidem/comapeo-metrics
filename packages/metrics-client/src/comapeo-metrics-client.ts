import {
	EventsQueue,
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
	sessionTimeout?: number
	metricsEndpoint: string
	storage: {
		getEvents: () => Array<MetricsEvent>
		setEvents: (queue: Array<MetricsEvent> | null) => void
		getHeartbeat: () => {
			sessionId: string
			timestamp: number
		} | null
		setHeartbeat: (
			value: {
				sessionId: string
				timestamp: number
			} | null,
		) => void
	}
}

type QueuedSessionEvent = (SessionStartEvent | SessionEndEvent) & {
	properties: { sessionId: string }
}

export class ComapeoMetricsClient {
	#activeSessionId: string | null = null
	#eventsQueue
	#fetch
	#flushingPromise: Promise<Response> | null = null
	#heartbeatInterval
	#heartbeatIntervalId: NodeJS.Timeout | null = null
	#metricsEndpoint
	#sessionTimeout
	#storage

	constructor({
		fetch = globalThis.fetch,
		metricsEndpoint,
		heartbeatInterval = 5_000,
		storage,
		sessionTimeout = 10_000,
	}: Options) {
		this.#fetch = fetch
		this.#storage = storage
		this.#eventsQueue = new EventsQueue({
			storage: { get: storage.getEvents, set: storage.setEvents },
		})

		this.#metricsEndpoint = metricsEndpoint
		this.#heartbeatInterval = heartbeatInterval
		this.#sessionTimeout = sessionTimeout
	}

	// TODO: Support custom metrics events
	addEvent(event: SessionStartEvent | SessionEndEvent | ProjectStatsEvent) {
		if (event.eventName === 'session_start') {
			// 1. Determine if a session end event needs to be added first based on the heartbeat.
			const lastHeartbeat = this.#storage.getHeartbeat()

			const now = Date.now()

			if (lastHeartbeat) {
				const sessionTimeoutExceeded =
					now - lastHeartbeat.timestamp > this.#sessionTimeout

				if (sessionTimeoutExceeded) {
					this.#eventsQueue.add({
						...event,
						eventName: 'session_end',
						properties: {
							endTime: lastHeartbeat.timestamp,
							sessionId: lastHeartbeat.sessionId,
						},
					} satisfies QueuedSessionEvent)
				} else {
					this.#activeSessionId = lastHeartbeat.sessionId
				}
			}

			// 2. Potentially remove the most recently queued session end event.
			// If there is already a session end event that was added recently enough,
			// we treat this call as a continuation of the session that the end event refers to by
			// removing the queued session end event, updating the active session ID, and not adding the session start event.
			for (let i = this.#eventsQueue.value.length - 1; i >= 0; i--) {
				const e = this.#eventsQueue.value[i]!

				if (
					e.eventName === 'session_end' &&
					!!e.properties &&
					typeof e.properties['sessionId'] === 'string' &&
					typeof e.properties['endTime'] === 'number' &&
					now - e.properties['endTime'] < this.#sessionTimeout
				) {
					const updatedQueueValues = [...this.#eventsQueue.value]

					updatedQueueValues.splice(i, 1)

					this.#eventsQueue.clear()
					this.#eventsQueue.add(...updatedQueueValues)

					this.#activeSessionId = e.properties['sessionId']

					return
				}
			}

			// 3. Add session start event
			if (!this.#activeSessionId) {
				this.#activeSessionId = generateSessionId()
			}

			this.#eventsQueue.add({
				...event,
				properties: {
					...event.properties,
					sessionId: this.#activeSessionId,
				},
			} satisfies QueuedSessionEvent)

			// 4. Update internal state
			this.#heartbeatIntervalId = setInterval(() => {
				if (!this.#activeSessionId) {
					return
				}

				this.#storage.setHeartbeat({
					timestamp: Date.now(),
					sessionId: this.#activeSessionId,
				})
			}, this.#heartbeatInterval)

			// 4. Flush
			this.#flushEvents()

			return
		}

		if (event.eventName === 'session_end') {
			// TODO: Throw error here?
			if (!this.#activeSessionId) {
				return
			}

			// 1. Add event to queue
			this.#eventsQueue.add({
				...event,
				properties: {
					...event.properties,
					sessionId: this.#activeSessionId,
				},
			} satisfies QueuedSessionEvent)

			// 2. Update internal state
			this.#activeSessionId = null

			if (this.#heartbeatIntervalId) {
				clearInterval(this.#heartbeatIntervalId)
				this.#heartbeatIntervalId = null
			}

			return
		}

		this.#eventsQueue.add(event)
	}

	async #flushEvents() {
		if (!this.#activeSessionId) return

		if (this.#eventsQueue.length === 0) return

		await this.#flushingPromise

		// TODO: Dedupe events based on dedupeKey
		const eventsToSend = [...this.#eventsQueue.value]

		this.#eventsQueue.clear()

		try {
			// TODO: Keep retrying until a certain point (maybe use exponential backoff?)
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
