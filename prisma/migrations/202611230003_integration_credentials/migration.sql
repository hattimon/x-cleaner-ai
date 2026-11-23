CREATE TABLE "IntegrationCredential" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("userId", "provider")
);

ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "LocalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
