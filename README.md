# Crypto Paper Trader

A no-KYC, no-server, no-API-key paper trading tracker for crypto memecoins.

Built as an experiment: track $1 paper buys of 4 hand-picked early-stage tokens
in real time, with hourly auto-updates via GitHub Actions and a live dashboard
on GitHub Pages.

> ⚠️ **Not financial advice.** Paper trading only. Real crypto is risky — never
> invest more than you can afford to lose.

## What's in here

| Component | What it does |
|---|---|
| `scripts/` | Python scripts that fetch live prices and maintain the paper portfolio |
| `data/` | Live portfolio state, trade history, and price history (JSON) — updated hourly |
| `index.html`, `style.css`, `app.js` | Static dashboard served via GitHub Pages |
| `.github/workflows/update.yml` | GitHub Actions cron that runs every hour to refresh prices |

## The 4 tracked tokens

| # | Ticker | Chain | Why |
|---|---|---|---|
| 🥇 | **TENDIES** | Robinhood | Robinhood Chain's #2 meme, gaining while category bleeds |
| 🥈 | **CASHCAT** | Robinhood | Robinhood Chain flagship meme, down 70% from ATH |
| 🥉 | **FOX** (Robin Hood) | Robinhood | Micro-cap moonshot, themed after the chain itself |
| 🏅 | **PUMP** | Solana | Safer play — Pump.fun's native token with real revenue |

Each token was bought for **$1 of paper money** at the live market price when
the portfolio was initialized. See `data/trades.json` for the exact entry
prices and timestamps.

## Live dashboard

Once GitHub Pages is enabled, the dashboard is available at:

```
https://<github-username>.github.io/<repo-name>/
```

It shows:
- Total portfolio value + P&L (hero card)
- Performance summary (best/worst performer, winners vs losers)
- Portfolio value over time (line chart)
- Per-token holdings cards with current value, P&L, 24h change
- Trade history table (all paper buys/sells)
- Auto-refreshes every 5 minutes (and the data updates hourly via cron)

## How to run locally

```bash
# 1. Clone
git clone https://github.com/<username>/<repo>.git
cd <repo>

# 2. (Optional) Create a virtualenv
python -m venv .venv && source .venv/bin/activate

# 3. Refresh prices and update the portfolio
python scripts/update_portfolio.py

# 4. View the portfolio status
python scripts/trade.py status

# 5. Serve the dashboard locally
python -m http.server 8000
# Open http://localhost:8000 in your browser
```

## Manual trades (paper)

You can add new paper buys or sells via the trade CLI:

```bash
# Buy $5 of TENDIES at current market price
python scripts/trade.py buy tendies --usd 5

# Buy 1000 FOX at current market price
python scripts/trade.py buy fox --amount 1000

# Sell 50% of PUMP holdings
python scripts/trade.py sell pump --pct 50

# Sell $3 worth of CASHCAT
python scripts/trade.py sell cashcat --usd 3

# Show current portfolio status
python scripts/trade.py status
```

After running a manual trade, commit and push the updated `data/` files so the
dashboard reflects the new state:

```bash
git add data/
git commit -m "manual: <describe your trade>"
git push
```

## Re-initializing the portfolio

If you want to start fresh (wipe all trades and re-buy $1 of each token at
current prices):

```bash
python scripts/init_portfolio.py --force
```

## Adding a new token to track

Edit `scripts/config.py` and add a new entry to the `TOKENS` list:

```python
{
    "id": "wif",                       # internal id, lowercase
    "ticker": "WIF",
    "name": "dogwifhat",
    "chain": "Solana",
    "coingecko_id": "dogwifhat",       # from coingecko.com URL
    "contract": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    "color": "#f59e0b",
    "note": "Why we picked it",
},
```

Then run `python scripts/trade.py buy wif --usd 1` to open a paper position.

## How price fetching works

1. **Primary**: CoinGecko `/coins/markets` endpoint — single batch call for all
   tokens, returns price + 24h change + market cap + volume.
2. **Fallback**: GeckoTerminal per-token endpoint — used when CoinGecko is
   rate-limited or doesn't have a particular token. GeckoTerminal is also run
   by CoinGecko but uses a separate API quota.

Both APIs are free and require no API key for the volume we use (~1 call per
hour). The script retries on rate limits with exponential backoff.

## How the auto-update works

The GitHub Actions workflow at `.github/workflows/update.yml` runs every hour
at minute :05 (offset from :00 to avoid the GitHub Actions cron peaks). It:

1. Checks out the repo
2. Installs Python
3. Runs `python scripts/update_portfolio.py` (fetches prices, updates JSON)
4. Commits and pushes the updated `data/` files

Every hourly snapshot becomes a git commit, so the full portfolio history is
preserved in git — you can `git log data/portfolio.json` to see every state
change.

## Project structure

```
.
├── README.md
├── requirements.txt
├── .gitignore
├── index.html                  # dashboard (served by GitHub Pages)
├── style.css
├── app.js
├── .github/
│   └── workflows/
│       └── update.yml          # hourly cron job
├── scripts/
│   ├── config.py               # token definitions
│   ├── fetch_prices.py         # CoinGecko + GeckoTerminal client
│   ├── portfolio.py            # portfolio data layer
│   ├── init_portfolio.py       # initialize with $1 buys
│   ├── update_portfolio.py     # refresh prices + mark-to-market
│   ├── trade.py                # manual trade CLI
│   └── utils.py                # shared helpers
└── data/
    ├── portfolio.json          # current holdings + cash
    ├── trades.json             # trade history
    └── price_history.json      # time-series of portfolio value
```

## License

MIT — do whatever you want with this code.

## Disclaimer

This is a research project for tracking paper trades. It is not financial
advice. The tokens tracked here are extremely risky (memecoins on a 3-week-old
blockchain, micro-cap moonshots, etc.) and most will probably go to zero. The
purpose is to learn and observe, not to make real money.
