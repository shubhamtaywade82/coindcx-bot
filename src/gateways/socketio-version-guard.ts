export const REQUIRED_SOCKET_IO_CLIENT_VERSION = '2.4.0';
export const SOCKET_IO_CLIENT_REQUIRED_VERSION = REQUIRED_SOCKET_IO_CLIENT_VERSION;

export function resolveInstalledSocketIoClientVersion(): string {
  try {
    const pkg = require('socket.io-client/package.json') as { version?: string };
    if (!pkg.version) {
      throw new Error('socket.io-client package.json did not expose a version');
    }
    return pkg.version;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to detect installed socket.io-client version: ${message}`);
  }
}

export function assertSupportedSocketIoClientVersion(
  resolveVersion: () => string = resolveInstalledSocketIoClientVersion,
): void {
  const version = resolveVersion();
  if (version !== REQUIRED_SOCKET_IO_CLIENT_VERSION) {
    throw new Error(
      `CoinDCX websocket compatibility requires socket.io-client@${REQUIRED_SOCKET_IO_CLIENT_VERSION}, but detected ${version || 'unknown'}. ` +
      'Run: npm install --save-exact socket.io-client@2.4.0',
    );
  }
}

export function assertSocketIoClientVersion(version = resolveInstalledSocketIoClientVersion()): void {
  assertSupportedSocketIoClientVersion(() => version);
}
