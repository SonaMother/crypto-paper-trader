"""
Lightweight activity log for tracking system events and AI actions.

This is appended to by:
  - The cron (update_portfolio.py) — logs each refresh
  - AI agents (via api.py) — logs trades, status checks, etc.
  - The dashboard (read-only) — shows recent activity

Format: data/activity_log.json (a list of event objects, newest last)

Event schema:
  {
    "ts": "2026-07-27T14:30:00Z",
    "epoch": 1789000000,
    "actor": "cron" | "zAI" | "gAi" | "human" | "system",
    "action": "refresh" | "buy" | "sell" | "rule_triggered" | "status_check" | ...,
    "details": "human-readable description",
    "data": { ... optional structured payload ... }
  }

We cap the log at 1000 entries to keep file size reasonable.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import read_json, write_json, now_iso, now_epoch
from pathlib import Path

ACTIVITY_LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "activity_log.json")

MAX_ENTRIES = 1000


def log_event(actor: str, action: str, details: str, data: dict = None) -> dict:
    """Append an event to the activity log."""
    event = {
        "ts": now_iso(),
        "epoch": now_epoch(),
        "actor": actor,
        "action": action,
        "details": details,
        "data": data or {},
    }
    log = read_json(ACTIVITY_LOG_PATH, [])
    log.append(event)
    if len(log) > MAX_ENTRIES:
        log = log[-MAX_ENTRIES:]
    write_json(ACTIVITY_LOG_PATH, log)
    return event


def get_recent_events(limit: int = 50) -> list:
    """Return the most recent N events, newest first."""
    log = read_json(ACTIVITY_LOG_PATH, [])
    return list(reversed(log[-limit:]))


def get_system_status() -> dict:
    """Return a snapshot of recent activity for status displays."""
    log = read_json(ACTIVITY_LOG_PATH, [])
    if not log:
        return {
            "last_event_ts": None,
            "last_event_actor": None,
            "last_event_action": None,
            "last_event_details": None,
            "total_events": 0,
            "recent_events": [],
        }
    last = log[-1]
    last_refresh = next((e for e in reversed(log) if e.get("action") == "refresh"), None)
    last_trade = next((e for e in reversed(log) if e.get("action") in ("buy", "sell")), None)
    last_rule = next((e for e in reversed(log) if e.get("action") == "rule_triggered"), None)
    return {
        "last_event_ts": last.get("ts"),
        "last_event_actor": last.get("actor"),
        "last_event_action": last.get("action"),
        "last_event_details": last.get("details"),
        "last_refresh_ts": last_refresh.get("ts") if last_refresh else None,
        "last_trade_ts": last_trade.get("ts") if last_trade else None,
        "last_rule_ts": last_rule.get("ts") if last_rule else None,
        "total_events": len(log),
        "recent_events": list(reversed(log[-20:])),
    }


if __name__ == "__main__":
    # Quick test
    log_event("system", "test", "Activity log initialized")
    status = get_system_status()
    print(f"Total events: {status['total_events']}")
    print(f"Last event: {status['last_event_action']} by {status['last_event_actor']} at {status['last_event_ts']}")
