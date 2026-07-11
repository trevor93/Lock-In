#!/usr/bin/env python3
# ============================================================
# HERMES BRIDGE — connects your local Hermes agent (Termux) to the War Room app
# ============================================================
# SETUP (in Termux):
#   pkg install python termux-api -y
#   pip install requests
#   curl -o hermes_bridge.py https://YOUR-APP-URL/static/hermes_bridge.py
#   export WARROOM_URL="https://YOUR-APP-URL"
#   export WARROOM_TOKEN="hermes_xxxxx"   # from the app: COUNCIL tab -> HERMES BRIDGE
#
# USAGE:
#   python hermes_bridge.py briefing            # full commander's file (feed to your agent as context)
#   python hermes_bridge.py pending             # what needs attention NOW (overdue blocks, flags, debrief)
#   python hermes_bridge.py watch               # daemon loop: alerts via termux-notification when blocks start/get missed
#   python hermes_bridge.py done <block_id>     # check off a block
#   python hermes_bridge.py intel '<title>' -d money -s 'situation' -m 'my move' -o 'outcome'
#   python hermes_bridge.py journal --wins '...' --breaks '...' --targets '...'
#   python hermes_bridge.py say '<message>'     # post your local agent's counsel into the app's Council log
#   python hermes_bridge.py export              # full DB export (sync your agent's memory)
#
# TELEGRAM RELAY (optional): set TG_BOT_TOKEN and TG_CHAT_ID env vars,
# and `watch` will also push alerts to your Telegram.
# ============================================================
import os, sys, json, time, argparse, subprocess
from datetime import datetime

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

BASE = os.environ.get("WARROOM_URL", "").rstrip("/")
TOKEN = os.environ.get("WARROOM_TOKEN", "")
if not BASE or not TOKEN:
    sys.exit("Set WARROOM_URL and WARROOM_TOKEN env vars first. Token is in the app: COUNCIL tab -> HERMES BRIDGE panel.")

H = {"X-Agent-Token": TOKEN, "Content-Type": "application/json"}

def now_date(): return datetime.now().strftime("%Y-%m-%d")
def now_time(): return datetime.now().strftime("%H:%M")

def get(path, **params):
    r = requests.get(f"{BASE}{path}", headers=H, params=params, timeout=30)
    r.raise_for_status(); return r.json()

def post(path, body):
    r = requests.post(f"{BASE}{path}", headers=H, json=body, timeout=30)
    r.raise_for_status(); return r.json()

def notify(title, msg):
    """Android notification via termux-api; falls back to stdout. Optional Telegram relay."""
    try:
        subprocess.run(["termux-notification", "--title", title, "--content", msg,
                        "--priority", "max", "--sound"], timeout=10, check=False)
        subprocess.run(["termux-vibrate", "-d", "800"], timeout=5, check=False)
    except FileNotFoundError:
        pass
    tg_token, tg_chat = os.environ.get("TG_BOT_TOKEN"), os.environ.get("TG_CHAT_ID")
    if tg_token and tg_chat:
        try:
            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          json={"chat_id": tg_chat, "text": f"⚔ {title}\n{msg}"}, timeout=15)
        except Exception:
            pass
    print(f"[{now_time()}] {title} — {msg}")

def cmd_briefing(args):
    d = get("/api/agent/briefing", date=now_date(), time=now_time())
    print(d["briefing"])
    if d.get("current"):
        print(f"\n>>> CURRENT BLOCK: {d['current']['title']} ({d['current']['start_time']}-{d['current']['end_time']})")

def cmd_pending(args):
    d = get("/api/agent/pending", date=now_date(), time=now_time())
    print(json.dumps(d, indent=2))

def cmd_watch(args):
    """Daemon: run inside tmux/termux-wake-lock. Alerts on block starts, missed blocks, missing debrief."""
    print("HERMES WATCH ACTIVE. The commander will not slip through unnoticed.")
    alerted = set()
    last_block = None
    while True:
        try:
            d = get("/api/agent/pending", date=now_date(), time=now_time())
            cur = d.get("current_block")
            if cur and cur["id"] != last_block:
                last_block = cur["id"]
                notify(f"NOW: {cur['title']}", f"{cur['start']}–{cur['end']}. Move, Commander.")
            for b in d.get("overdue_unlogged", []):
                key = f"{now_date()}-{b['id']}"
                if key not in alerted:
                    alerted.add(key)
                    tag = "NON-NEGOTIABLE " if b.get("non_negotiable") else ""
                    notify(f"UNLOGGED {tag}BLOCK", f"'{b['title']}' ended {b['end']} with no report. Log it — silence is the worst report.")
            for f in d.get("unacknowledged_flags", []):
                key = f"flag-{f['id']}"
                if key not in alerted:
                    alerted.add(key)
                    notify(f"HONESTY FLAG [{f['severity']}]", f["message"][:200])
            hh = int(now_time()[:2])
            if hh >= 21 and not d.get("debrief_filed_today") and f"debrief-{now_date()}" not in alerted:
                alerted.add(f"debrief-{now_date()}")
                notify("NIGHT DEBRIEF MISSING", "Law 5: Track, don't trust. File the intelligence report before lights out.")
        except Exception as e:
            print(f"[watch] error: {e}")
        time.sleep(int(os.environ.get("WATCH_INTERVAL", "60")))

def cmd_done(args):
    post("/api/agent/block-log", {"block_id": int(args.block_id), "date": now_date(),
                                  "status": args.status, "note": args.note})
    print(f"Block {args.block_id} -> {args.status}")

def cmd_intel(args):
    r = post("/api/agent/intel", {"title": args.title, "domain": args.domain,
        "situation": args.situation, "my_move": args.move, "outcome": args.outcome,
        "verdict": args.verdict, "people": args.people, "log_date": now_date()})
    print(f"Intel filed (id {r['id']}). The record grows.")

def cmd_journal(args):
    post("/api/agent/debrief", {"date": now_date(), "wins": args.wins, "breaks": args.breaks,
        "tomorrow_targets": args.targets, "strategy_insight": args.insight,
        "sleep_hours": args.sleep_hours, "mood": args.mood, "energy": args.energy})
    print("Debrief updated (merged, marked [HERMES]).")

def cmd_say(args):
    post("/api/agent/message", {"content": args.message, "role": args.role})
    print("Posted to the Council log.")

def cmd_export(args):
    print(json.dumps(get("/api/agent/export"), indent=2))

p = argparse.ArgumentParser(description="Hermes Bridge — War Room connector")
sub = p.add_subparsers(dest="cmd", required=True)
sub.add_parser("briefing").set_defaults(fn=cmd_briefing)
sub.add_parser("pending").set_defaults(fn=cmd_pending)
sub.add_parser("watch").set_defaults(fn=cmd_watch)
d = sub.add_parser("done"); d.add_argument("block_id"); d.add_argument("--status", default="done"); d.add_argument("--note", default=None); d.set_defaults(fn=cmd_done)
i = sub.add_parser("intel"); i.add_argument("title"); i.add_argument("-d", "--domain", default="other")
i.add_argument("-s", "--situation", default=None); i.add_argument("-m", "--move", default=None)
i.add_argument("-o", "--outcome", default=None); i.add_argument("-v", "--verdict", default="pending")
i.add_argument("-p", "--people", default=None); i.set_defaults(fn=cmd_intel)
j = sub.add_parser("journal"); j.add_argument("--wins"); j.add_argument("--breaks"); j.add_argument("--targets")
j.add_argument("--insight"); j.add_argument("--sleep-hours", type=float, dest="sleep_hours")
j.add_argument("--mood", type=int); j.add_argument("--energy", type=int); j.set_defaults(fn=cmd_journal)
s = sub.add_parser("say"); s.add_argument("message"); s.add_argument("--role", default="assistant"); s.set_defaults(fn=cmd_say)
sub.add_parser("export").set_defaults(fn=cmd_export)

args = p.parse_args()
args.fn(args)
