"""
Vision Zero crash risk model — combined spatial (A) + spatiotemporal (B) framing.

What it does
------------
1. Loads Boston Vision Zero crash records (data.csv).
2. Bins every crash into an H3 hexagon (WHERE) and a month (WHEN).
3. Builds a complete hex x month panel so zero-crash cells become real
   negative examples (not just the places that already had crashes).
4. Engineers spatial + temporal + mode features.
5. Trains a Poisson gradient-boosted model to predict crash COUNT per
   hex-month (risk), training on the past and testing on the held-out future.
6. Scores the risk of each hexagon for a chosen future month and exports
   risk.geojson for mapping.

Run:  python3 predict.py
Then: open map.html  (loads risk.geojson)
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_poisson_deviance

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
HERE = Path(__file__).parent
# The crash dataset lives in the sibling vision-zero/ folder (dataset only);
# generated artifacts (risk.geojson, geocache.json) live here next to the code.
DATA_DIR = HERE.parent / "vision-zero"
DATA = DATA_DIR / "data.csv"
OUT_GEOJSON = HERE / "risk.geojson"

H3_RES = 9            # ~0.10 km^2 hexes (finer). res 8 coarser, res 10 finer.
TRAIN_END = "2024-12-31"   # train on <= this date, test on what comes after
MODES = ["mv", "ped", "bike"]


# ----------------------------------------------------------------------------
# 1. Load + clean
# ----------------------------------------------------------------------------
def load_crashes() -> pd.DataFrame:
    df = pd.read_csv(DATA)
    df["when"] = pd.to_datetime(df["when"], utc=True, errors="coerce")
    df = df.dropna(subset=["when", "latitude", "longitude"])
    # Keep Boston-ish bounding box; drop obvious junk coordinates.
    df = df[
        df["latitude"].between(42.20, 42.45)
        & df["longitude"].between(-71.20, -70.98)
    ].copy()
    df["hex"] = [
        h3.latlng_to_cell(lat, lng, H3_RES)
        for lat, lng in zip(df["latitude"], df["longitude"])
    ]
    # Floor each timestamp to the first of its month (tz-naive).
    df["month"] = df["when"].dt.tz_localize(None).values.astype("datetime64[M]")
    df["month"] = pd.to_datetime(df["month"])
    return df


# ----------------------------------------------------------------------------
# 1b. Human-readable location label per hexagon (from the CSV street data)
# ----------------------------------------------------------------------------
def _row_label(r: pd.Series) -> str:
    """Build a readable place name from a crash row's street fields."""
    def clean(x):
        return str(x).strip().title() if pd.notna(x) and str(x).strip() else ""

    street = clean(r.get("street"))
    x1 = clean(r.get("cross_street"))
    x2 = clean(r.get("cross_street_2"))
    crosses = [c for c in (x1, x2) if c and "Ramp" not in c]
    if street and crosses:
        return f"{street} @ {crosses[0]}"
    if street:
        return street
    if len(crosses) >= 2:
        return f"{crosses[0]} @ {crosses[1]}"
    if crosses:
        return crosses[0]
    return "Unknown location"


# --- OpenStreetMap Nominatim reverse geocoding (free, no key) -----------------
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
GEOCACHE = HERE / "geocache.json"
# Nominatim usage policy: <= 1 request/second, identify yourself via User-Agent.
NOMINATIM_UA = "HackachusettsVisionZero/1.0 (crash-risk demo)"


def _load_geocache() -> dict:
    if GEOCACHE.exists():
        try:
            return json.loads(GEOCACHE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _osm_name(addr: dict) -> str:
    """Turn a Nominatim address object into a short, readable place name."""
    road = addr.get("road") or addr.get("pedestrian") or addr.get("footway")
    area = (addr.get("neighbourhood") or addr.get("suburb")
            or addr.get("city_district") or addr.get("quarter"))
    if road and area:
        return f"{road}, {area}"
    if road:
        return road
    if area:
        return area
    return addr.get("city") or "Unknown location"


def reverse_geocode_hexes(coords: dict[str, tuple[float, float]]) -> dict[str, str]:
    """Reverse-geocode each hex centroid via OSM Nominatim, with disk caching.

    coords: {hex_id: (lat, lng)}. Returns {hex_id: osm_label}.
    Cached results are reused, so this only pays the ~1 req/sec cost once.
    """
    import time
    import urllib.parse
    import urllib.request

    cache = _load_geocache()
    todo = [h for h in coords if h not in cache]
    if todo:
        print(f"  reverse-geocoding {len(todo)} new hexes via OSM Nominatim "
              f"(~{len(todo)}s, respecting 1 req/sec)...")
    for i, hx in enumerate(todo, 1):
        lat, lng = coords[hx]
        qs = urllib.parse.urlencode({
            "lat": f"{lat:.6f}", "lon": f"{lng:.6f}",
            "format": "jsonv2", "zoom": "17", "addressdetails": "1",
        })
        req = urllib.request.Request(
            f"{NOMINATIM_URL}?{qs}", headers={"User-Agent": NOMINATIM_UA}
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read())
            cache[hx] = _osm_name(data.get("address", {}))
        except Exception as e:  # network/timeout/etc. — leave for CSV fallback
            cache[hx] = ""
            if i <= 3:
                print(f"    warn: geocode failed for {hx}: {e}")
        time.sleep(1.1)  # stay under Nominatim's 1 req/sec limit
        if i % 50 == 0:
            GEOCACHE.write_text(json.dumps(cache))  # checkpoint
            print(f"    {i}/{len(todo)} geocoded...")
    GEOCACHE.write_text(json.dumps(cache))
    return cache


def hex_labels(df: pd.DataFrame, geocode: bool = True) -> pd.DataFrame:
    """For each hex: a location label + crash stats by mode.

    Labels come from OpenStreetMap Nominatim (reverse-geocoded hex centroids),
    falling back to the CSV street fields when OSM has no useful name.
    """
    df = df.copy()
    df["label_csv"] = df.apply(_row_label, axis=1)

    rows = []
    coords = {}
    for hx, g in df.groupby("hex"):
        vc = g["label_csv"][g["label_csv"] != "Unknown location"].value_counts()
        csv_label = vc.index[0] if len(vc) else "Unknown location"
        modes = g["mode"].value_counts().to_dict()
        lat, lng = h3.cell_to_latlng(hx)
        coords[hx] = (lat, lng)
        rows.append({
            "hex": hx,
            "label_csv": csv_label,
            "total_crashes": int(len(g)),
            "mv": int(modes.get("mv", 0)),
            "ped": int(modes.get("ped", 0)),
            "bike": int(modes.get("bike", 0)),
            "first": g["when"].min().date().isoformat(),
            "last": g["when"].max().date().isoformat(),
        })

    out = pd.DataFrame(rows).set_index("hex")

    # Primary label from OSM; fall back to the CSV-derived name.
    osm = reverse_geocode_hexes(coords) if geocode else {}
    out["label_osm"] = out.index.map(lambda h: osm.get(h, "") or "")
    out["label"] = [
        o if o and o != "Unknown location" else c
        for o, c in zip(out["label_osm"], out["label_csv"])
    ]
    return out


# ----------------------------------------------------------------------------
# 2. Build the complete hex x month panel (this is the key step)
# ----------------------------------------------------------------------------
def build_panel(df: pd.DataFrame) -> pd.DataFrame:
    hexes = sorted(df["hex"].unique())
    months = pd.date_range(df["month"].min(), df["month"].max(), freq="MS")

    # counts per hex-month-mode
    counts = (
        df.groupby(["hex", "month", "mode"]).size().rename("n").reset_index()
    )
    wide = (
        counts.pivot_table(
            index=["hex", "month"], columns="mode", values="n", fill_value=0
        )
        .reset_index()
    )
    for m in MODES:
        if m not in wide.columns:
            wide[m] = 0
    wide["crashes"] = wide[MODES].sum(axis=1)

    # full grid: every hex x every month (fills in the zeros = negatives)
    full = pd.MultiIndex.from_product(
        [hexes, months], names=["hex", "month"]
    ).to_frame(index=False)
    panel = full.merge(wide, on=["hex", "month"], how="left").fillna(0)
    for c in MODES + ["crashes"]:
        panel[c] = panel[c].astype(int)
    return panel.sort_values(["hex", "month"]).reset_index(drop=True)


# ----------------------------------------------------------------------------
# 3. Feature engineering: spatial (A) + temporal (B)
# ----------------------------------------------------------------------------
def add_features(panel: pd.DataFrame) -> pd.DataFrame:
    p = panel.copy()

    # --- WHEN (framing B): cyclical time so Dec is "next to" Jan ---
    p["month_num"] = p["month"].dt.month
    p["year"] = p["month"].dt.year
    p["month_sin"] = np.sin(2 * np.pi * p["month_num"] / 12)
    p["month_cos"] = np.cos(2 * np.pi * p["month_num"] / 12)
    # winter months tend to differ (weather, daylight)
    p["is_winter"] = p["month_num"].isin([12, 1, 2]).astype(int)
    # NOTE: deliberately NO raw time-trend index as a feature. A monotonic
    # t_index forces the model to extrapolate outside its training range when
    # forecasting the future, which collapses predictions. The temporal signal
    # is carried by seasonality (month_sin/cos, is_winter) plus the rolling
    # history features, which stay in-range because they update over time.

    # --- WHERE (framing A): hex centroid coordinates ---
    centro = {hx: h3.cell_to_latlng(hx) for hx in p["hex"].unique()}
    p["lat"] = p["hex"].map(lambda h: centro[h][0])
    p["lng"] = p["hex"].map(lambda h: centro[h][1])

    # --- Per-hex history (leak-free: only uses the PAST of each hex) ---
    p = p.sort_values(["hex", "month"]).reset_index(drop=True)
    g = p.groupby("hex")["crashes"]
    # trailing 12-month crash rate for this hex, shifted so it excludes "now"
    p["hex_roll12"] = (
        g.transform(lambda s: s.shift(1).rolling(12, min_periods=1).mean())
    ).fillna(0)
    # cumulative mean up to (but not including) this month
    p["hex_expanding"] = (
        g.transform(lambda s: s.shift(1).expanding().mean())
    ).fillna(0)
    p["hex_last"] = g.transform(lambda s: s.shift(1)).fillna(0)

    # --- Spatial neighborhood risk (framing A smoothing) ---
    # mean of each hex's overall history spread to its ring-1 neighbors.
    hex_hist = p.groupby("hex")["crashes"].mean().to_dict()
    neigh_score = {}
    for hx in hex_hist:
        ring = h3.grid_disk(hx, 1)
        vals = [hex_hist[n] for n in ring if n in hex_hist and n != hx]
        neigh_score[hx] = float(np.mean(vals)) if vals else 0.0
    p["neighbor_hist"] = p["hex"].map(neigh_score)

    return p


FEATURES = [
    "lat", "lng",
    "month_sin", "month_cos", "is_winter",
    "hex_roll12", "hex_expanding", "hex_last", "neighbor_hist",
]


# ----------------------------------------------------------------------------
# 4. Train / evaluate (past -> future split)
# ----------------------------------------------------------------------------
def train(panel: pd.DataFrame):
    train_end = pd.Timestamp(TRAIN_END, tz=None)
    tr = panel[panel["month"] <= train_end]
    te = panel[panel["month"] > train_end]

    X_tr, y_tr = tr[FEATURES], tr["crashes"]
    X_te, y_te = te[FEATURES], te["crashes"]

    model = HistGradientBoostingRegressor(
        loss="poisson",          # correct objective for count data
        max_iter=400,
        learning_rate=0.05,
        max_depth=6,
        l2_regularization=1.0,
        random_state=42,
    )
    model.fit(X_tr, y_tr)

    # Evaluate on the held-out future.
    pred_te = np.clip(model.predict(X_te), 1e-6, None)

    # Baseline: predict each hex's own training-period average every month.
    hex_mean = tr.groupby("hex")["crashes"].mean()
    base_vals = np.clip(te["hex"].map(hex_mean).fillna(y_tr.mean()).values, 1e-6, None)

    model_dev = mean_poisson_deviance(y_te, pred_te)
    base_dev = mean_poisson_deviance(y_te, base_vals)

    # Ranking quality: do predicted-risky hexes actually get more crashes?
    te_eval = te.copy()
    te_eval["pred"] = pred_te
    ranked = te_eval.groupby("hex").agg(pred=("pred", "mean"),
                                        actual=("crashes", "sum"))
    top_decile = ranked.nlargest(max(1, len(ranked) // 10), "pred")
    capture = top_decile["actual"].sum() / ranked["actual"].sum()

    print("\n=== Held-out future evaluation (test = after "
          f"{TRAIN_END}) ===")
    print(f"test rows (hex-months): {len(te):,}")
    print(f"Poisson deviance  model : {model_dev:.4f}")
    print(f"Poisson deviance  base  : {base_dev:.4f}  "
          f"(lower is better; model should beat baseline)")
    improvement = (base_dev - model_dev) / base_dev * 100
    print(f"improvement over baseline: {improvement:.1f}%")
    print(f"top-10% riskiest hexes captured {capture*100:.1f}% of "
          "actual future crashes")

    # Feature importance via permutation-free proxy: refit on all data.
    full_model = HistGradientBoostingRegressor(
        loss="poisson", max_iter=400, learning_rate=0.05,
        max_depth=6, l2_regularization=1.0, random_state=42,
    )
    full_model.fit(panel[FEATURES], panel["crashes"])
    return full_model


# ----------------------------------------------------------------------------
# 5. Score a future month -> GeoJSON risk layer
# ----------------------------------------------------------------------------
def score_future(panel: pd.DataFrame, model, labels: pd.DataFrame | None = None) -> pd.DataFrame:
    """Predict risk for the month right after the data ends, per hex."""
    last_month = panel["month"].max()
    future = last_month + pd.offsets.MonthBegin(1)

    # take the most recent row per hex as the feature template, roll time fwd
    latest = (
        panel.sort_values("month").groupby("hex").tail(1).copy()
    )

    # Recompute history features AS OF the end of data (looking into `future`),
    # so they reflect everything we actually observed up to last_month. The
    # stored values on this row excluded last_month itself (they were shifted),
    # so recompute them to include the full observed history.
    g = panel.groupby("hex")["crashes"]
    roll12 = g.apply(lambda s: s.tail(12).mean()).to_dict()
    last_obs = g.apply(lambda s: s.iloc[-1]).to_dict()
    expand = g.mean().to_dict()
    latest["hex_roll12"] = latest["hex"].map(roll12).fillna(0)
    latest["hex_last"] = latest["hex"].map(last_obs).fillna(0)
    latest["hex_expanding"] = latest["hex"].map(expand).fillna(0)

    latest["month"] = future
    latest = add_time_only(latest, future, base_year=panel["year"].min())

    latest["risk"] = np.clip(model.predict(latest[FEATURES]), 0, None)
    latest["risk_yr"] = latest["risk"] * 12  # expected crashes/year, readable
    # normalize 0..1 for color scaling on the map
    mx = latest["risk"].max() or 1.0
    latest["risk_norm"] = latest["risk"] / mx
    cols = ["hex", "lat", "lng", "risk", "risk_yr", "risk_norm"]
    out = latest[cols].copy()
    if labels is not None:
        out = out.merge(labels, left_on="hex", right_index=True, how="left")
        out["label"] = out["label"].fillna("Unknown location")
        for c in ["total_crashes", "mv", "ped", "bike"]:
            out[c] = out[c].fillna(0).astype(int)

    print(f"\nScored {len(latest):,} hexagons for {future.date()}")
    print(f"  riskiest hex: {latest['risk_yr'].max():.1f} expected crashes/year")
    return out


def add_time_only(df: pd.DataFrame, month: pd.Timestamp, base_year: int):
    df = df.copy()
    mn = month.month
    df["month_num"] = mn
    df["year"] = month.year
    df["month_sin"] = math.sin(2 * math.pi * mn / 12)
    df["month_cos"] = math.cos(2 * math.pi * mn / 12)
    df["is_winter"] = int(mn in (12, 1, 2))
    return df


def export_geojson(scored: pd.DataFrame):
    feats = []
    for _, r in scored.iterrows():
        boundary = h3.cell_to_boundary(r["hex"])  # list of (lat, lng)
        ring = [[lng, lat] for lat, lng in boundary]
        ring.append(ring[0])
        props = {
            "hex": r["hex"],
            "risk": round(float(r["risk"]), 4),
            "risk_yr": round(float(r["risk_yr"]), 2),
            "risk_norm": round(float(r["risk_norm"]), 4),
            "lat": round(float(r["lat"]), 6),
            "lng": round(float(r["lng"]), 6),
        }
        for key in ("label", "label_osm", "label_csv",
                    "total_crashes", "mv", "ped", "bike", "first", "last"):
            if key in r and pd.notna(r[key]):
                props[key] = r[key] if not isinstance(r[key], (np.integer,)) else int(r[key])
        feats.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    fc = {"type": "FeatureCollection", "features": feats}
    OUT_GEOJSON.write_text(json.dumps(fc))
    print(f"wrote {OUT_GEOJSON.name} ({len(feats)} hexagons)")


# ----------------------------------------------------------------------------
def main():
    print("Loading crashes...")
    df = load_crashes()
    print(f"  {len(df):,} valid crashes, "
          f"{df['when'].min().date()} -> {df['when'].max().date()}")

    print("Building hex x month panel...")
    panel = build_panel(df)
    panel = add_features(panel)
    print(f"  panel: {len(panel):,} hex-month rows, "
          f"{panel['hex'].nunique():,} hexagons")

    print("Computing location labels...")
    labels = hex_labels(df)

    print("Training Poisson risk model...")
    model = train(panel)

    scored = score_future(panel, model, labels)
    export_geojson(scored)
    print("\nDone. Run `python3 app.py` and open http://localhost:8777")


if __name__ == "__main__":
    main()
