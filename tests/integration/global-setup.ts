import { migrateDatabase, waitUntilDatabaseReady } from "@learning/server";
import {
  currentOwnerContext,
  listContainersByPrefix,
  removeContainer,
  selectStaleContainers,
  startPostgresContainer,
} from "../test-containers";
import { INTEGRATION_CONTAINER_PREFIX, readTestRunConfig } from "../test-run-config";

const CONTAINER_PREFIX = readTestRunConfig(process.env).integrationContainerPrefix;

function containerName(): string {
  return `${CONTAINER_PREFIX}${process.pid}`;
}

// Sprząta osierocone kontenery przerwanych przebiegów (dowolnego run ID),
// ale nigdy bazy przebiegu, którego proces wciąż żyje — równoległe
// `pnpm test:integration` z innych sesji i worktree dzielą ten demon Dockera.
async function removeStaleContainers(): Promise<void> {
  const stale = selectStaleContainers(await listContainersByPrefix(INTEGRATION_CONTAINER_PREFIX), currentOwnerContext());
  for (const container of stale) await removeContainer(container.id);
}

interface GlobalSetupContext {
  provide: (key: string, value: unknown) => void;
}

export default async function globalSetup({
  provide,
}: GlobalSetupContext): Promise<(() => Promise<void>) | void> {
  await removeStaleContainers();
  const name = containerName();
  const container = await startPostgresContainer({
    name,
    label: "testów integracyjnych",
    prepare: async (url) => {
      // pg_isready wewnątrz kontenera pyta po unix sockecie i zgłasza gotowość już
      // podczas tymczasowego serwera entrypointa (listen_addresses=''), zanim port
      // TCP hosta zacznie słuchać — wtedy migracja dostaje ECONNRESET. Czekamy na
      // realny handshake po dokładnie tym URL-u, którego używa migracja.
      await waitUntilDatabaseReady(url);
      await migrateDatabase(url, "packages/server/drizzle");
    },
  });
  provide("DATABASE_URL", container.url);
  provide("TEST_CONTAINER", name);
  return async () => {
    await removeContainer(container.id);
  };
}
