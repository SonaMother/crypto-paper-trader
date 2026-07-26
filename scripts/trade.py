"""
Manual trade CLI for the paper portfolio.

Examples:
    # Buy $5 of TENDIES at current market price
    python scripts/trade.py buy tendies --usd 5

    # Buy 100 FOX at current market price
    python scripts/trade.py buy fox --amount 100

    # Sell 50% of PUMP holdings
    python scripts/trade.py sell pump --pct 50

    # Sell $3 worth of CASHCAT
    python scripts/trade.py sell cashcat --usd 3

    # Add a new token to track (creates a $0 position; you can buy later)
    python scripts/trade.py add NEWT --name "New Token" --chain Solana --cg-id new-token --color '#ff0000'
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import TOKENS
from fetch_prices import fetch_all_token_prices
from portfolio import load_portfolio, record_trade, compute_summary
from utils import fmt_usd, fmt_pct


def get_price(token_id: str) -> float:
    prices = fetch_all_token_prices()
    info = prices.get(token_id)
    if not info or info.get("price") is None:
        raise RuntimeError(f"Could not fetch live price for {token_id}")
    return info["price"]


def cmd_buy(args):
    token_id = args.token.lower()
    token = next((t for t in TOKENS if t["id"] == token_id), None)
    if not token:
        print(f"Unknown token: {token_id}")
        print(f"Available: {', '.join(t['id'] for t in TOKENS)}")
        sys.exit(1)

    price = get_price(token_id)
    if args.usd is not None:
        usd = args.usd
        amount = usd / price
    elif args.amount is not None:
        amount = args.amount
        usd = amount * price
    else:
        print("Must specify --usd or --amount")
        sys.exit(1)

    trade = record_trade("BUY", token_id, amount, price, note=args.note or f"Manual buy: {fmt_usd(usd)} of {token['ticker']}")
    print(f"✓ BUY {trade['amount']:.6f} {token['ticker']} @ ${trade['price_usd']:.8g} = {fmt_usd(trade['value_usd'])}")
    print(f"  Trade ID: {trade['id']}")


def cmd_sell(args):
    token_id = args.token.lower()
    token = next((t for t in TOKENS if t["id"] == token_id), None)
    if not token:
        print(f"Unknown token: {token_id}")
        sys.exit(1)

    p = load_portfolio()
    h = p["holdings"].get(token_id)
    if not h or h["amount"] <= 0:
        print(f"No holdings to sell for {token_id}")
        sys.exit(1)

    price = get_price(token_id)
    if args.pct is not None:
        amount = h["amount"] * (args.pct / 100.0)
    elif args.usd is not None:
        amount = args.usd / price
    elif args.amount is not None:
        amount = args.amount
    else:
        print("Must specify --pct, --usd, or --amount")
        sys.exit(1)

    if amount > h["amount"]:
        print(f"Insufficient balance: have {h['amount']}, want to sell {amount}")
        sys.exit(1)

    trade = record_trade("SELL", token_id, amount, price, note=args.note or f"Manual sell: {amount:.6f} {token['ticker']}")
    print(f"✓ SELL {trade['amount']:.6f} {token['ticker']} @ ${trade['price_usd']:.8g} = {fmt_usd(trade['value_usd'])}")
    print(f"  Trade ID: {trade['id']}")


def cmd_status(args):
    s = compute_summary()
    print(f"Portfolio summary (last updated {s['last_updated_at']}):")
    print(f"  Total cost : {fmt_usd(s['total_cost_usd'])}")
    print(f"  Total value: {fmt_usd(s['total_value_usd'])}")
    print(f"  P&L        : {fmt_usd(s['total_pnl_usd'])} ({fmt_pct(s['total_pnl_pct'])})")
    print(f"  Cash       : {fmt_usd(s['cash_usd'])}")
    print()
    print(f"{'Token':<10} {'Amount':<14} {'Cost':<10} {'Price':<14} {'Value':<10} {'P&L'}")
    print("-" * 70)
    for h in s["holdings"]:
        pnl = f"{fmt_usd(h['pnl_usd'])} ({fmt_pct(h['pnl_pct'])})"
        print(f"{h['ticker']:<10} {h['amount']:<14.4f} {fmt_usd(h['cost_basis_usd']):<10} "
              f"${h['last_price'] or 0:<13.8g} {fmt_usd(h['current_value_usd']):<10} {pnl}")


def main():
    parser = argparse.ArgumentParser(description="Paper trading portfolio CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_buy = sub.add_parser("buy", help="Buy a token with USD or specific amount")
    p_buy.add_argument("token", help="Token id (e.g. tendies)")
    p_buy.add_argument("--usd", type=float, help="USD worth to buy")
    p_buy.add_argument("--amount", type=float, help="Token amount to buy")
    p_buy.add_argument("--note", help="Optional trade note")
    p_buy.set_defaults(func=cmd_buy)

    p_sell = sub.add_parser("sell", help="Sell a token by percentage/USD/amount")
    p_sell.add_argument("token", help="Token id")
    p_sell.add_argument("--pct", type=float, help="Percentage of holdings to sell (0-100)")
    p_sell.add_argument("--usd", type=float, help="USD worth to sell")
    p_sell.add_argument("--amount", type=float, help="Token amount to sell")
    p_sell.add_argument("--note", help="Optional trade note")
    p_sell.set_defaults(func=cmd_sell)

    p_status = sub.add_parser("status", help="Show current portfolio status")
    p_status.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
