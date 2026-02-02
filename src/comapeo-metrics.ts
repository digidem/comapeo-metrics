import type { CoMapeoMetricsEvent } from './events.js'

type StorageAdaptor<MetricsEvent> = {
	// TODO: Make async generator?
	/**
	 * Retrieves metrics events that have not been sent yet.
	 *
	 * @returns An array - or promise that resolves to an array - of metrics events.
	 */
	get: () => Promise<Array<MetricsEvent>> | Array<MetricsEvent>

	/**
	 * Persists metrics events that have not been sent yet.
	 *
	 * @param events Array of events to persist.
	 */
	set: (events: Array<MetricsEvent>) => Promise<void> | void
}

export type Options<MetricsEvent> = {
	/**
	 * Implementation for sending an event e.g. via HTTP request.
	 *
	 * @param event Metrics event to send.
	 * @returns Promise that resolves with success (`true`) or failure (`false`) of sending.
	 */
	send: (event: MetricsEvent) => Promise<boolean>

	/**
	 * Storage adaptor. See {@link StorageAdaptor}.
	 */
	storage: StorageAdaptor<MetricsEvent>
}

export class CoMapeoMetrics<MetricsEvent extends CoMapeoMetricsEvent> {
	#send
	#storage

	constructor(options: Options<MetricsEvent>) {
		this.#send = options.send
		this.#storage = options.storage
	}

	// TODO: make this fire-and-forget instead of async?
	addEvent = async (event: MetricsEvent) => {
		let failedToSend = false

		try {
			const sent = await this.#send(event)

			if (!sent) {
				failedToSend = true
			}
		} catch (_err) {
			failedToSend = true
		}

		if (failedToSend) {
			// TODO: What to do if this throws?
			await this.#storage.set([...(await this.#storage.get()), event])
		}
	}

	// TODO: Make less naive
	flushEvents = async () => {
		// TODO: What to do if this throws?
		const events = await this.#storage.get()

		const eventsFailedToSend: Array<MetricsEvent> = []

		for (const e of events) {
			let failedToSend = false

			try {
				const sent = await this.#send(e)

				if (!sent) {
					failedToSend = true
				}
			} catch (_err) {
				failedToSend = true
			}

			if (failedToSend) {
				eventsFailedToSend.push(e)
			}
		}

		// TODO: What to do if this throws?
		await this.#storage.set(eventsFailedToSend)
	}
}
