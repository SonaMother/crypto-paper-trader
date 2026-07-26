"""
Token configuration for the paper trading portfolio.

To add a new token to track:
  1. Find its CoinGecko coin ID (visit coingecko.com, search the token,
     copy the ID from the URL: e.g. /coins/tendies-2 -> ID is "tendies-2")
  2. Add an entry below with all required fields.

Each token definition includes:
  - id:        internal stable id (used as key in JSON files)
  - ticker:    display ticker
  - name:      full name
  - chain:     blockchain it lives on
  - coingecko_id:  CoinGecko API coin ID (primary price source)
  - contract:  contract/mint address (for verification / fallback)
  - color:     hex color used in the dashboard chart for this token
  - note:      short note about why we picked it
"""

TOKENS = [
    {
        "id": "tendies",
        "ticker": "TENDIES",
        "name": "TENDIES",
        "chain": "Robinhood",
        "coingecko_id": "tendies-2",
        "contract": None,  # verify on GeckoTerminal Robinhood chain
        "color": "#f59e0b",
        "note": "Pick #1 - Robinhood Chain #2 memecoin, gaining while category bleeds",
    },
    {
        "id": "cashcat",
        "ticker": "CASHCAT",
        "name": "Cash Cat",
        "chain": "Robinhood",
        "coingecko_id": "cash-cat",
        "contract": "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
        "color": "#3b82f6",
        "note": "Pick #2 - Robinhood Chain flagship meme, down 70% from ATH, accumulating zone",
    },
    {
        "id": "fox",
        "ticker": "FOX",
        "name": "Robin Hood",
        "chain": "Robinhood",
        "coingecko_id": "robin-hood-2",
        "contract": "0x2103faA9D1762e27a716C61718b3aCf3Ec1F9bf1",
        "color": "#10b981",
        "note": "Pick #3 - Micro-cap moonshot on Robinhood Chain, themed after the chain itself",
    },
    {
        "id": "pump",
        "ticker": "PUMP",
        "name": "Pump.fun",
        "chain": "Solana",
        "coingecko_id": "pump-fun",
        "contract": "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
        "color": "#8b5cf6",
        "note": "Pick #4 - Safer play, real revenue, listed on Binance US",
    },
]

# Initial paper-trading allocation: $1 USD per token
INITIAL_BUY_USD = 1.00

# Cash buffer in paper portfolio (USD) - for tracking uninvested capital
INITIAL_CASH_USD = 0.00
