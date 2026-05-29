export const dynamic = "force-dynamic";

/**
 * GET   /api/me/preferences — fetch the authed user's preferences (defaults fill missing fields).
 * PATCH /api/me/preferences — partial update; merges with current values.
 *
 * Identity from verified Privy Bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { parsePreferences, PreferencesSchema } from "@/lib/user-preferences";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    });
    return NextResponse.json({ preferences: parsePreferences(row?.preferences) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);

    const body = await req.json();
    const existingRow = await prisma.user.findUnique({
      where: { id: user.id },
      select: { preferences: true },
    });
    const existing = parsePreferences(existingRow?.preferences);

    // Deep-merge — notifications is the only nested object.
    const incomingNotif = body?.notifications ?? {};
    const merged = {
      theme: body?.theme ?? existing.theme,
      notifications: { ...existing.notifications, ...incomingNotif },
    };

    const parsed = PreferencesSchema.safeParse(merged);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid preferences", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { preferences: parsed.data },
    });

    return NextResponse.json({ preferences: parsed.data });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : "Internal server error";
  const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
  if (status === 500) console.error("[me/preferences]", err);
  return NextResponse.json({ error: msg }, { status });
}
