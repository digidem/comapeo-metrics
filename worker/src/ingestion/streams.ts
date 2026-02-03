import { JsonValue } from "type-fest";
import {
  InvalidJsonError,
  LineTooLargeError,
  PayloadTooLargeError,
} from "./errors.js";

/**
 * Transforms a stream of Uint8Array chunks into a stream of strings by decoding
 * them as UTF-8.
 */
export function decoderStream() {
  const decoder = new TextDecoder();
  return new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(chunk, { stream: true }));
    },
    flush(controller) {
      // Flush any remaining buffered bytes
      const remaining = decoder.decode();
      if (remaining) {
        controller.enqueue(remaining);
      }
    },
  });
}

/**
 * Splits a stream of strings into lines based on newline characters. Trims each
 * line. Any lines longer than `maxLength` will throw a LineTooLargeError.
 */
export function splitLines({
  maxLength = Infinity,
}: { maxLength?: number } = {}) {
  let buffer = "";
  let lineNumber = 0;
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer
      for (const line of lines) {
        lineNumber++;
        if (line.length > maxLength) {
          controller.error(
            new LineTooLargeError(
              `Line ${lineNumber} exceeds maximum length of ${maxLength}`,
            ),
          );
        }
        const trimmed = line.trim();
        if (trimmed) controller.enqueue(trimmed);
      }
      // Avoid growing buffer indefinitely
      if (buffer.length > maxLength) {
        controller.error(
          new LineTooLargeError(
            `Line ${lineNumber + 1} exceeds maximum length of ${maxLength}`,
          ),
        );
      }
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(buffer.trim());
    },
  });
}

/**
 * Limits the total number of bytes passing through the stream. If the limit is
 * exceeded, a PayloadTooLargeError is thrown.
 */
export function limitStream({
  maxBytes = Infinity,
}: { maxBytes?: number } = {}) {
  let totalBytes = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        controller.error(
          new PayloadTooLargeError(
            `Payload exceeds maximum size of ${maxBytes} bytes`,
          ),
        );
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Parses a stream of strings as JSON. If a line is not valid JSON, an
 * InvalidJsonError is thrown with the line number.
 */
export function parseJsonStream() {
  let lineNumber = 0;
  return new TransformStream<string, JsonValue>({
    async transform(chunk, controller) {
      lineNumber++;
      try {
        const parsed = JSON.parse(chunk) as JsonValue;
        controller.enqueue(parsed);
      } catch (cause) {
        controller.error(
          new InvalidJsonError(`Invalid JSON at line ${lineNumber}`, {
            cause,
          }),
        );
      }
    },
  });
}

/**
 * Batches incoming JSON values into arrays, ensuring that the total stringified
 * size of each batch does not exceed the specified maximum size in bytes. This
 * is important for cloudflare queues, which have a max message size.
 */
export function batchBySize({
  maxBatchSize = Infinity,
}: { maxBatchSize?: number } = {}) {
  let batch: JsonValue[] = [];
  let batchSize = 2; // '[]'

  return new TransformStream<JsonValue, JsonValue[]>({
    async transform(event, controller) {
      const messageSize =
        new TextEncoder().encode(JSON.stringify(event)).length +
        (batch.length > 0 ? 1 : 0); // account for comma

      if (messageSize > maxBatchSize && batch.length > 0) {
        controller.enqueue(batch);
        batch = [event];
        batchSize = 2 + messageSize;
      } else {
        batch.push(event);
        batchSize += messageSize;
      }
    },
    flush(controller) {
      if (batch.length > 0) {
        controller.enqueue(batch);
      }
    },
  });
}
