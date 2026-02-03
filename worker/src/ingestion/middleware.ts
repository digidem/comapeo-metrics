import { StatusError, type IRequest } from "itty-router";
import type { RequestHandler } from "../shared/types.js";
import { MAX_BODY_SIZE_BYTES } from "../shared/constants.js";

/**
 * Compares two strings in a timing-safe manner to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

/**
 * Middleware to check the Authorization header for a Bearer token and validate
 * it against the AUTH_TOKEN in env.
 */
export const checkAuth: RequestHandler = (request, env) => {
  const header = request.headers.get("Authorization");
  if (!header) {
    throw new StatusError(401, "Unauthorized");
  }
  const token = header.replace("Bearer ", "").trim();

  if (!timingSafeEqual(token, env.AUTH_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }
};

/**
 * Middleware to limit the Content-Length of incoming requests.
 */
export const limitContentLength: RequestHandler = (request) => {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE_BYTES) {
    throw new StatusError(413, "Payload too large");
  }
};

export type DecompressedRequest = IRequest & {
  decompressedBody: ReadableStream<any>;
  body: never;
};

/**
 * Middleware to decompress gzip-encoded request bodies. Decorates the request
 * with a `decompressedBody` stream. request.body can no longer be used after
 * this middleware, so its type is changed to `never`.
 */
export const gunzipBody: RequestHandler<DecompressedRequest> = (request) => {
  if (!request.body) {
    throw new StatusError(400, "Empty body");
  }
  const compression = request.headers.get("content-encoding");
  if (compression && compression !== "gzip") {
    throw new StatusError(415, "Unsupported Media Type");
  }
  request.decompressedBody = compression
    ? (request.body as ReadableStream<any>).pipeThrough(
        new DecompressionStream("gzip"),
      )
    : request.body;
};
