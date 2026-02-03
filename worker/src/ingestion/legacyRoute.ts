import { json, type RequestHandler } from "itty-router";

export const postMetricsLegacy: RequestHandler = async (request, env) => {
  // Placeholder implementation for the legacy /metrics endpoint.
  return json(
    { message: "Legacy metrics endpoint is not implemented." },
    { status: 501 },
  );
};
