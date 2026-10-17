import { createHttpServer } from './app.ts';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3001;

const { server, services } = createHttpServer();

server.listen(PORT, HOST, () => {
  console.log(`LedgerDesk local server listening at http://${HOST}:${PORT}`);
  console.log(`SQLite database location: ${services.dbManager.dbPath}`);
});

function gracefulShutdown(signal: string): void {
  console.log(`Received ${signal}. Closing LedgerDesk server and SQLite database cleanly...`);
  server.close(() => {
    services.dbManager.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
