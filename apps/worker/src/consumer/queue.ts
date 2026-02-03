import postgres from 'postgres'
import * as v from 'valibot'

import { EventSchema, type MetricEvent } from '../shared/schema.js'

type MetricEventWithDate = Omit<MetricEvent, 'createdAt'> & {
	createdAt: Date
}
const safeParseEvent = v.safeParser(EventSchema)

export async function processMetricsEvents(
	batch: MessageBatch,
	env: Env,
): Promise<void> {
	const events: MetricEventWithDate[] = []

	for (const msg of batch.messages) {
		if (!Array.isArray(msg.body)) {
			console.error({
				level: 'error',
				message: 'Invalid message body: expected array of events',
				queue: batch.queue,
				messageId: msg.id,
				body: msg.body,
			})
			continue
		}
		for (const rawEvent of msg.body) {
			const result = safeParseEvent(rawEvent)
			if (result.success) {
				events.push({
					...result.output,
					createdAt: new Date(result.output.createdAt),
				})
			} else {
				console.error({
					level: 'error',
					message: 'Invalid event: message ignored',
					queue: batch.queue,
					messageId: msg.id,
					issues: new v.ValiError(result.issues).message,
				})
			}
		}
	}

	const sql = postgres(env.HYPERDRIVE.connectionString, {
		transform: postgres.camel,
	})
	await sql`INSERT INTO events ${sql(events)}`
	await sql.end()
}
