import type { ErrorBody, ErrorCode } from "@docs-platform/contracts";
import { z } from "zod";

/** An error that maps to the contracts `ErrorBody` envelope. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthenticated = (message = "Authentication required") =>
  new HttpError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "Insufficient permissions") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "CONFLICT", message, details);
export const payloadTooLarge = (message = "Payload too large") =>
  new HttpError(413, "PAYLOAD_TOO_LARGE", message);
export const rateLimited = (message = "Too many requests") => new HttpError(429, "RATE_LIMITED", message);
export const upstreamUnavailable = (message = "Upstream unavailable") =>
  new HttpError(503, "UPSTREAM_UNAVAILABLE", message);
export const notImplemented = () => new HttpError(501, "INTERNAL", "not implemented");

/** Details contain paths and messages only, never the rejected input values. */
export function validationFailed(error: z.ZodError, where: "body" | "params" | "query" = "body") {
  return new HttpError(400, "VALIDATION_FAILED", `Invalid request ${where}`, {
    in: where,
    summary: z.prettifyError(error),
    issues: error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
  });
}

export function errorBody(code: ErrorCode, message: string, requestId: string, details?: unknown): ErrorBody {
  return {
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  };
}
