# Futures WebSocket Channel Mapping

This document describes the futures-related WebSocket channels currently used by `CoinDCXWs`,
the event aliases emitted by the gateway, and examples of payload shapes expected by downstream
handlers.

## Source-of-truth note

The exact channel strings below are based on current observed behavior in this repository and
must be re-validated against authenticated CoinDCX docs before production hardening is marked
complete.

- Trusted source required: authenticated `docs.coindcx.com`
- Untrusted references (gists/snippets) are intentionally rejected by spec validation

## Subscription channels emitted by `CoinDCXWs`

For each configured pair (example `B-BTC_USDT`):

- `B-BTC_USDT_1m-futures` (candlestick)
- `B-BTC_USDT@orderbook@20-futures` (orderbook snapshot/update)
- `B-BTC_USDT@trades-futures` (trade prints)
- `B-BTC_USDT@prices-futures` (price stats / change stream)

Global futures price stream:

- `currentPrices@futures@rt`

Private account stream:

- `coindcx` (joined with API key + HMAC signature)

## Public futures event mapping

`CoinDCXWs` forwards raw exchange events and also emits normalized futures aliases:

- `candlestick` -> `futures-candlestick` (futures product only)
- `depth-snapshot` -> `futures-orderbook-snapshot` (futures product only)
- `depth-update` -> `futures-orderbook-update` (futures product only)
- `new-trade` -> `futures-new-trade` (futures product only)
- `price-change` / `priceStats` -> `futures-price-stats` (futures product only)
- `currentPrices@futures#update` / `currentPrices` -> `futures-current-prices`
- derived from current prices: `futures-ltp-update` and `ltp-update`

### Example: futures orderbook update

```json
{
  "channel": "B-BTC_USDT@orderbook@20-futures",
  "data": {
    "bids": [["101.1", "0.5"]],
    "asks": [["101.2", "0.4"]],
    "pr": "f"
  }
}
```

Emits:

- `depth-update` with normalized payload
- `futures-orderbook-update` with normalized payload

### Example: futures current prices update

```json
{
  "data": {
    "prices": {
      "B-BTC_USDT": {
        "ls": 101.2,
        "mp": 101.0
      }
    }
  }
}
```

Emits:

- `currentPrices@futures#update`
- `currentPrices`
- `futures-current-prices`
- `futures-ltp-update` (per pair):
  - `{ pair, ltp, markPrice, raw }`

## Private futures/account event mapping

CoinDCX may emit base names or `df-` prefixed variants. `CoinDCXWs` supports both and emits
stable aliases for account handlers:

- `balance-update` -> `futures-balance-update`
- `position-update` / `df-position-update` -> `futures-position-update`
- `order-update` / `df-order-update` -> `futures-order-update`
- `trade-update` / `df-trade-update` -> `futures-trade-update`

### Example: private order update

```json
{
  "data": {
    "id": "ord-123",
    "pair": "B-BTC_USDT",
    "status": "open",
    "side": "buy"
  }
}
```

Emits:

- `order-update` (or `df-order-update` depending on incoming event)
- `futures-order-update`

### Example: `balance-update` (channel `coindcx`)

Per CoinDCX, the handler receives `response` where **`response.data`** is an **array** of wallet
rows (the same shape may also appear as a bare array on the wire in some clients):

```json
{
  "data": [
    {
      "id": "026ef0f2-b5d8-11ee-b182-570ad79469a2",
      "balance": "1.0221449",
      "locked_balance": "0.99478995",
      "currency_id": "c19c38d1-3ebb-47ab-9207-62d043be7447",
      "currency_short_name": "USDT"
    }
  ]
}
```

`CoinDCXWs` uses `const data = response.data ?? response` before emitting, so downstream code
typically receives the **array** (or single object) directly.

Emits:

- `balance-update` (normalized payload: that array or object)
- `futures-balance-update` (same payload, stable alias)

The app maps each row to `state.balanceMap` and `account.ingest('balance', row)` using
`normalizeBalance` in `src/account/normalizers.ts` (WS rows are usually plain `balance` /
`locked_balance`).

### REST: `POST /exchange/v1/derivatives/futures/wallets` (wallet details)

Signed body includes `{ "timestamp": <epoch_seconds> }` (same as other private REST calls; this
client uses **POST** because axios does not send JSON bodies on GET).

Example row (INR & USDT futures wallets use this shape when both `cross_*` fields are present):

```json
{
  "id": "c5f039dd-4e11-4304-8f91-e9c1f62d754d",
  "currency_short_name": "USDT",
  "balance": "6.1693226",
  "locked_balance": "0.0",
  "cross_order_margin": "0.0",
  "cross_user_margin": "0.68534648"
}
```

Per CoinDCX field definitions, **`balance` is not used alone as the wallet display total**;
`locked_balance`, `cross_order_margin`, and `cross_user_margin` describe margin usage. The bot
stores **locked** as the sum of those three, and **available** (free wallet cash) as
`max(0, balance − that sum)` so WAL/EQ align with margin locked in cross and isolated modes.

Fallback `POST /exchange/v1/users/balances` rows omit `cross_*` keys and keep the legacy
`available = balance`, `locked = locked_balance` mapping.

