import type {
  IRequest,
  RequestHandler as IttyRouterRequestHandler,
} from "itty-router";

export type RequestHandler<T = IRequest> = IttyRouterRequestHandler<
  T,
  [Env, ExecutionContext]
>;
