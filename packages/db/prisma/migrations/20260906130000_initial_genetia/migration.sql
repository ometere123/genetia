-- CreateEnum
CREATE TYPE "MarketEngine" AS ENUM ('POOL', 'LMSR');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('PROPOSED', 'ADMISSIBILITY', 'REVISION', 'APPROVED', 'FUNDING', 'ACTIVE', 'CLOSED', 'RESOLVING', 'TERMINAL', 'EXPIRED', 'FUNDING_FAILED');

-- CreateEnum
CREATE TYPE "ResolutionReason" AS ENUM ('EVIDENCE', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "TerminalOutcome" AS ENUM ('YES', 'NO', 'VOID');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "privyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" UUID NOT NULL,
    "marketId" TEXT NOT NULL,
    "engine" "MarketEngine" NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "creatorUserId" UUID,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL,
    "financialReleaseId" TEXT NOT NULL,
    "resolverReleaseId" TEXT NOT NULL,
    "gatewayReleaseId" TEXT NOT NULL,
    "baseChainId" INTEGER NOT NULL DEFAULT 84532,
    "baseAddress" TEXT NOT NULL,
    "collateralAddress" TEXT NOT NULL,
    "deploymentBlock" BIGINT NOT NULL,
    "genlayerChainId" INTEGER NOT NULL DEFAULT 61997,
    "resolverAddress" TEXT NOT NULL,
    "genlayerDeploymentEpoch" TEXT NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "closeTime" TIMESTAMP(3) NOT NULL,
    "resolutionAvailableTime" TIMESTAMP(3) NOT NULL,
    "terminalDeadline" TIMESTAMP(3) NOT NULL,
    "currentResolutionAttempt" INTEGER NOT NULL DEFAULT 0,
    "finalizedResolutionTxId" TEXT,
    "terminalOutcome" "TerminalOutcome",
    "poolYesTotal" DECIMAL(78,0),
    "poolNoTotal" DECIMAL(78,0),
    "lmsrB" DECIMAL(78,0),
    "lmsrFundingTarget" DECIMAL(78,0),
    "indexedExposure" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "proposerUserId" UUID NOT NULL,
    "marketId" UUID,
    "proposalKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "canonicalTerms" JSONB NOT NULL,
    "bondTxHash" TEXT NOT NULL,
    "bondAmount" DECIMAL(78,0) NOT NULL,
    "decision" TEXT,
    "bondDisposition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionAttempt" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "reason" "ResolutionReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "genlayerTxId" TEXT,
    "lifecycle" TEXT NOT NULL,
    "executionStatus" TEXT,
    "candidateOutcome" TEXT,
    "resultCommitment" TEXT,
    "evidenceJson" JSONB,
    "errorClassification" TEXT,
    "retryDueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "ResolutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "sourceIdentity" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedFacts" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "freshnessAt" TIMESTAMP(3),
    "commitment" TEXT NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatcherAttestation" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "watcherId" TEXT NOT NULL,
    "watcherAddress" TEXT NOT NULL,
    "genlayerTxId" TEXT NOT NULL,
    "resultCommitment" TEXT NOT NULL,
    "outcome" "TerminalOutcome" NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatcherAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "chainEventId" UUID NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "shares" DECIMAL(78,0) NOT NULL,
    "notional" DECIMAL(78,0) NOT NULL,
    "fee" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityActivity" (
    "id" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "chainEventId" UUID NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assets" DECIMAL(78,0) NOT NULL,
    "shares" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiquidityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAccounting" (
    "id" UUID NOT NULL,
    "operationKey" TEXT NOT NULL,
    "walletAddress" TEXT,
    "category" TEXT NOT NULL,
    "amountUsdMicros" BIGINT NOT NULL,
    "sponsoredOps" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "CostAccounting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "chainId" INTEGER NOT NULL,
    "deploymentBlock" BIGINT NOT NULL,
    "nextBlock" BIGINT NOT NULL,
    "lastBlockHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("chainId")
);

-- CreateTable
CREATE TABLE "WorkflowState" (
    "idempotencyKey" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "externalId" TEXT,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowState_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_chainId_address_key" ON "Wallet"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Market_marketId_key" ON "Market"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_baseAddress_key" ON "Market"("baseAddress");

-- CreateIndex
CREATE INDEX "Market_status_closeTime_idx" ON "Market"("status", "closeTime");

-- CreateIndex
CREATE INDEX "Market_category_createdAt_idx" ON "Market"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_proposalKey_key" ON "Proposal"("proposalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_bondTxHash_key" ON "Proposal"("bondTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionAttempt_idempotencyKey_key" ON "ResolutionAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionAttempt_genlayerTxId_key" ON "ResolutionAttempt"("genlayerTxId");

-- CreateIndex
CREATE INDEX "ResolutionAttempt_lifecycle_retryDueAt_idx" ON "ResolutionAttempt"("lifecycle", "retryDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionAttempt_marketId_attemptNo_reason_key" ON "ResolutionAttempt"("marketId", "attemptNo", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_marketId_attemptNo_sourceIdentity_url_key" ON "Evidence"("marketId", "attemptNo", "sourceIdentity", "url");

-- CreateIndex
CREATE INDEX "WatcherAttestation_genlayerTxId_resultCommitment_idx" ON "WatcherAttestation"("genlayerTxId", "resultCommitment");

-- CreateIndex
CREATE UNIQUE INDEX "WatcherAttestation_marketId_genlayerTxId_watcherAddress_key" ON "WatcherAttestation"("marketId", "genlayerTxId", "watcherAddress");

-- CreateIndex
CREATE INDEX "ChainEvent_chainId_blockNumber_logIndex_idx" ON "ChainEvent"("chainId", "blockNumber", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_chainId_transactionHash_logIndex_key" ON "ChainEvent"("chainId", "transactionHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_chainEventId_key" ON "Trade"("chainEventId");

-- CreateIndex
CREATE INDEX "Trade_marketId_walletAddress_idx" ON "Trade"("marketId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidityActivity_chainEventId_key" ON "LiquidityActivity"("chainEventId");

-- CreateIndex
CREATE INDEX "LiquidityActivity_marketId_walletAddress_idx" ON "LiquidityActivity"("marketId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "CostAccounting_operationKey_key" ON "CostAccounting"("operationKey");

-- CreateIndex
CREATE INDEX "CostAccounting_walletAddress_occurredAt_idx" ON "CostAccounting"("walletAddress", "occurredAt");

-- CreateIndex
CREATE INDEX "CostAccounting_category_occurredAt_idx" ON "CostAccounting"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "WorkflowState_state_nextRunAt_idx" ON "WorkflowState"("state", "nextRunAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposerUserId_fkey" FOREIGN KEY ("proposerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionAttempt" ADD CONSTRAINT "ResolutionAttempt_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatcherAttestation" ADD CONSTRAINT "WatcherAttestation_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityActivity" ADD CONSTRAINT "LiquidityActivity_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
