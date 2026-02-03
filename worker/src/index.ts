import { error } from "itty-router";
import { router } from "./ingestion/router.js";
import { processMetricsEvents } from "./consumer/queue.js";
import { processDlq } from "./consumer/dlq.js";
import * as Sentry from "@sentry/cloudflare";

export default Sentry.withSentry((env: Env) => {
  const { id: versionId } = env.CF_VERSION_METADATA;
  return {
    dsn: "https://02f99072f6bf87d7da73db2278cf502b@o4507148235702272.ingest.us.sentry.io/4510822515408896",
    release: versionId,
    sendDefaultPii: false,
  };
}, {
  fetch: (request, ...args) => router.fetch(request, ...args).catch(error),
  queue: async (batch, env) => {
    switch (batch.queue) {
      case "metrics-events": {
        await processMetricsEvents(batch, env);
        break;
      }
      case "metrics-events-dlq": {
        processDlq(batch);
        break;
      }
      default: {
        console.error({
          level: "error",
          message: "Received message from unknown queue",
          queue: batch.queue,
        });
      }
    }
  },
} satisfies ExportedHandler<Env>)
