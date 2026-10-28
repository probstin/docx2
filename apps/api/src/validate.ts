import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { validationFailed } from "./errors.js";

function parse<S extends z.ZodType>(
  schema: S,
  data: unknown,
  where: "body" | "params" | "query",
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationFailed(result.error, where);
  return result.data;
}

export const parseBody = <S extends z.ZodType>(request: FastifyRequest, schema: S): z.infer<S> =>
  parse(schema, request.body, "body");
export const parseParams = <S extends z.ZodType>(request: FastifyRequest, schema: S): z.infer<S> =>
  parse(schema, request.params, "params");
export const parseQuery = <S extends z.ZodType>(request: FastifyRequest, schema: S): z.infer<S> =>
  parse(schema, request.query, "query");
