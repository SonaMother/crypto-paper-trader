# API Reference — Crypto Paper Trader

This document describes how **AI agents** (zAI, gAi, or any future AI) and
**humans** can interact with the paper trading portfolio programmatically.

## Two modes of access

### 1. Local mode (when you have the repo cloned)

Use `scripts/api.py` directly. It reads/writes the JSON files in `data/`.

```bash
python scripts/api.py status
python scripts/api.py buy tendies --usd 5 --actor zAI
```

### 2. Remote mode (from anywhere, no clone needed)

Use the GitHub REST API to read/write the JSON files in the repo directly.
This is what AI agents should use.

**Base URL**: `https://api.github.com/repos/SonaMother/crypto-paper-trader`

**Auth**: `Authorization: token <GITHUB_PAT>` (PAT needs `repo` scope; for
triggering the workflow, also needs `workflow` scope)

**Rate limit**: 5000 req/hour per token (more than enough)

---

## Endpoints (local mode — `scripts/api.py`)

All commands support `--remote` flag to use GitHub API instead of local files.

### `status`
Get full portfolio state + system status + activity log.

```bash
python scripts/api.py status
python scripts/api.py --remote status
```

Returns:
```json
{
  "portfolio": {
    "total_value_usd": 5.91,
    "total_pnl_usd": -0.09,
    "total_pnl_pct": -1.58,
    "holdings": [...],
    "per_ai": [
      {"ai": "zAI", "num_tokens": 4, "pnl_pct": -1.66, ...},
      {"ai": "gAi", "num_tokens": 2, "pnl_pct": 0.0, ...}
    ]
  },
  "system_status": {
    "last_refresh_ts": "2026-07-27T05:19:00Z",
    "last_event_actor": "cron",
    "recent_events": [...]
  },
  "timestamp": "2026-07-27T05:20:00Z"
}
```

### `buy <token_id> --usd <N> | --amount <N> --actor <name> --note <text>`
Buy a token at current market price.

```bash
# Buy $5 of TENDIES as zAI
python scripts/api.py buy tendies --usd 5 --actor zAI --note "doubling down"

# Buy 100 FOX as human
python scripts/api.py buy fox --amount 100 --actor human
```

### `sell <token_id> --pct <N> | --usd <N> | --amount <N> --actor <name>`
Sell a token.

```bash
# Sell 50% of PUMP holdings
python scripts/api.py sell pump --pct 50

# Sell $3 worth of CASHCAT
python scripts/api.py sell cashcat --usd 3
```

### `refresh`
Fetch fresh prices, update portfolio, evaluate rules, log the event.

```bash
python scripts/api.py refresh                    # local
python scripts/api.py --remote refresh           # triggers GitHub Actions workflow
```

### `rule add|remove|list`
Manage automated trading rules.

```bash
# Add a take-profit rule: sell 50% when any token hits +100% P&L
python scripts/api.py rule add \
  --token-id all \
  --type take_profit \
  --threshold 100 \
  --action sell_50pct \
  --actor zAI \
  --note "Take 50% profit on any 2x"

# Add a stop-loss rule for FOX: sell everything if it drops 50%
python scripts/api.py rule add \
  --token-id fox \
  --type stop_loss \
  --threshold -50 \
  --action sell_100pct \
  --actor human \
  --note "Cut FOX losses at -50%"

# List all rules
python scripts/api.py rule list

# Remove a rule
python scripts/api.py rule remove <rule_id>
```

### `activity --limit <N>`
Show recent activity log entries.

```bash
python scripts/api.py activity --limit 20
```

---

## Endpoints (remote mode — GitHub REST API)

### Read portfolio state
```http
GET https://api.github.com/repos/SonaMother/crypto-paper-trader/contents/data/portfolio.json
Authorization: token <GITHUB_PAT>
```
Returns base64-encoded JSON. Decode the `content` field, then JSON-parse it.

### Read trades / price history / activity log / rules
Same pattern, different paths:
- `data/trades.json`
- `data/price_history.json`
- `data/activity_log.json`
- `data/rules.json`

### Trigger a refresh (workflow_dispatch)
```http
POST https://api.github.com/repos/SonaMother/crypto-paper-trader/actions/workflows/update.yml/dispatches
Authorization: token <GITHUB_PAT>   (needs `workflow` scope)
Content-Type: application/json

{"ref": "main"}
```
Returns HTTP 204 on success. The workflow runs in ~30s.

### Write a trade (advanced)
Writing is more complex because you need to:
1. GET the current file (to get its SHA)
2. Modify the content
3. PUT the new content with the SHA

For AI agents, the easiest pattern is to clone the repo, run `scripts/api.py buy ...`,
and push. The `--remote` flag in `api.py` automates this for the `buy` command:

```bash
GITHUB_TOKEN=<PAT> GITHUB_REPO=SonaMother/crypto-paper-trader \
  python scripts/api.py --remote buy tendies --usd 5 --actor gAi
```

This:
1. Clones the repo to a temp dir
2. Runs the local buy logic
3. Commits and pushes
4. Returns the trade object

---

## Activity log schema

Every event has this shape:

```json
{
  "ts": "2026-07-27T05:19:00Z",
  "epoch": 1785129540,
  "actor": "cron",           // cron | zAI | gAi | human | system
  "action": "refresh",       // refresh | refresh_failed | buy | sell | rule_triggered | rule_added | rule_removed
  "details": "Hourly refresh: 6/6 prices fetched, 0 rule(s) triggered. P&L: $-0.37 (-6.09%)",
  "data": {                  // optional structured payload
    "fetched": 6,
    "total": 6,
    "rules_triggered": 0,
    "portfolio_value": 5.63,
    "pnl_pct": -6.09
  }
}
```

Actors to use when logging:
- `cron` — automated hourly refresh
- `zAI` — zAI agent actions
- `gAi` — gAi agent actions
- `human` — user-initiated actions
- `system` — internal system events

---

## Rules schema

```json
{
  "id": "tp-zai-basket-2x",
  "enabled": true,
  "token_id": "all",              // or a specific token id like "tendies"
  "type": "take_profit",          // take_profit | stop_loss
  "threshold": 100,               // P&L % threshold (100 = 2x gain, -50 = 50% loss)
  "action": "sell_50pct",         // sell_25pct | sell_50pct | sell_75pct | sell_100pct | alert_only
  "created_by": "zAI",
  "note": "Take 50% profit on any zAI pick that 2x's"
}
```

Rules are evaluated after every price refresh. When a rule triggers, it:
1. Executes the sell action as a paper trade
2. Logs the event to the activity log with `action: "rule_triggered"`
3. Records the trade in `trades.json` with a note explaining which rule fired

---

## Integration examples

### For AI agents

```python
# Read portfolio state via GitHub API
import urllib.request, json, base64

def get_portfolio(token):
    url = "https://api.github.com/repos/SonaMother/crypto-paper-trader/contents/data/portfolio.json"
    req = urllib.request.Request(url, headers={"Authorization": f"token {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    content = base64.b64decode(data["content"]).decode("utf-8")
    return json.loads(content)

# Make a buy via the api.py --remote flag
import subprocess
result = subprocess.run([
    "python", "scripts/api.py", "--remote", "buy", "tendies",
    "--usd", "5", "--actor", "gAi", "--note", "gAi doubling down on zAI pick"
], capture_output=True, text=True, env={**os.environ, "GITHUB_TOKEN": token, "GITHUB_REPO": "SonaMother/crypto-paper-trader"})
print(result.stdout)
```

### For humans (one-liners)

```bash
# Check status
python scripts/api.py status

# Add a buy
python scripts/api.py buy fox --usd 2 --actor human --note "adding to FOX position"

# Add a take-profit rule
python scripts/api.py rule add --token-id fox --type take_profit --threshold 200 --action sell_50pct --actor human --note "Sell half FOX at 3x"

# Trigger a refresh right now
python scripts/api.py refresh
```

---

## Dashboard integration

The dashboard at https://sonamother.github.io/crypto-paper-trader/ is read-only
by default. To enable the "Trigger cron" button:

1. Generate a GitHub PAT with `repo` + `workflow` scopes
2. Open the dashboard
3. Paste the PAT into the "API token" input in the hero card
4. Click "Save" (stored in your browser's localStorage, never sent anywhere except GitHub)
5. Click "Trigger cron" — this calls the GitHub API workflow_dispatch endpoint

The dashboard auto-refreshes prices every 60 seconds (browser-side), and
reads the activity log + rules every time you click "Refresh" or it auto-refreshes.
