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

  it('retries signed request once when server reports timestamp skew', async () => {
    const dateSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_710_000_000_000)
      .mockReturnValueOnce(1_710_000_000_250);
    const postSpy = vi.spyOn(__httpForTests, 'post')
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: { message: 'Request timestamp expired due to clock skew' },
          headers: { date: 'Sun, 03 May 2026 08:00:00 GMT' },
        },
        message: 'bad request',
      })
      .mockResolvedValueOnce({ data: [{ ok: true }] });

    const result = await CoinDCXApi.getOpenOrders();

    expect(result).toEqual([{ ok: true }]);
    expect(postSpy).toHaveBeenCalledTimes(2);

    const firstBody = postSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    const secondBody = postSpy.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(firstBody.timestamp).toBe(1_710_000_000_000);
    expect(secondBody.timestamp).toBe(Date.parse('Sun, 03 May 2026 08:00:00 GMT'));

    const secondConfig = postSpy.mock.calls[1]?.[2] as { headers?: RequestHeaders } | undefined;
    const secondHeaders = secondConfig?.headers ?? {};
    expect(secondHeaders['X-AUTH-SIGNATURE']).toBe(canonicalSignature(secondBody));

    dateSpy.mockRestore();
  });

  it('does not retry non-skew failures', async () => {
    const postSpy = vi.spyOn(__httpForTests, 'post').mockRejectedValueOnce({
      response: { status: 500, data: { message: 'internal error' }, headers: {} },
      message: 'internal error',
    });

    await expect(CoinDCXApi.getOpenOrders()).rejects.toThrow(/OpenOrders API \[500\]: internal error/);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
