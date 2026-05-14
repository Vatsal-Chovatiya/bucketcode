import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const repl = await prisma.repl.findUnique({ where: { id: 'repl-9z0ubcu' } });
  console.log(repl);
}
main().catch(console.error).finally(() => prisma.$disconnect());
