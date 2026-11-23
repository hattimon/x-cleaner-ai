-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountMode" AS ENUM ('LIVE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('KEEP', 'REVIEW', 'UNFOLLOW_CANDIDATE', 'PROTECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Preference" AS ENUM ('KEEP', 'REVIEW', 'PROTECT', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('scanned', 'partial', 'unavailable', 'rate_limited', 'stale', 'failed');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanPhase" AS ENUM ('FOLLOWING', 'PROFILES');

-- CreateEnum
CREATE TYPE "OperationState" AS ENUM ('PREPARED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNCERTAIN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CleanupDirection" AS ENUM ('UNFOLLOW', 'FOLLOW');

-- CreateTable
CREATE TABLE "LocalUser" (
    "id" TEXT NOT NULL,
    "slot" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostIdentity" (
    "key" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,

    CONSTRAINT "HostIdentity_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OAuthAttempt" (
    "stateHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,
    "receiptHash" TEXT,
    "result" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);

-- CreateTable
CREATE TABLE "ChatConnection" (
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "displayName" TEXT,
    "scopes" TEXT[],
    "encrypted" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "lastUsage" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConnection_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "XAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "AccountMode" NOT NULL,
    "xId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "followingCount" INTEGER,
    "scopes" TEXT[],
    "encrypted" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectionError" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "nextScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "xId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "website" TEXT,
    "openedAt" TIMESTAMP(3),
    "followers" INTEGER,
    "follows" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "following" BOOLEAN NOT NULL DEFAULT true,
    "lastActivity" TIMESTAMP(3),
    "lastPostAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "sampleLimit" INTEGER NOT NULL DEFAULT 0,
    "posts" JSONB NOT NULL DEFAULT '[]',
    "status" "DataStatus" NOT NULL DEFAULT 'unavailable',
    "statusReason" TEXT,
    "decision" "Decision" NOT NULL DEFAULT 'UNKNOWN',
    "assessment" JSONB,
    "activity" TEXT NOT NULL DEFAULT 'unknown',
    "spamScore" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "preference" "Preference",

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "phase" "ScanPhase" NOT NULL DEFAULT 'FOLLOWING',
    "cursor" TEXT,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "forceRefresh" BOOLEAN NOT NULL DEFAULT false,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT,
    "summary" JSONB,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanItem" (
    "scanId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3),
    "evaluation" JSONB,

    CONSTRAINT "ScanItem_pkey" PRIMARY KEY ("scanId","profileId")
);

-- CreateTable
CREATE TABLE "CleanupBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "CleanupDirection" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanupBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupOperation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "state" "OperationState" NOT NULL DEFAULT 'PREPARED',
    "result" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanupOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageDay" (
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "xRequests" INTEGER NOT NULL DEFAULT 0,
    "xMilliUsd" INTEGER NOT NULL DEFAULT 0,
    "aiRequests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDay_pkey" PRIMARY KEY ("accountId","day")
);

-- CreateTable
CREATE TABLE "McpKey" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canPrepare" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalUser_slot_key" ON "LocalUser"("slot");

-- CreateIndex
CREATE UNIQUE INDEX "LocalUser_username_key" ON "LocalUser"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "HostIdentity_hostId_key" ON "HostIdentity"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAttempt_receiptHash_key" ON "OAuthAttempt"("receiptHash");

-- CreateIndex
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");

-- CreateIndex
CREATE INDEX "XAccount_userId_mode_idx" ON "XAccount"("userId", "mode");

-- CreateIndex
CREATE INDEX "XAccount_nextScanAt_idx" ON "XAccount"("nextScanAt");

-- CreateIndex
CREATE UNIQUE INDEX "XAccount_userId_mode_xId_key" ON "XAccount"("userId", "mode", "xId");

-- CreateIndex
CREATE INDEX "Profile_accountId_following_decision_confidence_idx" ON "Profile"("accountId", "following", "decision", "confidence");

-- CreateIndex
CREATE INDEX "Profile_accountId_following_lastActivity_idx" ON "Profile"("accountId", "following", "lastActivity");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_accountId_xId_key" ON "Profile"("accountId", "xId");

-- CreateIndex
CREATE INDEX "ScanJob_state_availableAt_idx" ON "ScanJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "ScanJob_accountId_createdAt_idx" ON "ScanJob"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanItem_scanId_analyzedAt_idx" ON "ScanItem"("scanId", "analyzedAt");

-- CreateIndex
CREATE INDEX "ScanItem_profileId_analyzedAt_idx" ON "ScanItem"("profileId", "analyzedAt");

-- CreateIndex
CREATE INDEX "CleanupBatch_accountId_createdAt_idx" ON "CleanupBatch"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CleanupOperation_profileId_state_idx" ON "CleanupOperation"("profileId", "state");

-- CreateIndex
CREATE INDEX "CleanupOperation_state_updatedAt_idx" ON "CleanupOperation"("state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CleanupOperation_batchId_profileId_key" ON "CleanupOperation"("batchId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "McpKey_tokenHash_key" ON "McpKey"("tokenHash");

-- CreateIndex
CREATE INDEX "McpKey_userId_accountId_idx" ON "McpKey"("userId", "accountId");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_accountId_createdAt_idx" ON "AuditEvent"("userId", "accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConnection" ADD CONSTRAINT "ChatConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XAccount" ADD CONSTRAINT "XAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanItem" ADD CONSTRAINT "ScanItem_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanItem" ADD CONSTRAINT "ScanItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupBatch" ADD CONSTRAINT "CleanupBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupOperation" ADD CONSTRAINT "CleanupOperation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CleanupBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupOperation" ADD CONSTRAINT "CleanupOperation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageDay" ADD CONSTRAINT "UsageDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpKey" ADD CONSTRAINT "McpKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpKey" ADD CONSTRAINT "McpKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "XAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- One unfinished job per account, including paused and rate-limited jobs.
CREATE UNIQUE INDEX "ScanJob_one_active" ON "ScanJob" ("accountId")
WHERE "state" IN ('QUEUED', 'RUNNING', 'WAITING', 'PAUSED');
