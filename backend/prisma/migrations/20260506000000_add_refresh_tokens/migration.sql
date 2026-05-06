ALTER TABLE "User" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);
