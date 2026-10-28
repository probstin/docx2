import type { Queryable } from "@docs-platform/storage";
import type { ReadinessCheck } from "../ports.js";

/** Database reachability only; a model-endpoint outage must not remove the pod from rotation. */
export const databaseReadiness = (db: Queryable): ReadinessCheck => ({
  name: "database",
  check: async () => {
    await db.query("SELECT 1");
  },
});
