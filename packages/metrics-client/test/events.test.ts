import { describe, expect, it } from 'vitest'

import { dedupeEvents, type MetricsEvent } from '../src/events.js'

describe('dedupeEvents()', () => {
	it('does nothing when dedupeKey is absent', () => {
		const eventA1: MetricsEvent = {
			eventName: 'event_a',
			subjectId: 'a',
			sequence: 1,
		}

		const eventA2: MetricsEvent = {
			eventName: 'event_a',
			subjectId: 'a',
			sequence: 2,
		}

		expect(dedupeEvents([eventA1, eventA2])).toStrictEqual([eventA1, eventA2])
	})

	it('dedupeKey is applied per event name', () => {
		const dedupeKey = 'some_dedupe_key'

		const eventA1: MetricsEvent = {
			eventName: 'event_a',
			subjectId: 'a',
			dedupeKey,
			sequence: 1,
		}

		const eventB1: MetricsEvent = {
			eventName: 'event_b',
			subjectId: 'b',
			dedupeKey,
			sequence: 1,
		}

		expect(dedupeEvents([eventA1, eventB1])).toStrictEqual([eventA1, eventB1])
	})

	it('keeps the last event with the dedupe key', () => {
		const dedupeKeyA = 'dedupe_key_a'
		const dedupeKeyB = 'dedupe_key_b'

		const eventA1: MetricsEvent = {
			eventName: 'event_a',
			subjectId: 'a',
			dedupeKey: dedupeKeyA,
			sequence: 1,
		}

		const eventB1: MetricsEvent = {
			eventName: 'event_b',
			subjectId: 'b',
			dedupeKey: dedupeKeyB,
			sequence: 1,
		}

		const eventA2: MetricsEvent = {
			eventName: 'event_a',
			subjectId: 'a',
			dedupeKey: dedupeKeyA,
			sequence: 2,
		}

		const eventB2: MetricsEvent = {
			eventName: 'event_b',
			subjectId: 'b',
			dedupeKey: dedupeKeyB,
			sequence: 2,
		}

		expect(dedupeEvents([eventA1, eventB1, eventA2, eventB2])).toStrictEqual([
			eventA2,
			eventB2,
		])
	})
})
