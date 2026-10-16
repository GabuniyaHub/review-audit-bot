import 'dotenv/config';
import { createApplication } from './bootstrap.js';
import { readSettings } from './config/settings.js';
async function main() {
  const settings = readSettings();
  const app = await createApplication();
  await app.listen(settings.port, settings.host);
}
void main().catch(() => {
  // Avoid printing DATABASE_URL or connection errors containing credentials.
  console.error('Application startup failed. Check configuration and service logs.');
  process.exitCode = 1;
});
