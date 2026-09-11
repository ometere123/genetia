ALTER TABLE "genetia_app"."Proposal"
  ADD COLUMN "proposalId" TEXT,
  ADD COLUMN "bondBlockNumber" BIGINT,
  ADD COLUMN "bondLogIndex" INTEGER,
  ADD COLUMN "canonicalProposalHash" TEXT,
  ADD COLUMN "bondStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "admissibilityOperationId" TEXT,
  ADD COLUMN "genlayerTxId" TEXT,
  ADD COLUMN "genlayerStatus" TEXT,
  ADD COLUMN "decisionIssueCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "manifestHash" TEXT,
  ADD COLUMN "resolverAddress" TEXT,
  ADD COLUMN "baseMarketAddress" TEXT,
  ADD COLUMN "workflowStatus" TEXT NOT NULL DEFAULT 'PENDING_BOND';

CREATE UNIQUE INDEX "Proposal_proposalId_key" ON "genetia_app"."Proposal"("proposalId");
CREATE UNIQUE INDEX "Proposal_genlayerTxId_key" ON "genetia_app"."Proposal"("genlayerTxId");
