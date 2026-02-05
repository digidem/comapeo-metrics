import { error, IttyRouter } from 'itty-router'

import { postEventV1 } from './eventRoute.js'
import { postMetricsLegacy } from './legacyRoute.js'
import { checkAuth, gunzipBody, limitContentLength } from './middleware.js'

process.on('unhandledRejection', (reason: message) => {
	if (
		reason.message?.includes('at Object.transform') &&
		reason.message?.includes('src/ingestion/streams.ts')
	) {
		// Known issue with workerd and vitest that results in unhandled rejection when TransformStream transform errors
	} else if (
		reason.message?.includes('Error: Stream was cancelled') &&
		reason.message?.includes('postgres/cf/polyfills')
	) {
		// Known issue with workerd and vitest that results in unhandled rejection when cancelling streams
	}
	// re-throw other unhandled rejections
	throw reason
})

export const router = IttyRouter()
	.all('*', checkAuth)
	.post('/metrics', limitContentLength, postMetricsLegacy)
	.post('/v1', limitContentLength, gunzipBody, postEventV1)
	.all('*', () => error(404))
