-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('google', 'email');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('welcomeGrant', 'settle', 'refund', 'topup', 'adjustment');

-- CreateEnum
CREATE TYPE "GatewayJobStatus" AS ENUM ('posted', 'acked', 'delivered', 'claimed', 'cancelled', 'timed_out', 'failed');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('requires_payment', 'processing', 'succeeded', 'credited', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "authProvider" "AuthProvider" NOT NULL,
    "googleSub" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "stripeCustomerId" TEXT,
    "country" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "scopeMaxXbzzPerDay" DECIMAL(78,0),
    "modelAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "balanceXbzzWei" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "reservedXbzzWei" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "LedgerKind" NOT NULL,
    "deltaXbzzWei" DECIMAL(78,0) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "accountId" TEXT NOT NULL,
    "gatewayJobId" TEXT,
    "topupId" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "routingId" TEXT NOT NULL,
    "onChainJobId" TEXT,
    "requestHash" TEXT,
    "responseHash" TEXT,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "estimatedMaxXbzzWei" DECIMAL(78,0) NOT NULL,
    "actualXbzzWei" DECIMAL(78,0),
    "status" "GatewayJobStatus" NOT NULL DEFAULT 'posted',
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "ackDeadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "promptRedacted" TEXT,
    "responseRedacted" TEXT,
    "errorMessage" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GatewayJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'requires_payment',
    "stripePaymentIntent" TEXT NOT NULL,
    "amountUsdCents" INTEGER NOT NULL,
    "creditedXbzzWei" DECIMAL(78,0),
    "usdPerXbzzAtCredit" DECIMAL(18,8),
    "error" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Topup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_verificationToken_key" ON "User"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_authProvider_googleSub_idx" ON "User"("authProvider", "googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_key" ON "ApiKey"("key");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_key" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LedgerEntry_kind_idx" ON "LedgerEntry"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayJob_routingId_key" ON "GatewayJob"("routingId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayJob_onChainJobId_key" ON "GatewayJob"("onChainJobId");

-- CreateIndex
CREATE INDEX "GatewayJob_userId_createdAt_idx" ON "GatewayJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GatewayJob_status_idx" ON "GatewayJob"("status");

-- CreateIndex
CREATE INDEX "GatewayJob_onChainJobId_idx" ON "GatewayJob"("onChainJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Topup_stripePaymentIntent_key" ON "Topup"("stripePaymentIntent");

-- CreateIndex
CREATE INDEX "Topup_userId_createdAt_idx" ON "Topup"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Topup_status_idx" ON "Topup"("status");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_gatewayJobId_fkey" FOREIGN KEY ("gatewayJobId") REFERENCES "GatewayJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "Topup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayJob" ADD CONSTRAINT "GatewayJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topup" ADD CONSTRAINT "Topup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
