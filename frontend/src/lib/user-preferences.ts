/**
 * User preferences — the shape persisted to `users.preferences` (JSON).
 *
 * Stored in JSON so we can extend it without schema migrations.
 * The Zod schema below is the source of truth — UI, API, and DB writes
 * all run through it, which also gives us cheap defaulting for users
 * created before a field existed.
 */

import { z } from "zod";

export type ThemePreference = "dark" | "light" | "system";

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "dark",
  notifications: {
    depositConfirmed:  true,
    withdrawalUpdates: true,
    betSettled:        true,
    marketResolved:    true,
    suggestionReview:  true,
    productUpdates:    false,
  },
};

export const PreferencesSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  notifications: z.object({
    depositConfirmed:  z.boolean().default(true),
    withdrawalUpdates: z.boolean().default(true),
    betSettled:        z.boolean().default(true),
    marketResolved:    z.boolean().default(true),
    suggestionReview:  z.boolean().default(true),
    productUpdates:    z.boolean().default(false),
  }).default({}),
}).default({});

export type UserPreferences = z.infer<typeof PreferencesSchema>;

/** Merge stored JSON with defaults so missing keys are filled in. */
export function parsePreferences(raw: unknown): UserPreferences {
  const result = PreferencesSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_PREFERENCES;
}
