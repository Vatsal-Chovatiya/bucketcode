-- CreateEnum
CREATE TYPE "ReplStatus" AS ENUM ('STARTING', 'RUNNING', 'IDLE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('NODE_JS', 'PYTHON', 'REACT');

-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "repls" (
    "repl_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "s3Path" TEXT NOT NULL,
    "podName" TEXT,
    "serviceName" TEXT,
    "ingressName" TEXT,
    "status" "ReplStatus" NOT NULL DEFAULT 'STARTING',
    "owner_id" TEXT NOT NULL,
    "preview_url" TEXT,
    "runner_addr" TEXT,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repls_pkey" PRIMARY KEY ("repl_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "repls_s3Path_key" ON "repls"("s3Path");

-- CreateIndex
CREATE UNIQUE INDEX "repls_podName_key" ON "repls"("podName");

-- CreateIndex
CREATE UNIQUE INDEX "repls_serviceName_key" ON "repls"("serviceName");

-- CreateIndex
CREATE UNIQUE INDEX "repls_ingressName_key" ON "repls"("ingressName");

-- CreateIndex
CREATE INDEX "repls_owner_id_status_idx" ON "repls"("owner_id", "status");

-- AddForeignKey
ALTER TABLE "repls" ADD CONSTRAINT "repls_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
