"""
Vision Zero crash-risk web app (Flask backend).

Routes
------
GET /                 -> the single-page app (index.html)
GET /api/risk         -> risk.geojson (hexagons with risk + location names)
GET /api/locations    -> ranked list of locations; supports ?q= search & ?limit=
GET /api/stats        -> summary stats for the dashboard header

Run:  python3 app.py   (regenerates risk.geojson on first run if missing)
Then: open http://localhost:8777
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

HERE = Path(__file__).parent
GEOJSON = HERE / "risk.geojson"
PORT = 8777

app = Flask(__name__, static_folder=None)

_cache: dict | None = None


def load_features() -> list[dict]:
    """Load risk.geojson, generating it via predict.py if it's missing."""
    global _cache
    if _cache is not None:
        return _cache
    if not GEOJSON.exists():
        print("risk.geojson not found — running predict.py to build it...")
        subprocess.run([sys.executable, str(HERE / "predict.py")], check=True)
    gj = json.loads(GEOJSON.read_text())
    _cache = gj["features"]
    return _cache


@app.route("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.route("/api/risk")
def api_risk():
    # Serve the raw GeoJSON for the map layer.
    return send_from_directory(HERE, "risk.geojson", mimetype="application/json")


@app.route("/api/locations")
def api_locations():
    """Ranked, searchable list of locations for the sidebar."""
    q = (request.args.get("q") or "").strip().lower()
    limit = int(request.args.get("limit", 100))

    rows = []
    for f in load_features():
        p = f["properties"]
        rows.append({
            "hex": p["hex"],
            "label": p.get("label", "Unknown location"),
            "risk_yr": p.get("risk_yr", 0),
            "risk_norm": p.get("risk_norm", 0),
            "lat": p.get("lat"),
            "lng": p.get("lng"),
            "total_crashes": p.get("total_crashes", 0),
            "mv": p.get("mv", 0),
            "ped": p.get("ped", 0),
            "bike": p.get("bike", 0),
        })

    if q:
        rows = [r for r in rows if q in r["label"].lower()]
    rows.sort(key=lambda r: r["risk_yr"], reverse=True)
    return jsonify({"count": len(rows), "results": rows[:limit]})


@app.route("/api/stats")
def api_stats():
    feats = load_features()
    total_hist = sum(f["properties"].get("total_crashes", 0) for f in feats)
    risks = sorted((f["properties"].get("risk_yr", 0) for f in feats), reverse=True)
    mv = sum(f["properties"].get("mv", 0) for f in feats)
    ped = sum(f["properties"].get("ped", 0) for f in feats)
    bike = sum(f["properties"].get("bike", 0) for f in feats)
    return jsonify({
        "hexagons": len(feats),
        "historical_crashes": total_hist,
        "top_risk_yr": risks[0] if risks else 0,
        "by_mode": {"mv": mv, "ped": ped, "bike": bike},
    })


if __name__ == "__main__":
    load_features()  # warm cache / build geojson up front
    print(f"\nVision Zero crash-risk app running at http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
