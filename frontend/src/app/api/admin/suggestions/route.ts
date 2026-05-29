export const dynamic = "force-dynamic";

/**
 * Admin Review Queue.
 *
 * GET  /api/admin/suggestions               — list (optional ?status=pending|approved|rejected)
 * POST /api/admin/suggestions  body = {action,suggestionId,...}
 *   actions:
 *     approve  — mint a Market row from the suggestion, link back
 *     reject   — mark rejected with optional reason
 *     edit     — admin edits fields before approving (sent as one approve call)
 *
 * Admin gate: verified Privy token + user.isAdmin or ADMIN_WALLET_ADDRESS match.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth, type PrivyAuthUser } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { createMarketOnArc } from "@/lib/arc-factory";

async function requireAdmin(req: NextRequest) {
  const auth = await verifyPrivyAuth(req);
  const user = await createOrGetUserFromPrivyAuth(auth);

  const adminEnv = (process.env.ADMIN_WALLET_ADDRESS ?? "").toLowerCase();
  const linkedLower = auth.linkedWallets.map((a) => a.toLowerCase());
  const matchesAdminEnv =
    !!adminEnv &&
    (linkedLower.includes(adminEnv) ||
      (user.primaryExternalWallet ?? "").toLowerCase() === adminEnv);

  if (!user.isAdmin && !matchesAdminEnv) {
    const err = new Error("Forbidden — admin only");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return { user, auth: auth as PrivyAuthUser };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get("status");

    const suggestions = await prisma.marketSuggestion.findMany({
      where: status && status !== "all" ? { status } : undefined,
      include: {
        user: { select: { id: true, email: true, primaryExternalWallet: true } },
        market: { select: { id: true, status: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    return NextResponse.json({ suggestions });
  } catch (err) {
    return errorResponse(err);
  }
}

const approveSchema = z.object({
  action: z.literal("approve"),
  suggestionId: z.string().min(1),
  // Optional edits before approval
  question: z.string().min(10).max(500).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(["crypto", "politics", "sports", "science", "entertainment", "other"]).optional(),
  expiry: z.string().datetime().optional(),
  criteria: z.string().min(20).max(2000).optional(),
  sources: z.array(z.string().url()).min(1).max(5).optional(),
});

const rejectSchema = z.object({
  action: z.literal("reject"),
  suggestionId: z.string().min(1),
  reason: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdmin(req);
    const body = await req.json();
    const action = (body as { action?: string }).action;

    if (action === "approve") return handleApprove(body, user.id);
    if (action === "reject") return handleReject(body, user.id);

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

async function handleApprove(body: unknown, adminUserId: string) {
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const s = await prisma.marketSuggestion.findUnique({
    where: { id: parsed.data.suggestionId },
  });
  if (!s) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  if (s.status !== "pending") {
    return NextResponse.json({ error: "Suggestion already reviewed" }, { status: 400 });
  }

  // Apply any admin edits inline.
  const finalQuestion    = parsed.data.question    ?? s.question;
  const finalDescription = parsed.data.description ?? s.description;
  const finalCategory    = parsed.data.category    ?? s.category;
  const finalExpiry      = parsed.data.expiry ? new Date(parsed.data.expiry) : s.expiry;
  const finalCriteria    = parsed.data.criteria    ?? s.criteria;
  const finalSources     = parsed.data.sources     ?? (s.sources as string[]);

  // Step 1 — create Market + flip suggestion to approved (atomic, DB-only).
  const result = await prisma.$transaction(async (tx) => {
    const market = await tx.market.create({
      data: {
        title: finalQuestion,
        description: finalDescription ?? "",
        category: finalCategory,
        expiry: finalExpiry,
        status: "active",
        resolutionCriteria: finalCriteria,
        resolutionSource: JSON.stringify(finalSources),
        createdBy: adminUserId,
      },
    });
    const updatedSuggestion = await tx.marketSuggestion.update({
      where: { id: s.id },
      data: {
        status: "approved",
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        marketId: market.id,
        // Persist admin edits back to the suggestion record for audit.
        question: finalQuestion,
        description: finalDescription,
        category: finalCategory,
        expiry: finalExpiry,
        criteria: finalCriteria,
        sources: finalSources,
      },
    });
    return { market, suggestion: updatedSuggestion };
  });

  // Step 2 — best-effort Arc mirror. Failure does not roll back the DB
  // approval; we just leave `arcAddress` null and surface the error so
  // the admin can retry later if needed.
  const arc = await createMarketOnArc({
    question: finalQuestion,
    category: finalCategory,
    expiry: finalExpiry,
    // bMicros default = 100 USDC seed; override here if you want to size
    // liquidity per category later.
  });
  if (arc.arcAddress) {
    await prisma.market.update({
      where: { id: result.market.id },
      data: {
        arcAddress: arc.arcAddress,
        marketIdOnChain: arc.marketIdOnChain ?? undefined,
        lmsrB: arc.b ? new (await import("@/lib/decimal")).Decimal(arc.b).div(1_000_000) : undefined,
        lmsrStatus: "Active",
      },
    });
    result.market.arcAddress = arc.arcAddress;
  }

  return NextResponse.json({
    ...result,
    arc: {
      address: arc.arcAddress,
      txHash: arc.arcTxHash,
      marketIdOnChain: arc.marketIdOnChain,
      error: arc.error ?? null,
    },
  });
}

async function handleReject(body: unknown, adminUserId: string) {
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const s = await prisma.marketSuggestion.findUnique({
    where: { id: parsed.data.suggestionId },
  });
  if (!s) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  if (s.status !== "pending") {
    return NextResponse.json({ error: "Suggestion already reviewed" }, { status: 400 });
  }

  const updated = await prisma.marketSuggestion.update({
    where: { id: s.id },
    data: {
      status: "rejected",
      rejectionReason: parsed.data.reason ?? null,
      reviewedBy: adminUserId,
      reviewedAt: new Date(),
    },
  });
  return NextResponse.json({ suggestion: updated });
}

function errorResponse(err: unknown) {
  const e = err as Error & { status?: number };
  const msg = e?.message ?? "Internal server error";
  const lower = msg.toLowerCase();
  const status =
    e?.status ??
    (lower.includes("forbidden") ? 403
     : lower.includes("privy") || msg.includes("Authorization") ? 401
     : 500);
  if (status === 500) console.error("[admin/suggestions]", err);
  return NextResponse.json({ error: msg }, { status });
}
