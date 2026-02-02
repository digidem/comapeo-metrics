import { describe, expect, it, vi } from 'vitest'

import { CoMapeoMetrics, type CoMapeoMetricsEvent } from '../src/index.js'

describe('addEvent', () => {
	it('has expected behavior when sending succeeds', async () => {
		let db: Array<CoMapeoMetricsEvent> = []

		const metrics = new CoMapeoMetrics({
			send: async () => {
				return true
			},
			storage: {
				get: () => {
					return db
				},
				set: (events) => {
					db = events
				},
			},
		})

		await metrics.addEvent({ type: 'a', data: { id: 'a' } })

		expect(db).toStrictEqual([])
	})

	it('has expected behavior when sending fails', async () => {
		let db: Array<CoMapeoMetricsEvent> = []

		const sendMock = vi.fn(async () => {
			return false
		})

		const metrics = new CoMapeoMetrics({
			send: sendMock,
			storage: {
				get: () => {
					return db
				},
				set: (events) => {
					db = events
				},
			},
		})

		await metrics.addEvent({ type: 'a', data: { id: 'a' } })

		expect(db).toStrictEqual([{ type: 'a', data: { id: 'a' } }])

		sendMock.mockImplementation(async () => {
			throw new Error('Test send error')
		})

		await metrics.addEvent({ type: 'b', data: { id: 'b' } })

		expect(db).toStrictEqual([
			{ type: 'a', data: { id: 'a' } },
			{ type: 'b', data: { id: 'b' } },
		])
	})
})

describe('flushEvents', () => {
	it('has expected behavior when sending succeeds', async () => {
		let db: Array<CoMapeoMetricsEvent> = [
			{ type: 'a', data: { id: 'a' } },
			{ type: 'b', data: { id: 'b' } },
			{ type: 'c', data: { id: 'c' } },
		]

		const sendMock = vi.fn(async () => {
			return true
		})

		const metrics = new CoMapeoMetrics({
			send: sendMock,
			storage: {
				get: () => {
					return db
				},
				set: (events) => {
					db = events
				},
			},
		})

		await metrics.flushEvents()

		expect(sendMock).toHaveBeenNthCalledWith(1, {
			type: 'a',
			data: { id: 'a' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(2, {
			type: 'b',
			data: { id: 'b' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(3, {
			type: 'c',
			data: { id: 'c' },
		})

		expect(db).toStrictEqual([])
	})

	it('has expected behavior when sending fails', async () => {
		let db: Array<CoMapeoMetricsEvent> = [
			{ type: 'a', data: { id: 'a' } },
			{ type: 'b', data: { id: 'b' } },
			{ type: 'c', data: { id: 'c' } },
		]

		const sendMock = vi.fn(async () => {
			return false
		})

		const metrics = new CoMapeoMetrics({
			send: sendMock,
			storage: {
				get: () => {
					return db
				},
				set: (events) => {
					db = events
				},
			},
		})

		await metrics.flushEvents()

		expect(sendMock).toHaveBeenNthCalledWith(1, {
			type: 'a',
			data: { id: 'a' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(2, {
			type: 'b',
			data: { id: 'b' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(3, {
			type: 'c',
			data: { id: 'c' },
		})

		expect(db).toStrictEqual([
			{ type: 'a', data: { id: 'a' } },
			{ type: 'b', data: { id: 'b' } },
			{ type: 'c', data: { id: 'c' } },
		])

		sendMock.mockClear()
		sendMock.mockImplementation(async () => {
			throw new Error('Test send error')
		})

		await metrics.flushEvents()

		expect(sendMock).toHaveBeenNthCalledWith(1, {
			type: 'a',
			data: { id: 'a' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(2, {
			type: 'b',
			data: { id: 'b' },
		})

		expect(sendMock).toHaveBeenNthCalledWith(3, {
			type: 'c',
			data: { id: 'c' },
		})

		expect(db).toStrictEqual([
			{ type: 'a', data: { id: 'a' } },
			{ type: 'b', data: { id: 'b' } },
			{ type: 'c', data: { id: 'c' } },
		])
	})
})
