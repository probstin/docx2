import { isAdmin, type IdentityResolver } from "@docs-platform/auth";
import type { PlatformIdentity } from "@docs-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthenticated } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Identity from the trusted gateway headers; null when absent or ambiguous. */
    identity: PlatformIdentity | null;
  }
  interface FastifyContextConfig {
    /**
     * Opt-out of the default "identity required" rule for `/api/v1/*` routes.
     * `"webhook"` routes authenticate by provider signature instead.
     */
    auth?: "webhook";
  }
}

export type RequestHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export async function requireIdentity(request: FastifyRequest): Promise<void> {
  if (!request.identity) throw unauthenticated();
}

export function createRequireAdmin(adminGroups: readonly string[]): RequestHook {
  return async (request) => {
    if (!request.identity) throw unauthenticated();
    if (!isAdmin(request.identity, adminGroups)) throw forbidden();
  };
}

export type { IdentityResolver };
