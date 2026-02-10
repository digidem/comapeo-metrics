import { setTimeout } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ComapeoMetricsClient,
	type ComapeoMetricsClientOptions,
	type MetricsEvent,
	type ProjectStatsEvent,
	type SessionStartEvent,
} from '../src/index.js'

describe('addEvent()', () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	it('throws when attempting to add invalid known events', () => {
		const client = new ComapeoMetricsClient(setupOptions())

		expect(() => {
			client.addEvent({
				eventName: 'session_start',
				subjectId: 'a',
			})
		}, 'invalid session start event').toThrow()

		expect(() => {
			client.addEvent({
				eventName: 'session_end',
				subjectId: 'a',
			})
		}, 'invalid session end event').toThrow()

		expect(() => {
			client.addEvent({
				eventName: 'project_stats',
				subjectId: 'a',
			})
		}, 'invalid project stats event').toThrow()
	})

	it('adds session end event when session start event is added after heartbeat interval', async () => {
		vi.useFakeTimers()

		const heartbeatInterval = 5_000
		const options = setupOptions({ heartbeatInterval })

		const fetchMock = vi.spyOn(options, 'fetch')

		fetchMock.mockImplementation(async () => {
			throw new Error('Failure')
		})

		const setTimestampMock = vi.spyOn(options.storage, 'setTimestamp')

		const client = new ComapeoMetricsClient(options)

		const eventA: SessionStartEvent = {
			eventName: 'session_start',
			subjectId: 'a',
			properties: {
				startTime: Date.now(),
			},
		}

		client.addEvent(eventA)

		// First heartbeat is written
		vi.advanceTimersByTime(heartbeatInterval)

		const firstHeartbeatTime = options.storage.getTimestamp('heartbeat')

		expect(firstHeartbeatTime).not.toBeNull()

		// Prevent another heartbeat from being written when next interval elapses
		setTimestampMock.mockImplementationOnce((type, value) => {
			if (type === 'session_end') {
				return setTimestampMock.getMockImplementation()!(type, value)
			}
		})

		vi.advanceTimersByTime(heartbeatInterval + 1_00)

		const eventB: SessionStartEvent = {
			eventName: 'session_start',
			subjectId: 'b',
			properties: {
				startTime: Date.now(),
			},
		}

		client.addEvent(eventB)

		expect(options.storage.getEvents()).toStrictEqual([
			{
				...eventA,
				properties: { ...eventA.properties, sessionId: expect.any(String) },
			},
			{
				eventName: 'session_end',
				subjectId: eventB.subjectId,
				properties: {
					sessionId: expect.any(String),
					endTime: firstHeartbeatTime,
				},
			},
			{
				...eventB,
				properties: { ...eventB.properties, sessionId: expect.any(String) },
			},
		])
	})

	it('persists events when sending fails', async () => {
		const options = setupOptions()

		const fetchSpy = vi.spyOn(options, 'fetch')

		const client = new ComapeoMetricsClient(options)

		const sessionStartEvent = {
			eventName: 'session_start',
			subjectId: 'a',
			properties: { startTime: Date.now() },
		}

		// Simulate failure to send due to runtime error
		fetchSpy.mockImplementationOnce(async () => {
			throw new Error('Fake error')
		})

		client.addEvent(sessionStartEvent)

		expect(options.storage.getEvents()).toStrictEqual([
			{
				...sessionStartEvent,
				properties: {
					...sessionStartEvent.properties,
					sessionId: expect.any(String),
				},
			},
		])

		const projectStatsEvent: ProjectStatsEvent = {
			subjectId: 'a',
			eventName: 'project_stats',
			dedupeKey: 'a',
			sequence: 1,
			properties: {
				averagePerDay: 0,
				count: 0,
				recordType: 'member',
				week: '2026-01',
			},
		}

		// Simulate failure to send due to response type
		fetchSpy.mockImplementationOnce(async () => {
			return new Response('Not Found', { status: 404 })
		})

		client.addEvent(projectStatsEvent)

		expect(options.storage.getEvents()).toStrictEqual([
			{
				...sessionStartEvent,
				properties: {
					...sessionStartEvent.properties,
					sessionId: expect.any(String),
				},
			},
			projectStatsEvent,
		])

		const sessionEndEvent = {
			eventName: 'session_end',
			subjectId: 'a',
			properties: { endTime: Date.now() },
		}

		// Simulate failure to send due to response type
		fetchSpy.mockImplementationOnce(async () => {
			return new Response('Server Error', { status: 500 })
		})

		client.addEvent(sessionEndEvent)

		expect(options.storage.getEvents()).toStrictEqual([
			{
				...sessionStartEvent,
				properties: {
					...sessionStartEvent.properties,
					sessionId: expect.any(String),
				},
			},
			projectStatsEvent,
			{
				...sessionEndEvent,
				properties: {
					...sessionEndEvent.properties,
					sessionId: expect.any(String),
				},
			},
		])
	})

	it.todo(
		'clears persisted events and sends them all when sending succeeds',
		async () => {},
	)
})

describe('setOnline()', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	it('does not affect heartbeats', async () => {
		const heartbeatInterval = 5_000
		const options = setupOptions({ heartbeatInterval })

		const setTimestampSpy = vi.spyOn(options.storage, 'setTimestamp')

		const client = new ComapeoMetricsClient(options)

		// 1. Default behavior
		client.addEvent({
			eventName: 'session_start',
			subjectId: 'a',
			properties: { startTime: Date.now() },
		})

		vi.advanceTimersByTime(heartbeatInterval)

		expect(
			setTimestampSpy.mock.calls.filter(([type]) => type === 'heartbeat'),
		).toHaveLength(1)

		// 2. Set online to false
		client.setOnline(false)

		vi.advanceTimersByTime(heartbeatInterval)

		expect(
			setTimestampSpy.mock.calls.filter(([type]) => type === 'heartbeat'),
		).toHaveLength(2)

		// 3. Set online to true
		client.setOnline(true)

		vi.advanceTimersByTime(heartbeatInterval)

		expect(
			setTimestampSpy.mock.calls.filter(([type]) => type === 'heartbeat'),
		).toHaveLength(3)
	})

	it('does affect retries', async () => {
		const retryInterval = 5_000

		const options = setupOptions({ retryInterval })

		const fetchSpy = vi.spyOn(options, 'fetch')

		// Make all fetches fail for this test
		fetchSpy.mockImplementation(async () => {
			throw new Error('Fake failure')
		})

		const client = new ComapeoMetricsClient(options)

		// 1. Default behavior
		client.addEvent({
			eventName: 'session_start',
			subjectId: 'a',
			properties: { startTime: Date.now() },
		})

		await setTimeout()

		expect(fetchSpy).toHaveBeenCalledTimes(1)

		// 2. Set online to false
		client.setOnline(false)

		vi.advanceTimersByTime(retryInterval)

		expect(fetchSpy).toHaveBeenCalledTimes(1)

		// 3. Set online back to true
		client.setOnline(true)

		await setTimeout()

		expect(fetchSpy).toHaveBeenCalledTimes(2)
	})
})

function setupOptions(
	overrides?: Partial<ComapeoMetricsClientOptions>,
): ComapeoMetricsClientOptions {
	let eventsQueue: Array<MetricsEvent> | null = null
	let sessionEndTs: number | null = null
	let heartbeatTs: number | null = null

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
			setTimestamp: (type, value) => {
				if (type === 'session_end') {
					sessionEndTs = value
				} else {
					heartbeatTs = value
				}
			},
			getTimestamp: (type) => {
				if (type === 'heartbeat') {
					return heartbeatTs
				} else {
					return sessionEndTs
				}
			},
		},
		...overrides,
	}
}
