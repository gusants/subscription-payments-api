type Shutdown = () => Promise<void>;

let registeredShutdown: Shutdown | undefined;

export function onTracingShutdown(shutdown: Shutdown): void {
  registeredShutdown = shutdown;
}

export async function shutdownTracing(): Promise<void> {
  const shutdown = registeredShutdown;
  registeredShutdown = undefined;
  await shutdown?.();
}
