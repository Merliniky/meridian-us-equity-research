"""Python 3 standard-library example: consistent, read-only research inputs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

CLI = os.environ.get("MERIDIAN_CLI", str(Path(__file__).resolve().parents[1] / "bin" / "meridian.mjs"))

def meridian(*args):
    result = subprocess.run(["node", CLI, *args], capture_output=True, text=True, timeout=1200, check=False)
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("CLI did not return JSON; check Node.js and MERIDIAN_CLI") from exc
    if result.returncode != 0 or not response.get("ok"):
        raise RuntimeError(json.dumps({"exitCode": result.returncode, "error": response.get("error")}, ensure_ascii=False))
    return response

def research(symbol="NVDA", period="medium", min_date=None, refresh=False):
    # Refresh is an explicit opt-in; ordinary reads do not mutate shared data.
    freshness = ["--min-date", min_date] if min_date else []
    if refresh:
        meridian("refresh", "--strict", *freshness)
    with tempfile.TemporaryDirectory(prefix="meridian-agent-") as directory:
        snapshot = str(Path(directory) / "research.json")
        saved = meridian("snapshot", "--output", snapshot, *freshness)
        common = ["--snapshot", snapshot, "--strict", *freshness]
        macro = meridian("macro", *common)
        stock = meridian("stock", symbol, "--period", period, *common)
        ranking = meridian("rank", "--period", period, "--limit", "20", *common)
        return {
            "snapshotId": saved["meta"]["snapshotId"],
            "priceAsOf": saved["meta"]["priceAsOf"],
            "macroAsOf": saved["meta"]["macroAsOf"],
            "universeAsOf": saved["meta"]["universeAsOf"],
            "warnings": saved["meta"]["sourceWarnings"],
            "macro": macro["data"],
            "stock": stock["data"],
            "ranking": ranking["data"],
        }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="NVDA")
    parser.add_argument("--period", choices=["short", "medium", "long"], default="medium")
    parser.add_argument("--min-date")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    print(json.dumps(research(args.symbol, args.period, args.min_date, args.refresh), ensure_ascii=False))
