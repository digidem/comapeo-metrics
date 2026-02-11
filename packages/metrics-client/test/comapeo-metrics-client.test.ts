import { setTimeout } from 'node:timers/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
	ComapeoMetricsClient,
	type ComapeoMetricsClientOptions,
	type MetricsEvent,
} from '../src/index.js'

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.resetAllMocks()
})

it('no-ops when adding session end event while session has not been started', async () => {
	const heartbeatInterval = 5_000

	const options = createOptions({ heartbeatInterval })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	client.addEvent({
		eventName: 'session_end',
		subjectId: 'a',
		properties: { endTime: Date.now() },
	})

	await setTimeout()

	expect(fetchMock).not.toBeCalled()
	expect(options.storage.getEvents()).toStrictEqual([])

	vi.advanceTimersByTime(heartbeatInterval * 2)

	expect(options.storage.getHeartbeat()).toBeNull()
})

it('sent session events have a sessionId property', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toMatchObject([
		{
			// Sanity check
			subjectId: 'a',
			properties: {
				sessionId: expect.any(String),
			},
		},
	])

	vi.advanceTimersByTime(sessionTimeout)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'b',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toMatchObject([
		{
			// Sanity check
			subjectId: 'b',
			properties: {
				sessionId: expect.any(String),
			},
		},
	])
})

it('does not send when session timeout has not been reached while adding session start event', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	// 1. Setup
	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})
	await setTimeout()
	fetchMock.mockClear()

	// 2. Actual test
	client.addEvent({
		eventName: 'session_end',
		subjectId: 'a',
		properties: {
			endTime: Date.now(),
		},
	})

	await setTimeout()

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	expect(fetchMock).not.toBeCalled()
})

it('sends when session start event is added after session timeout', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	// 1. Setup
	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})
	await setTimeout()
	fetchMock.mockClear()

	// 2. Actual test
	client.addEvent({
		eventName: 'session_end' as const,
		subjectId: 'a',
		properties: {
			endTime: Date.now(),
		},
	})

	await setTimeout()

	expect(fetchMock).not.toHaveBeenCalled()

	vi.advanceTimersByTime(sessionTimeout)

	client.addEvent({
		eventName: 'session_start' as const,
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toHaveLength(2)
})

it('events that were not sent due to failure are included in subsequent send attempts', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	fetchMock.mockImplementation(async () => {
		throw new Error('Some error')
	})

	client.addEvent({
		eventName: 'session_start' as const,
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	vi.advanceTimersByTime(sessionTimeout)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await setTimeout()

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toHaveLength(2)
})

it.todo('dedupes project stats events when sending')

function createOptions(
	overrides?: Partial<ComapeoMetricsClientOptions>,
): ComapeoMetricsClientOptions {
	let eventsQueue: Array<MetricsEvent> | null = null
	let heartbeat: { sessionId: string; timestamp: number } | null = null

	return {
		metricsEndpoint: 'https://comapeo/metrics',
		fetch: async () => {
			return new Response('success', { status: 200 })
		},
		storage: {
			getEvents: () => {
				return eventsQueue || []
			},
			setEvents: (queue) => {
				eventsQueue = queue
			},
			setHeartbeat: (value) => {
				heartbeat = value
			},
			getHeartbeat: () => {
				return heartbeat
			},
		},
		...overrides,
	}
}

function extractSentEvents(body: string): Array<MetricsEvent> {
	return JSON.parse(body, (key, value) => {
		return key === 'events' ? value.split('\n').map(JSON.parse) : value
	}).events
}
