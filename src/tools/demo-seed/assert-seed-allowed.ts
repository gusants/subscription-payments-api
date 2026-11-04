export interface SeedTarget {
  nodeEnv: string;
  databaseUrl: string;
  allowRemote: boolean;
}

const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

const isLocalDatabase = (databaseUrl: string): boolean =>
  LOCAL_HOSTS.includes(new URL(databaseUrl).hostname);

export function assertSeedAllowed({
  nodeEnv,
  databaseUrl,
  allowRemote,
}: SeedTarget): void {
  if (allowRemote) return;
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production; set SEED_ALLOW_REMOTE=true to seed anyway',
    );
  }
  if (!isLocalDatabase(databaseUrl)) {
    const { hostname } = new URL(databaseUrl);
    throw new Error(
      `Refusing to seed demo data into non-local database host "${hostname}"; set SEED_ALLOW_REMOTE=true to seed anyway`,
    );
  }
}
