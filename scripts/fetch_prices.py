"""
Price fetcher using CoinGecko + GeckoTerminal APIs.

Primary source: CoinGecko /coins/markets (single batch call, all tokens)
Fallback:       GeckoTerminal per-token endpoint (different rate limit)

GeckoTerminal is also run by CoinGecko but uses a separate API with its own
quota, and accepts token contract addresses directly, so it's a good fallback
for obscure DEX-listed tokens.
"""

import urllib.request
import urllib.error
import json
import time
from typing import Optional, Dict

from config import TOKENS

COINGECKO_SIMPLE_PRICE = "https://api.coingecko.com/api/v3/simple/price"
COINGECKO_MARKET = "https://api.coingecko.com/api/v3/coins/markets"
GECKOTERMINAL_TOKEN = "https://api.geckoterminal.com/api/v2/networks/{network}/tokens/{address}"

# Map our chain names to GeckoTerminal network slugs
GECKOTERMINAL_NETWORKS = {
    "Solana": "solana",
    "Robinhood": "robinhood",
    "BSC": "bsc",
    "Base": "base",
    "Ethereum": "eth",
    "Arbitrum": "arbitrum",
}

USER_AGENT = "paper-trader/1.0 (research project)"


def _http_get_json(url: str, timeout: int = 15, extra_headers: dict = None) -> dict:
    """HTTP GET that returns parsed JSON, with basic retry (and longer backoff for 429)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                wait = 5 * (attempt + 1)
                print(f"[rate-limit] 429 from API; sleeping {wait}s before retry...")
                time.sleep(wait)
            else:
                time.sleep(1.5 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after retries: {last_err}")


# ---------------------------------------------------------------------------
# Primary source: CoinGecko /coins/markets (single batch call)
# ---------------------------------------------------------------------------

def fetch_via_coingecko_markets(coingecko_ids: list[str]) -> Dict[str, dict]:
    """Returns dict keyed by coingecko_id."""
    if not coingecko_ids:
        return {}
    ids_param = ",".join(coingecko_ids)
    url = (
        f"{COINGECKO_MARKET}?vs_currency=usd"
        f"&ids={ids_param}"
        "&order=market_cap_desc"
        "&per_page=250&page=1"
        "&sparkline=false"
        "&price_change_percentage=24h"
    )
    items = _http_get_json(url)
    out = {}
    for item in items:
        cg_id = item.get("id")
        out[cg_id] = {
            "price": float(item.get("current_price") or 0),
            "change_24h": float(item.get("price_change_percentage_24h") or 0),
            "market_cap": float(item.get("market_cap") or 0),
            "volume_24h": float(item.get("total_volume") or 0),
        }
    return out


# ---------------------------------------------------------------------------
# Fallback source: GeckoTerminal per-token endpoint
# ---------------------------------------------------------------------------

def fetch_via_geckoterminal(token: dict) -> Optional[dict]:
    """Fetch price for a single token via GeckoTerminal using its contract address."""
    if not token.get("contract"):
        return None
    network = GECKOTERMINAL_NETWORKS.get(token["chain"])
    if not network:
        return None
    address = token["contract"]
    url = GECKOTERMINAL_TOKEN.format(network=network, address=address)
    try:
        data = _http_get_json(url, extra_headers={"Accept": "application/json;version=20230302"})
        attrs = data.get("data", {}).get("attributes", {})
        return {
            "price": float(attrs.get("price_usd") or 0),
            "change_24h": float(attrs.get("price_change_percentage", {}).get("h24") or 0),
            "market_cap": float(attrs.get("market_cap_usd") or 0),
            "volume_24h": float(attrs.get("volume_usd", {}).get("h24") or 0),
        }
    except Exception as e:
        print(f"[warn] GeckoTerminal fetch failed for {token['ticker']}: {e}")
        return None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def fetch_all_token_prices() -> Dict[str, dict]:
    """
    Returns dict keyed by our internal token id:
        { "tendies": { "price": ..., "change_24h": ..., "market_cap": ..., "volume_24h": ... }, ... }

    Tries CoinGecko /markets first (one batch call).
    For any token whose price couldn't be fetched there, falls back to GeckoTerminal.
    Tokens that fail both are returned with price=None.
    """
    cg_ids = [t["coingecko_id"] for t in TOKENS if t.get("coingecko_id")]

    try:
        prices_by_cg_id = fetch_via_coingecko_markets(cg_ids)
    except Exception as e:
        print(f"[warn] CoinGecko markets batch failed: {e}")
        prices_by_cg_id = {}

    out = {}
    for token in TOKENS:
        tid = token["id"]
        cg_id = token["coingecko_id"]
        result = prices_by_cg_id.get(cg_id)

        if not result or result.get("price", 0) == 0:
            # Fallback to GeckoTerminal
            print(f"[info] Falling back to GeckoTerminal for {token['ticker']}...")
            gt_result = fetch_via_geckoterminal(token)
            if gt_result and gt_result.get("price", 0) > 0:
                out[tid] = gt_result
            else:
                out[tid] = {"price": None, "change_24h": None, "market_cap": None, "volume_24h": None}
        else:
            out[tid] = result

    return out


if __name__ == "__main__":
    print("Fetching prices for all tracked tokens...")
    prices = fetch_all_token_prices()
    print()
    for tid, p in prices.items():
        if p["price"] is None:
            print(f"  {tid:10s}  PRICE UNAVAILABLE")
        else:
            print(f"  {tid:10s}  ${p['price']:<14.8g}  24h: {p['change_24h']:+.2f}%  mcap: ${p['market_cap']:,.0f}")
