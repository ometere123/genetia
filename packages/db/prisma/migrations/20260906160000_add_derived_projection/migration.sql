CREATE TABLE "DerivedProjection" (
    "projectionKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "marketId" TEXT,
    "walletAddress" TEXT,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DerivedProjection_pkey" PRIMARY KEY ("projectionKey")
);
CREATE INDEX "DerivedProjection_kind_marketId_idx" ON "DerivedProjection"("kind", "marketId");
CREATE INDEX "DerivedProjection_walletAddress_kind_idx" ON "DerivedProjection"("walletAddress", "kind");
