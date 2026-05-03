import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config/config';
import { applyReadOnlyGuard } from '../safety/read-only-guard';
import { resolveFuturesPath } from './futures-endpoint-resolver';

const http: AxiosInstance = axios.create({ baseURL: config.apiBaseUrl, timeout: 10_000 });
const publicHttp: AxiosInstance = axios.create({ baseURL: config.publicBaseUrl, timeout: 10_000 });

applyReadOnlyGuard(http, {
  onViolation: ({ method, path }) => {
    // eslint-disable-next-line no-console
    console.error(`[ReadOnlyGuard] blocked ${method} ${path}`);
  },
});
applyReadOnlyGuard(publicHttp, {
  onViolation: ({ method, path }) => {
    // eslint-disable-next-line no-console
    console.error(`[ReadOnlyGuard] blocked ${method} ${path}`);
  },
});

export const __httpForTests = http;
export const __publicHttpForTests = publicHttp;

export class CoinDCXApi {
  private static futuresPath(
    endpointKey: string,
    fallbackPath: string,
    requireCaptured = false,
  ): string {
    return resolveFuturesPath(endpointKey, fallbackPath, { requireCaptured });
  }

  private static readonly clockSkewRetryStatuses = new Set([400, 401, 403]);

  private static sign(payload: string): string {
    return crypto
      .createHmac('sha256', config.apiSecret)
      .update(payload)
      .digest('hex');
  }

  private static get authHeaders() {
    return {
      'Content-Type': 'application/json',
    };
  }

  private static buildSignedRequest(body: Record<string, any>) {
    const payload = Buffer.from(JSON.stringify(body)).toString();
    const signature = this.sign(payload);
    return {
      body,
      headers: {
        ...this.authHeaders,
        'X-AUTH-APIKEY': config.apiKey,
        'X-AUTH-SIGNATURE': signature,
      },
    };
  }

  private static isClockSkewError(error: any): boolean {
    const status = error?.response?.status;
    if (!this.clockSkewRetryStatuses.has(status)) return false;
    const message = String(error?.response?.data?.message ?? error?.message ?? '');
    return /(timestamp|clock|ahead|behind|expired|nonce|recvwindow)/i.test(message);
  }

  private static async fetchServerTimestamp(): Promise<number> {
    const response = await axios.get(`${config.apiBaseUrl}/exchange/v1/markets`, { timeout: 5_000 });
    const serverMs = this.parseDateHeader(response.headers);
    if (serverMs === undefined) throw new Error('Clock-sync failed: missing or invalid Date header');
    return serverMs;
  }

  private static parseDateHeader(headers: unknown): number | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const raw =
      (headers as Record<string, unknown>)['date'] ??
      (headers as Record<string, unknown>)['Date'];
    if (typeof raw !== 'string') return undefined;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private static readServerTimestampFromError(error: any): number | undefined {
    return this.parseDateHeader(error?.response?.headers);
  }

  private static formatApiError(endpoint: string, error: any): Error {
    const status = error?.response?.status;
    const msg = error?.response?.data?.message || error?.message;
    return new Error(`${endpoint} API [${status || 'timeout'}]: ${msg}`);
  }

  private static normalizePage(page?: number): number {
    return Math.max(1, Math.trunc(page ?? 1));
  }

  private static normalizeLimit(limit?: number, fallback = 100): number {
    return Math.max(1, Math.trunc(limit ?? fallback));
  }

  private static normalizeCandlestickLimit(limit?: number, fallback = 300): number {
    const normalized = this.normalizeLimit(limit, fallback);
    return Math.min(1000, normalized);
  }

  private static async withClockSkewRetry<T>(
    endpoint: string,
    bodyBuilder: (timestamp: number) => Record<string, any>,
    execute: (req: { body: Record<string, any>; headers: Record<string, string> }) => Promise<T>,
  ): Promise<T> {
    const firstRequest = this.buildSignedRequest(bodyBuilder(Date.now()));
    try {
      return await execute(firstRequest);
    } catch (error: any) {
      if (!this.isClockSkewError(error)) {
        throw this.formatApiError(endpoint, error);
      }
      try {
        const serverTimestamp =
          this.readServerTimestampFromError(error) ?? await this.fetchServerTimestamp();
        const retryRequest = this.buildSignedRequest(bodyBuilder(serverTimestamp));
        return await execute(retryRequest);
      } catch (retryError: any) {
        throw this.formatApiError(endpoint, retryError);
      }
    }
  }

  static async getBalances() {
    return this.withClockSkewRetry(
      'Balances',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post(
          this.futuresPath('wallet_details', '/exchange/v1/derivatives/futures/wallets'),
          body,
          { headers },
        );
        return response.data;
      },
    );
  }

  static async getUserBalances() {
    return this.withClockSkewRetry(
      'UserBalances',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/users/balances', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotBalances() {
    return this.getUserBalances();
  }

  static async getUserInfo() {
    return this.withClockSkewRetry(
      'UserInfo',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/users/info', body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesPositions() {
    return this.withClockSkewRetry(
      'Positions',
      (timestamp) => ({
        timestamp,
        page: '1',
        size: '100',
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('list_positions', '/exchange/v1/derivatives/futures/positions');
        const response = await http.post(
          path,
          body,
          { headers },
        );
        return response.data;
      },
    );
  }

  static async getOpenOrders() {
    return this.withClockSkewRetry(
      'OpenOrders',
      (timestamp) => ({
        timestamp,
        status: 'open',
        page: '1',
        size: '100',
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('list_orders', '/exchange/v1/derivatives/futures/orders');
        const response = await http.post(
          path,
          body,
          { headers },
        );
        return response.data;
      },
    );
  }

  static async getSpotOrderStatus(idOrClientOrderId: string) {
    return this.withClockSkewRetry(
      'SpotOrderStatus',
      (timestamp) => ({ timestamp, id: idOrClientOrderId }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status', body, { headers });
        return response.data;
      },
    );
  }

  static async getOrderStatus(opts: { id?: string; clientOrderId?: string }) {
    const id = opts.id?.trim();
    const clientOrderId = opts.clientOrderId?.trim();
    if (!id && !clientOrderId) {
      throw new Error('getOrderStatus requires id or clientOrderId');
    }
    return this.withClockSkewRetry(
      'OrderStatus',
      (timestamp) => ({
        timestamp,
        ...(id ? { id } : {}),
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotOrderStatusMultiple(ids: string[]) {
    return this.withClockSkewRetry(
      'SpotOrderStatusMultiple',
      (timestamp) => ({ timestamp, id: ids }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status_multiple', body, { headers });
        return response.data;
      },
    );
  }

  static async getOrderStatusMultiple(ids: string[]) {
    return this.withClockSkewRetry(
      'OrderStatusMultiple',
      (timestamp) => ({ timestamp, id: ids }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/status_multiple', body, { headers });
        return response.data;
      },
    );
  }

  static async getSpotActiveOrders(market: string) {
    return this.withClockSkewRetry(
      'SpotActiveOrders',
      (timestamp) => ({ timestamp, market }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/active_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getActiveOrders(market: string) {
    return this.getSpotActiveOrders(market);
  }

  static async getSpotActiveOrdersCount() {
    return this.withClockSkewRetry(
      'SpotActiveOrdersCount',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/active_orders_count', body, { headers });
        return response.data;
      },
    );
  }

  static async getActiveOrdersCount() {
    return this.getSpotActiveOrdersCount();
  }

  static async getSpotTradeHistory(opts: { market?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    const limit = Math.max(1, Math.trunc(opts.limit ?? 100));
    const market = opts.market?.trim();
    return this.withClockSkewRetry(
      'SpotTradeHistory',
      (timestamp) => ({
        timestamp,
        page,
        limit,
        ...(market ? { market } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/orders/trade_history', body, { headers });
        return response.data;
      },
    );
  }

  static async getMarginOrders(opts: { market?: string; id?: string } = {}) {
    return this.withClockSkewRetry(
      'MarginFetchOrders',
      (timestamp) => ({
        timestamp,
        ...(opts.market ? { market: opts.market } : {}),
        ...(opts.id ? { id: opts.id } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/margin/fetch_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getMarginOrderStatus(opts: { id?: string; clientOrderId?: string } = {}) {
    const id = opts.id?.trim();
    const clientOrderId = opts.clientOrderId?.trim();
    if (!id && !clientOrderId) {
      throw new Error('getMarginOrderStatus requires id or clientOrderId');
    }
    return this.withClockSkewRetry(
      'MarginOrderStatus',
      (timestamp) => ({
        timestamp,
        ...(id ? { id } : {}),
        ...(clientOrderId ? { client_order_id: clientOrderId } : {}),
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/margin/order', body, { headers });
        return response.data;
      },
    );
  }

  static async getFundingOrders(opts: { page?: number; limit?: number } = {}) {
    return this.withClockSkewRetry(
      'FundingFetchOrders',
      (timestamp) => ({
        timestamp,
        page: opts.page ?? 1,
        limit: opts.limit ?? 100,
      }),
      async ({ body, headers }) => {
        const response = await http.post('/exchange/v1/funding/fetch_orders', body, { headers });
        return response.data;
      },
    );
  }

  static async getLendOrders(opts: { page?: number; limit?: number } = {}) {
    return this.getFundingOrders(opts);
  }

  static async getFuturesTradeHistory(opts: { fromTimestamp?: number; size?: number } = {}) {
    return this.withClockSkewRetry(
      'TradeHistory',
      (timestamp) => ({
        timestamp,
        from_timestamp: opts.fromTimestamp ?? 0,
        size: String(opts.size ?? 100),
        margin_currency_short_name: ['USDT', 'INR'],
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('get_trades', '/exchange/v1/derivatives/futures/trades');
        const response = await http.post(
          path,
          body,
          { headers },
        );
        return response.data;
      },
    );
  }

  static async getFuturesActiveInstruments() {
    return this.fetchApiGet(
      'futures active instruments',
      this.futuresPath('get_active_instruments', '/exchange/v1/derivatives/futures/data/active_instruments'),
    );
  }

  static async getFuturesInstrumentDetails(instrument?: string) {
    const value = instrument?.trim();
    return this.fetchApiGet(
      'futures instrument details',
      this.futuresPath('get_instrument_details', '/exchange/v1/derivatives/futures/data/instrument'),
      value ? { instrument: value } : undefined,
    );
  }

  static async getFuturesInstrumentTradeHistory(instrument: string, limit = 100) {
    const value = instrument.trim();
    if (!value) throw new Error('getFuturesInstrumentTradeHistory requires instrument');
    return this.fetchApiGet(
      'futures instrument trade history',
      this.futuresPath('get_instrument_trade_history', '/exchange/v1/derivatives/futures/data/trades'),
      { instrument: value, limit: this.normalizeLimit(limit) },
    );
  }

  static async getFuturesInstrumentOrderBook(instrument: string) {
    const value = instrument.trim();
    if (!value) throw new Error('getFuturesInstrumentOrderBook requires instrument');
    const pathTemplate = this.futuresPath(
      'get_instrument_orderbook',
      '/market_data/v3/orderbook/{instrument}-futures/50',
    );
    const path = pathTemplate.replace('{instrument}', encodeURIComponent(value));
    return this.fetchPublic(
      'futures instrument orderbook',
      path,
    );
  }

  static async getFuturesInstrumentCandles(
    instrument: string,
    opts: { resolution?: string; from?: number; to?: number; limit?: number } = {},
  ) {
    const value = instrument.trim();
    if (!value) throw new Error('getFuturesInstrumentCandles requires instrument');
    const resolution = opts.resolution ?? '1';
    const to = Math.trunc(opts.to ?? Date.now() / 1000);
    const stepSeconds = resolution === '1D' ? 86_400 : Math.max(1, Number(resolution)) * 60;
    const limit = this.normalizeCandlestickLimit(opts.limit ?? 300);
    const from = Math.trunc(opts.from ?? to - stepSeconds * limit);
    return this.fetchPublic(
      'futures instrument candles',
      this.futuresPath('get_instrument_candlesticks', '/market_data/candlesticks'),
      { pair: value, resolution, from, to, pcode: 'f' },
    );
  }

  static async getFuturesPositionByIdOrPair(opts: { positionId?: string; pair?: string }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    if (!positionId && !pair) {
      throw new Error('getFuturesPositionByIdOrPair requires positionId or pair');
    }
    return this.withClockSkewRetry(
      'FuturesPositionDetails',
      (timestamp) => ({
        timestamp,
        ...(positionId ? { position_id: positionId, position_ids: [positionId] } : {}),
        ...(pair ? { pair, pairs: [pair] } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'get_positions_by_pair_or_position_id',
          '/exchange/v1/derivatives/futures/positions',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesTransactions(opts: { page?: number; limit?: number } = {}) {
    return this.withClockSkewRetry(
      'FuturesTransactions',
      (timestamp) => ({
        timestamp,
        page: this.normalizePage(opts.page),
        limit: this.normalizeLimit(opts.limit),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('get_transactions', '/exchange/v1/derivatives/futures/positions/transactions');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesCurrentPrices() {
    return this.fetchPublic(
      'futures current prices',
      this.futuresPath('get_current_prices_rt', '/market_data/v3/current_prices/futures/rt'),
    );
  }

  static async getFuturesPairStats(pair?: string) {
    const value = pair?.trim();
    return this.withClockSkewRetry(
      'FuturesPairStats',
      (timestamp) => ({
        timestamp,
        ...(value ? { pair: value } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('get_pair_stats', '/api/v1/derivatives/futures/data/stats');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesCrossMarginDetails() {
    return this.withClockSkewRetry(
      'FuturesCrossMarginDetails',
      (timestamp) => ({ timestamp }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'get_cross_margin_details',
          '/exchange/v1/derivatives/futures/positions/cross_margin_details',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesWalletTransactions(opts: { page?: number; limit?: number } = {}) {
    return this.withClockSkewRetry(
      'FuturesWalletTransactions',
      (timestamp) => ({
        timestamp,
        page: this.normalizePage(opts.page),
        limit: this.normalizeLimit(opts.limit),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'wallet_transactions',
          '/exchange/v1/derivatives/futures/wallets/transactions',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async createFuturesOrder(order: Record<string, unknown>) {
    return this.withClockSkewRetry(
      'FuturesCreateOrder',
      (timestamp) => ({ timestamp, ...order }),
      async ({ body, headers }) => {
        const path = this.futuresPath('create_order', '/exchange/v1/derivatives/futures/orders/create');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async cancelFuturesOrder(orderId: string) {
    const id = orderId.trim();
    if (!id) {
      throw new Error('cancelFuturesOrder requires orderId');
    }
    return this.withClockSkewRetry(
      'FuturesCancelOrder',
      (timestamp) => ({ timestamp, id }),
      async ({ body, headers }) => {
        const path = this.futuresPath('cancel_order', '/exchange/v1/derivatives/futures/orders/cancel');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async editFuturesOrder(order: Record<string, unknown>) {
    return this.withClockSkewRetry(
      'FuturesEditOrder',
      (timestamp) => ({ timestamp, ...order }),
      async ({ body, headers }) => {
        const path = this.futuresPath('edit_order', '/exchange/v1/derivatives/futures/orders/edit');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async addFuturesMargin(opts: { positionId?: string; pair?: string; amount: number }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    const amount = Number(opts.amount);
    if (!positionId && !pair) {
      throw new Error('addFuturesMargin requires positionId or pair');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('addFuturesMargin requires amount > 0');
    }
    return this.withClockSkewRetry(
      'FuturesAddMargin',
      (timestamp) => ({
        timestamp,
        amount,
        ...(positionId ? { position_id: positionId } : {}),
        ...(pair ? { pair } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('add_margin', '/exchange/v1/derivatives/futures/positions/add_margin');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async removeFuturesMargin(opts: { positionId?: string; pair?: string; amount: number }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    const amount = Number(opts.amount);
    if (!positionId && !pair) {
      throw new Error('removeFuturesMargin requires positionId or pair');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('removeFuturesMargin requires amount > 0');
    }
    return this.withClockSkewRetry(
      'FuturesRemoveMargin',
      (timestamp) => ({
        timestamp,
        amount,
        ...(positionId ? { position_id: positionId } : {}),
        ...(pair ? { pair } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('remove_margin', '/exchange/v1/derivatives/futures/positions/remove_margin');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async cancelAllFuturesOpenOrders(pair?: string) {
    const value = pair?.trim();
    return this.withClockSkewRetry(
      'FuturesCancelAllOpenOrders',
      (timestamp) => ({
        timestamp,
        ...(value ? { pair: value } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'cancel_all_open_orders',
          '/exchange/v1/derivatives/futures/positions/cancel_all_open_orders',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async cancelAllFuturesOpenOrdersForPosition(opts: { positionId?: string; pair?: string }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    if (!positionId && !pair) {
      throw new Error('cancelAllFuturesOpenOrdersForPosition requires positionId or pair');
    }
    return this.withClockSkewRetry(
      'FuturesCancelAllOpenOrdersForPosition',
      (timestamp) => ({
        timestamp,
        ...(positionId ? { position_id: positionId } : {}),
        ...(pair ? { pair } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'cancel_all_open_orders_for_position',
          '/exchange/v1/derivatives/futures/positions/cancel_all_open_orders_for_position',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async exitFuturesPosition(opts: { positionId?: string; pair?: string; quantity?: number }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    const quantity = opts.quantity;
    if (!positionId && !pair) {
      throw new Error('exitFuturesPosition requires positionId or pair');
    }
    if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) {
      throw new Error('exitFuturesPosition quantity must be > 0 when provided');
    }
    return this.withClockSkewRetry(
      'FuturesExitPosition',
      (timestamp) => ({
        timestamp,
        ...(positionId ? { position_id: positionId } : {}),
        ...(pair ? { pair } : {}),
        ...(quantity !== undefined ? { quantity } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath('exit_position', '/exchange/v1/derivatives/futures/positions/exit');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async createFuturesTakeProfitStopLossOrders(order: Record<string, unknown>) {
    return this.withClockSkewRetry(
      'FuturesCreateTakeProfitStopLossOrders',
      (timestamp) => ({ timestamp, status: 'untriggered', ...order }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'create_take_profit_stop_loss_orders',
          '/exchange/v1/derivatives/futures/positions/create_tpsl',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async transferFuturesWallet(opts: { fromWallet: string; toWallet: string; amount: number }) {
    const fromWallet = opts.fromWallet.trim();
    const toWallet = opts.toWallet.trim();
    const amount = Number(opts.amount);
    if (!fromWallet || !toWallet) {
      throw new Error('transferFuturesWallet requires fromWallet and toWallet');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('transferFuturesWallet requires amount > 0');
    }
    return this.withClockSkewRetry(
      'FuturesWalletTransfer',
      (timestamp) => ({ timestamp, from_wallet: fromWallet, to_wallet: toWallet, amount }),
      async ({ body, headers }) => {
        const path = this.futuresPath('wallet_transfer', '/exchange/v1/derivatives/futures/wallets/transfer');
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async changeFuturesPositionMarginType(opts: { positionId?: string; pair?: string; marginType: string }) {
    const positionId = opts.positionId?.trim();
    const pair = opts.pair?.trim();
    const marginType = opts.marginType.trim();
    if (!positionId && !pair) {
      throw new Error('changeFuturesPositionMarginType requires positionId or pair');
    }
    if (!marginType) {
      throw new Error('changeFuturesPositionMarginType requires marginType');
    }
    return this.withClockSkewRetry(
      'FuturesChangePositionMarginType',
      (timestamp) => ({
        timestamp,
        margin_type: marginType,
        ...(positionId ? { position_id: positionId } : {}),
        ...(pair ? { pair } : {}),
      }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'change_position_margin_type',
          '/exchange/v1/derivatives/futures/positions/margin_type',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getFuturesCurrencyConversion(fromCurrency: string, toCurrency: string, amount: number) {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to) {
      throw new Error('getFuturesCurrencyConversion requires fromCurrency and toCurrency');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('getFuturesCurrencyConversion requires amount > 0');
    }
    return this.withClockSkewRetry(
      'FuturesCurrencyConversion',
      (timestamp) => ({ timestamp, from_currency: from, to_currency: to, amount }),
      async ({ body, headers }) => {
        const path = this.futuresPath(
          'get_currency_conversion',
          '/api/v1/derivatives/futures/data/conversions',
        );
        const response = await http.post(path, body, { headers });
        return response.data;
      },
    );
  }

  static async getTickers() {
    return this.fetchPublic('tickers', '/exchange/ticker');
  }

  static async getMarkets() {
    return this.fetchPublic('markets', '/exchange/v1/markets');
  }

  static async getMarketDetails() {
    return this.fetchPublic('market details', '/exchange/v1/markets_details');
  }

  static async getPublicTradeHistory(pair: string, limit = 100) {
    return this.fetchPublic('public trade history', '/market_data/trade_history', { pair, limit });
  }

  static async getPublicOrderBook(pair: string) {
    return this.fetchPublic('public orderbook', '/market_data/orderbook', { pair });
  }

  static async getPublicOrderbook(pair: string) {
    return this.getPublicOrderBook(pair);
  }

  private static async fetchPublic(label: string, path: string, params?: Record<string, unknown>) {
    try {
      const response = await publicHttp.get(path, params ? { params } : undefined);
      return response.data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching ${label}:`, error);
      return [];
    }
  }

  private static async fetchApiGet(label: string, path: string, params?: Record<string, unknown>) {
    try {
      const response = await http.get(path, params ? { params } : undefined);
      return response.data;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error fetching ${label}:`, error);
      return [];
    }
  }

  static async getCandles(
    pair: string,
    interval: string,
    limit = 100,
    range?: { fromMs?: number; toMs?: number },
  ) {
    // CoinDCX futures candlesticks: public.coindcx.com/market_data/candlesticks
    // resolution units: minutes (e.g. 1, 5, 15, 60, 240, "1D")
    const intervalToResolution: Record<string, string> = {
      '1m': '1', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '4h': '240', '1d': '1D'
    };
    const resolution = intervalToResolution[interval] ?? interval;
    const stepSeconds = resolution === '1D' ? 86_400 : Number(resolution) * 60;
    const boundedLimit = this.normalizeCandlestickLimit(limit, 100);
    const hasExplicitRange = range?.fromMs !== undefined || range?.toMs !== undefined;
    const nowSec = Math.floor(Date.now() / 1000);
    const fallbackToSec = hasExplicitRange
      ? Math.floor((range?.toMs ?? Date.now()) / 1000)
      : nowSec;
    const fallbackFromSec = fallbackToSec - stepSeconds * boundedLimit;
    const to = Math.max(0, Math.floor((range?.toMs ?? fallbackToSec * 1000) / 1000));
    const from = Math.max(0, Math.floor((range?.fromMs ?? fallbackFromSec * 1000) / 1000));
    const [fromSec, toSec] = from <= to ? [from, to] : [to, from];
    try {
      const response = await publicHttp.get('/market_data/candlesticks', {
        params: { pair, from: fromSec, to: toSec, resolution, pcode: 'f' },
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      const raw = response.data?.data ?? response.data;
      if (!Array.isArray(raw)) return [];
      // Normalise to [timestamp, open, high, low, close, volume]
      return raw.map((c: any) => Array.isArray(c)
        ? c
        : [c.time ?? c.t ?? c.timestamp, c.open ?? c.o, c.high ?? c.h, c.low ?? c.l, c.close ?? c.c, c.volume ?? c.v]
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const body = error?.response?.data;
      console.error(`Error fetching candles for ${pair} [${interval}] status=${status}:`, error.message, body);
      throw error;
    }
  }
}
