import { z } from "zod";

/** Identity asserted by the trusted gateway and mapped from configurable headers. */
export const PlatformIdentitySchema = z.object({
  /** Nonempty; ideally the IdP's immutable subject, not a mutable username. */
  subject: z.string().min(1),
  email: z.string().optional(),
  displayName: z.string().optional(),
  groups: z.array(z.string()),
});

export type PlatformIdentity = z.infer<typeof PlatformIdentitySchema>;
