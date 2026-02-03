import { SELF } from 'cloudflare:test'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const AUTH_TOKEN = 'test-secret-token'
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54352/postgres'

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		subjectId: 'device-abc',
		subjectCohort: 'beta',
		createdAt: Date.now(),
		dedupeKey: null,
		sequence: null,
		eventName: 'test.event',
		properties: { version: '1.0.0' },
		...overrides,
	}
}

function ndjson(...objects: unknown[]): string {
	return objects.map((o) => JSON.stringify(o)).join('\n')
}

async function gzipBody(body: string): Promise<Uint8Array> {
	const stream = new Blob([body])
		.stream()
		.pipeThrough(new CompressionStream('gzip'))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Poll the database until a condition is met or timeout */
async function pollDb(
	query: () => Promise<postgres.RowList<postgres.Row[]>>,
	predicate: (rows: postgres.RowList<postgres.Row[]>) => boolean,
	timeoutMs = 15_000,
	intervalMs = 500,
): Promise<postgres.RowList<postgres.Row[]>> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const rows = await query()
		if (predicate(rows)) return rows
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}
	// Return last result even if predicate not met (test will assert and fail)
	return query()
}

describe('Full ingestion flow', () => {
	let sql: postgres.Sql

	beforeAll(() => {
		sql = postgres(DB_URL)
	})

	afterAll(async () => {
		await sql.end()
		console.log('Database connection closed')
	})

	beforeEach(async () => {
		await sql`DELETE FROM events`
	})

	it('should ingest all valid event variations and write them to Postgres', async () => {
		// Minimal event: only required fields, optional fields omitted
		const minimal = {
			subjectId: 'device-1',
			createdAt: Date.now(),
			eventName: 'minimal.event',
			properties: {},
		}
		// All optional fields explicitly null
		const withNulls = makeEvent({
			subjectId: 'device-2',
			eventName: 'nulls.event',
			subjectCohort: null,
			dedupeKey: null,
			sequence: null,
		})
		// All optional fields populated
		const withAllFields = makeEvent({
			subjectId: 'device-3',
			eventName: 'full.event',
			subjectCohort: 'beta-testers',
			dedupeKey: 'dedup-1',
			sequence: 42,
		})
		// Nested/complex properties
		const withNestedProps = makeEvent({
			subjectId: 'device-4',
			eventName: 'nested.event',
			properties: {
				str: 'hello',
				num: 123,
				bool: true,
				nullVal: null,
				arr: [1, 'two', false],
				nested: { deep: { value: 99 } },
			},
		})
		// Empty string cohort (valid — just needs to be a string or null)
		const withEmptyCohort = makeEvent({
			subjectId: 'device-5',
			eventName: 'empty-cohort.event',
			subjectCohort: '',
		})

		const events = [
			minimal,
			withNulls,
			withAllFields,
			withNestedProps,
			withEmptyCohort,
		]

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(...events),
		})

		expect(res.status).toBe(202)
		const json = (await res.json()) as { accepted: number }
		expect(json.accepted).toBe(events.length)

		const rows = await pollDb(
			() => sql`SELECT * FROM events ORDER BY id ASC`,
			(r) => r.length >= events.length,
		)
		expect(rows.length).toBe(events.length)

		// Verify minimal event
		expect(rows[0].subject_id).toBe('device-1')
		expect(rows[0].event_name).toBe('minimal.event')
		expect(rows[0].subject_cohort).toBeNull()
		expect(rows[0].dedupe_key).toBeNull()
		expect(rows[0].sequence).toBeNull()
		expect(rows[0].properties).toEqual({})

		// Verify explicit nulls
		expect(rows[1].subject_cohort).toBeNull()
		expect(rows[1].dedupe_key).toBeNull()
		expect(rows[1].sequence).toBeNull()

		// Verify all fields populated
		expect(rows[2].subject_cohort).toBe('beta-testers')
		expect(rows[2].dedupe_key).toBe('dedup-1')
		expect(rows[2].sequence).toBe(42)

		// Verify nested properties stored as JSONB
		expect(rows[3].properties).toEqual({
			str: 'hello',
			num: 123,
			bool: true,
			nullVal: null,
			arr: [1, 'two', false],
			nested: { deep: { value: 99 } },
		})

		// Verify empty cohort
		expect(rows[4].subject_cohort).toBe('')
	})

	it('should handle gzip-compressed requests', async () => {
		const event = makeEvent({ eventName: 'gzip.test' })
		const compressed = await gzipBody(ndjson(event))

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${AUTH_TOKEN}`,
				'Content-Encoding': 'gzip',
			},
			body: compressed,
		})

		expect(res.status).toBe(202)
		const json = (await res.json()) as { accepted: number }
		expect(json.accepted).toBe(1)

		const rows = await pollDb(
			() => sql`SELECT * FROM events WHERE event_name = 'gzip.test'`,
			(r) => r.length >= 1,
		)
		expect(rows.length).toBe(1)
	})

	it('should return 401 for missing auth', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(401)
	})

	it('should return 401 for wrong auth token', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: 'Bearer wrong-token' },
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(401)
	})

	it('should return 404 for wrong path', async () => {
		const res = await SELF.fetch('https://test/wrong', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(404)
	})

	it('should return 404 for non-POST methods', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'GET',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
		})
		expect(res.status).toBe(404)
	})

	it('should return 400 if there are any invalid JSON lines', async () => {
		const validEvent = makeEvent({ eventName: 'valid.event' })
		const body = `${JSON.stringify(validEvent)}\nthis is not json\n`

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body,
		})

		expect(res.status).toBe(400)
		const json = (await res.json()) as { error: string }
		expect(json.error).toBe('Invalid JSON at line 2')
	})

	it('should skip all variants of schema-invalid events in the consumer', async () => {
		const invalidEvents = [
			// Missing subjectId entirely
			{ createdAt: Date.now(), eventName: 'no-subject', properties: {} },
			// Empty subjectId (minLength: 1)
			{
				subjectId: '',
				createdAt: Date.now(),
				eventName: 'empty-subject',
				properties: {},
			},
			// subjectId wrong type
			{
				subjectId: 123,
				createdAt: Date.now(),
				eventName: 'num-subject',
				properties: {},
			},
			// Missing createdAt
			{ subjectId: 'd', eventName: 'no-created-at', properties: {} },
			// createdAt wrong type
			{
				subjectId: 'd',
				createdAt: 'not-a-number',
				eventName: 'str-created-at',
				properties: {},
			},
			// Missing eventName
			{ subjectId: 'd', createdAt: Date.now(), properties: {} },
			// Empty eventName (minLength: 1)
			{ subjectId: 'd', createdAt: Date.now(), eventName: '', properties: {} },
			// eventName wrong type
			{ subjectId: 'd', createdAt: Date.now(), eventName: 42, properties: {} },
			// Missing properties
			{ subjectId: 'd', createdAt: Date.now(), eventName: 'no-props' },
			// properties wrong type (string)
			{
				subjectId: 'd',
				createdAt: Date.now(),
				eventName: 'str-props',
				properties: 'bad',
			},
			// sequence wrong type
			{
				subjectId: 'd',
				createdAt: Date.now(),
				eventName: 'str-seq',
				properties: {},
				sequence: 'one',
			},
			// Completely empty object
			{},
		]

		// Valid sentinel event as last line so we can poll for it
		const sentinel = makeEvent({ eventName: 'sentinel.valid' })

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(...invalidEvents, sentinel),
		})

		expect(res.status).toBe(202)
		const json = (await res.json()) as { accepted: number }
		expect(json.accepted).toBe(invalidEvents.length + 1)

		// Wait for the sentinel to arrive
		const rows = await pollDb(
			() => sql`SELECT * FROM events`,
			(r) => r.some((row) => row.event_name === 'sentinel.valid'),
		)
		// Only the sentinel should be in the DB
		expect(rows.length).toBe(1)
		expect(rows[0].event_name).toBe('sentinel.valid')
	})

	it('should return 400 when all lines are invalid JSON', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: 'not json\nalso not json\n',
		})

		expect(res.status).toBe(400)
	})

	it('should store createdAt as the correct timestamp', async () => {
		const timestamp = 1706745600000 // 2024-02-01T00:00:00.000Z
		const event = makeEvent({
			eventName: 'timestamp.test',
			createdAt: timestamp,
		})

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(event),
		})

		expect(res.status).toBe(202)

		const rows = await pollDb(
			() => sql`SELECT * FROM events WHERE event_name = 'timestamp.test'`,
			(r) => r.length >= 1,
		)
		expect(rows[0].created_at).toEqual(new Date(timestamp))
	})

	it('should insert duplicate dedupeKey events (dedup is query-time)', async () => {
		const event = makeEvent({
			dedupeKey: 'dup-key-1',
			sequence: 1,
			eventName: 'dup.test',
		})

		const res1 = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(event),
		})
		expect(res1.status).toBe(202)

		await pollDb(
			() => sql`SELECT * FROM events WHERE dedupe_key = 'dup-key-1'`,
			(r) => r.length >= 1,
		)

		const res2 = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(event),
		})
		expect(res2.status).toBe(202)

		const rows = await pollDb(
			() => sql`SELECT * FROM events WHERE dedupe_key = 'dup-key-1'`,
			(r) => r.length >= 2,
		)
		expect(rows.length).toBe(2)
	})

	it('should ingest a single event', async () => {
		const event = makeEvent({ eventName: 'single.event' })

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(event),
		})

		expect(res.status).toBe(202)
		const json = (await res.json()) as { accepted: number }
		expect(json.accepted).toBe(1)

		const rows = await pollDb(
			() => sql`SELECT * FROM events WHERE event_name = 'single.event'`,
			(r) => r.length >= 1,
		)
		expect(rows.length).toBe(1)
	})

	it('should return 413 when Content-Length exceeds max body size', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${AUTH_TOKEN}`,
				'Content-Length': String(128 * 1024 + 1),
			},
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(413)
	})

	it('should return 413 when decompressed body exceeds max body size', async () => {
		// Build a body just over 128 KB of valid NDJSON
		const lines: string[] = []
		let totalSize = 0
		while (totalSize < 128 * 1024 + 1) {
			const line = JSON.stringify(makeEvent({ eventName: 'big.event' }))
			lines.push(line)
			totalSize += line.length + 1 // +1 for newline
		}
		const body = lines.join('\n')

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body,
		})
		expect(res.status).toBe(413)
	})

	it('should return 413 when a single line exceeds max line length', async () => {
		// MAX_LINE_LENGTH is 16 * 1024 = 16384 characters
		const longValue = 'x'.repeat(16 * 1024)
		const event = makeEvent({
			eventName: 'long.event',
			properties: { v: longValue },
		})
		const line = JSON.stringify(event)
		expect(line.length).toBeGreaterThan(16 * 1024)

		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: line,
		})
		expect(res.status).toBe(413)
	})

	it('should return 400 for empty body', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
		})
		expect(res.status).toBe(400)
	})

	it('should return 415 for unsupported Content-Encoding', async () => {
		const res = await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${AUTH_TOKEN}`,
				'Content-Encoding': 'br',
			},
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(415)
	})

	it('should return 501 for legacy /metrics endpoint', async () => {
		const res = await SELF.fetch('https://test/metrics', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(makeEvent()),
		})
		expect(res.status).toBe(501)
	})

	it('should set ingested_at on inserted events', async () => {
		const before = new Date()
		const event = makeEvent({ eventName: 'ingested-at.test' })

		await SELF.fetch('https://test/v1', {
			method: 'POST',
			headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			body: ndjson(event),
		})

		const rows = await pollDb(
			() => sql`SELECT * FROM events WHERE event_name = 'ingested-at.test'`,
			(r) => r.length >= 1,
		)
		const after = new Date()

		expect(rows[0].ingested_at.getTime()).toBeGreaterThanOrEqual(
			before.getTime(),
		)
		expect(rows[0].ingested_at.getTime()).toBeLessThanOrEqual(after.getTime())
	})
})
