import { describe, expect, it } from 'vitest';
import {
  assertSocketIoClientVersion,
  SOCKET_IO_CLIENT_REQUIRED_VERSION,
} from '../../src/gateways/socketio-version-guard';

describe('socket.io version guard', () => {
  it('accepts exact required version', () => {
    expect(() =>
      assertSocketIoClientVersion(SOCKET_IO_CLIENT_REQUIRED_VERSION),
    ).not.toThrow();
  });

  it('rejects semver range prefixes', () => {
    expect(() =>
      assertSocketIoClientVersion(`^${SOCKET_IO_CLIENT_REQUIRED_VERSION}`),
    ).toThrow(
      /requires socket\.io-client@2\.4\.0, but detected \^2\.4\.0/i,
    );
  });

  it('rejects missing version', () => {
    expect(() => assertSocketIoClientVersion('')).toThrow(
      /requires socket\.io-client@2\.4\.0, but detected unknown/i,
    );
  });

  it('rejects other concrete versions', () => {
    expect(() => assertSocketIoClientVersion('4.7.5')).toThrow(
      /requires socket\.io-client@2\.4\.0, but detected 4\.7\.5/i,
    );
  });
});
