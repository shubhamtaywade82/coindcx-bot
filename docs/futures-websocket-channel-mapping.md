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

