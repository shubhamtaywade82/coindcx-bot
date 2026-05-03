import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config/config';
import { CoinDCXApi, __httpForTests } from '../../src/gateways/coindcx-api';

type RequestHeaders = Record<string, string>;

function canonicalSignature(body: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(body)).toString();
  return crypto
    .createHmac('sha256', config.apiSecret)
    .update(payload)
    .digest('hex');
}

describe('CoinDCXApi auth signing', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signs POST bodies using canonical JSON.stringify output', async () => {
    const postSpy = vi.spyOn(__httpForTests, 'post').mockResolvedValue({ data: [] });
    await CoinDCXApi.getFuturesPositions();

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [, body, requestConfig] = postSpy.mock.calls[0] ?? [];
    const headers = (requestConfig as { headers?: RequestHeaders } | undefined)?.headers ?? {};
    const requestBody = body as Record<string, unknown>;

    const expected = canonicalSignature(requestBody);
    const prettyPrinted = crypto
      .createHmac('sha256', config.apiSecret)
      .update(JSON.stringify(requestBody, null, 2))
      .digest('hex');

    expect(headers['X-AUTH-APIKEY']).toBe(config.apiKey);
    expect(headers['X-AUTH-SIGNATURE']).toBe(expected);
    expect(headers['X-AUTH-SIGNATURE']).not.toBe(prettyPrinted);
  });

  it('applies same canonical signature contract for signed GET requests', async () => {
    const getSpy = vi.spyOn(__httpForTests, 'get').mockResolvedValue({ data: [] });
    await CoinDCXApi.getBalances();

    expect(getSpy).toHaveBeenCalledTimes(1);
    const [, requestConfig] = getSpy.mock.calls[0] ?? [];
    const configArg = requestConfig as
      | { data?: Record<string, unknown>; headers?: RequestHeaders }
      | undefined;
    const requestBody = configArg?.data ?? {};
    const headers = configArg?.headers ?? {};

    expect(requestBody).toMatchObject({ timestamp: 1_710_000_000_000 });
    expect(headers['X-AUTH-SIGNATURE']).toBe(canonicalSignature(requestBody));
  });
});
