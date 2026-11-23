import { PrismaClient } from '@prisma/client';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppError, readConfig } from './config.js';
import { Vault } from './security.js';
import { XAccounts } from './x-accounts.js';
import { Scanner } from './scanner.js';
import { Cleanup } from './cleanup.js';
import { ManualReviewProvider } from './ai-providers.js';
import { makeMcp } from './mcp.js';

const db = new PrismaClient();
try {
  const cfg = readConfig();
  if (!cfg.MCP_ENABLED) throw new AppError(403, 'mcp_off', 'Ustaw MCP_ENABLED=true w Compose.');
  const accounts = new XAccounts(db, cfg, new Vault(cfg.TOKEN_KEY));
  const scanner = new Scanner(db, account => accounts.provider(account), account => accounts.assertScan(account), new ManualReviewProvider());
  const cleanup = new Cleanup(db, false, account => accounts.provider(account));
  const server = await makeMcp(db, scanner, cleanup, process.env.MCP_TOKEN ?? '');
  await server.connect(new StdioServerTransport());
  const finish = async () => { await server.close(); await db.$disconnect(); };
  process.on('SIGTERM', () => void finish());
  process.on('SIGINT', () => void finish());
  process.stdin.once('end', () => void finish());
} catch (failure) {
  console.error(failure instanceof AppError ? failure.message : 'Nie udało się uruchomić lokalnego MCP.');
  await db.$disconnect();
  process.exitCode = 1;
}
