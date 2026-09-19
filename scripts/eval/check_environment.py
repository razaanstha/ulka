"""Check actual fixture outcomes across seeds; report runtime latency, not model success."""
import argparse
import json
import math
import time
from browser_env import BrowserEnvironment

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seeds", nargs="+", type=int, default=[17])
args = parser.parse_args()
names = ["Cedar", "Maple", "Willow", "Birch", "Aspen", "Juniper", "Elm"]
env = BrowserEnvironment()
results = []
try:
    for seed in args.seeds:
        wanted, other = names[abs(seed) % len(names)], names[(abs(seed) + 1) % len(names)]
        for family in ["context-click", "form-fill", "select", "checkbox", "delayed-editor"]:
            initial = json.loads(env.reset(family=family, seed=seed))
            assert not env.success, f"{family}:{seed}: unearned initial success"
            elements = initial["observation"]["elements"]
            started = time.perf_counter()
            if family == "context-click":
                desired = next(e for e in elements if e["label"] == "Save" and any(c.get("label") == f"{wanted} project" for c in e.get("context", [])))
                env.browser_action("CLICK", desired["id"])
            elif family == "form-fill":
                desired = next(e for e in elements if e["label"] == f"{wanted} draft")
                env.browser_action("TYPE_TEXT", desired["id"], f"draft-{abs(seed)}")
            elif family == "select":
                desired = next(e for e in elements if e["role"] == "combobox")
                option = next(o for o in desired["options"] if o["label"] == wanted)
                env.browser_action("SELECT", desired["id"] + ":" + option["id"])
            elif family == "checkbox":
                desired = next(e for e in elements if e["label"] == f"{wanted} alerts")
                env.browser_action("CLICK", desired["id"])
            else:
                next_state = json.loads(env.browser_action("CLICK", elements[0]["id"]))
                desired = next((e for e in next_state["observation"]["elements"] if e["label"] == "Draft"), None)
                if desired is None:
                    results.append({"family": family, "seed": seed, "success": False, "reason": "Editor absent after initial action wait", "action_ms": round((time.perf_counter() - started) * 1000, 1)})
                    continue
                env.browser_action("TYPE_TEXT", desired["id"], f"draft-{abs(seed)}")
            assert env.success, f"{family}:{seed}: correct state must earn success"
            results.append({"family": family, "seed": seed, "success": True, "action_ms": round((time.perf_counter() - started) * 1000, 1)})
        initial = json.loads(env.reset(family="context-click", seed=seed))
        wrong = next(e for e in initial["observation"]["elements"] if e["label"] == "Save" and any(c.get("label") == f"{other} project" for c in e.get("context", [])))
        env.browser_action("CLICK", wrong["id"])
        assert not env.success, "Wrong project must never earn success"
        env.browser_action("DONE")
        assert not env.success, "Claiming DONE must never earn success"
        try:
            env.browser_action("CLICK", wrong["id"])
            raise AssertionError("Terminal episode accepted another action")
        except ValueError:
            pass
    latency = sorted(result["action_ms"] for result in results)
    print(json.dumps({"scope": "scripted runtime fixtures, no model calls", "checks": results,
        "latency_ms": {"p50": latency[math.ceil(len(latency) * .5) - 1], "p95": latency[math.ceil(len(latency) * .95) - 1]},
        "wrong_action_success": 0, "false_completion_success": 0}, indent=2))
finally:
    env._close()
if any(not result["success"] for result in results):
    raise SystemExit(1)
