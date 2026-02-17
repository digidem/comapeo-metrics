import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
	ComapeoMetricsClient,
	type ComapeoMetricsClientOptions,
	type MetricsEvent,
	type ProjectStatsEvent,
	type SessionStartEvent,
} from '../src/index.js'

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.resetAllMocks()
})

test('adding events that are not session start events does nothing while session has not been started', async () => {
	const heartbeatInterval = 5_000

	const options = createOptions({ heartbeatInterval })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	client.addEvent({
		eventName: 'session_end',
		subjectId: 'a',
		properties: { endTime: Date.now() },
	})

	await vi.advanceTimersByTimeAsync(0)

	client.addEvent({
		eventName: 'project_stats',
		subjectId: 'a',
		dedupeKey: 'some_dedupe_key',
		sequence: 0,
		properties: {
			averagePerDay: 0,
			count: 0,
			recordType: 'observation',
			week: '2025-01',
		},
	})

	await vi.advanceTimersByTimeAsync(heartbeatInterval * 2)

	expect(fetchMock).not.toBeCalled()
	expect(options.storage.getEvents()).toStrictEqual([])

	expect(options.storage.getHeartbeat()).toBeNull()
})

test('session timeout is respected', async () => {
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

	await vi.advanceTimersByTimeAsync(0)

	fetchMock.mockClear()

	client.addEvent({
		eventName: 'session_end',
		subjectId: 'a',
		properties: {
			endTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).not.toBeCalled()

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).toBeCalled()
})

test('only session start events trigger sending', async () => {
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

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).toBeCalled()

	fetchMock.mockClear()

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	client.addEvent({
		eventName: 'project_stats',
		subjectId: 'a',
		dedupeKey: 'some_dedupe_key',
		sequence: 0,
		properties: {
			averagePerDay: 0,
			count: 0,
			recordType: 'observation',
			week: '2025-01',
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).not.toBeCalled()
	fetchMock.mockClear()

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	client.addEvent({
		eventName: 'session_end',
		subjectId: 'a',
		properties: {
			endTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).not.toBeCalled()
})

test('sent session events have a sessionId property', async () => {
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

	await vi.advanceTimersByTimeAsync(0)

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

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'b',
		properties: {
			startTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

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

test('failed sends are retried', async () => {
	const options = createOptions()

	const fetchMock = vi.spyOn(options, 'fetch')

	fetchMock.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
	fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
	fetchMock.mockRejectedValueOnce(new Error('Some runtime error'))

	const client = new ComapeoMetricsClient(options)

	client.addEvent({
		eventName: 'session_start',
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(10_000)

	expect(fetchMock).toBeCalledTimes(3)
})

test('events that were not sent due to failure are included in subsequent send attempts', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	fetchMock.mockRejectedValue(new Error('Some error'))

	const eventA: SessionStartEvent = {
		eventName: 'session_start' as const,
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	}

	client.addEvent(eventA)

	await vi.advanceTimersByTimeAsync(0)

	expect(fetchMock).toHaveBeenCalled()

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	const eventB: SessionStartEvent = {
		eventName: 'session_start',
		subjectId: 'b',
		properties: {
			startTime: Date.now(),
		},
	}

	client.addEvent(eventB)

	await vi.advanceTimersByTimeAsync(0)

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toMatchObject([eventA, eventB])
})

test('dedupes events when sending', async () => {
	const sessionTimeout = 10_000

	const options = createOptions({ sessionTimeout })

	const fetchMock = vi.spyOn(options, 'fetch')

	const client = new ComapeoMetricsClient(options)

	client.addEvent({
		eventName: 'session_start' as const,
		subjectId: 'a',
		properties: {
			startTime: Date.now(),
		},
	})

	await vi.advanceTimersByTimeAsync(0)

	const dedupeKey = 'some_dedupe_key'

	client.addEvent({
		eventName: 'project_stats',
		subjectId: 'a',
		dedupeKey,
		sequence: 0,
		properties: {
			averagePerDay: 0,
			count: 0,
			recordType: 'observation',
			week: '2025-01',
		},
	})

	const projectStatsB: ProjectStatsEvent = {
		eventName: 'project_stats',
		subjectId: 'b',
		dedupeKey,
		sequence: 1,
		properties: {
			averagePerDay: 1,
			count: 1,
			recordType: 'observation',
			week: '2025-01',
		},
	}

	client.addEvent(projectStatsB)

	await vi.advanceTimersByTimeAsync(sessionTimeout)

	const sessionStartB: SessionStartEvent = {
		eventName: 'session_start',
		subjectId: 'b',
		properties: {
			startTime: Date.now(),
		},
	}

	client.addEvent(sessionStartB)

	await vi.advanceTimersByTimeAsync(0)

	expect(
		extractSentEvents(fetchMock.mock.lastCall?.[1]!.body as string),
	).toMatchObject([projectStatsB, sessionStartB])
})

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
