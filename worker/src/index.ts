import { error } from "itty-router";
import { router } from "./ingestion/router.js";
import { processMetricsEvents } from "./consumer/queue.js";
import { processDlq } from "./consumer/dql.js";

export default {
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
} satisfies ExportedHandler<Env>;
