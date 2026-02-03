import {
  batchBySize,
  decoderStream,
  limitStream,
  parseJsonStream,
  splitLines,
} from "./streams.js";
import {
  MAX_BODY_SIZE_BYTES,
  MAX_LINE_LENGTH,
  QUEUE_MAX_MESSAGE_SIZE,
  QUEUE_MESSAGE_OVERHEAD_BYTES,
} from "../shared/constants.js";
import type { RequestHandler } from "../shared/types.js";
import { StatusError, json, type IRequest } from "itty-router";
import type { DecompressedRequest } from "./middleware.js";

// A Cloudflare queue message is limited to 128kb. It's a little vague because
// you can queue any object which can be serialized with the structured clone
// algorithm, so we add an overhead for any difference between our estimate and
// the actual size seen by cloudflare.
const MAX_BATCH_SIZE = QUEUE_MAX_MESSAGE_SIZE - QUEUE_MESSAGE_OVERHEAD_BYTES;

export const postEventV1: RequestHandler<DecompressedRequest> = async (
  request,
  env,
) => {
  const eventBatches = request.decompressedBody
    .pipeThrough(limitStream({ maxBytes: MAX_BODY_SIZE_BYTES }))
    .pipeThrough(decoderStream())
    .pipeThrough(splitLines({ maxLength: MAX_LINE_LENGTH }))
    .pipeThrough(parseJsonStream())
    .pipeThrough(batchBySize({ maxBatchSize: MAX_BATCH_SIZE }));

  let eventCount = 0;
  for await (const events of eventBatches) {
    await env.METRICS_QUEUE.send(events);
    eventCount += events.length;
  }
  return json({ accepted: eventCount }, { status: 202 });
};
