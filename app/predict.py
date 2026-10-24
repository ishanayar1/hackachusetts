"""
Vision Zero crash risk model — combined spatial (A) + spatiotemporal (B) framing.

What it does
------------
1. Loads Boston Vision Zero crash records (data.csv).
2. Keys every intersection crash to its intersection site (WHERE: the two
   crossing street names, split by location when a name pair repeats) and
   a month (WHEN).
3. Builds a complete site x month panel so zero-crash months become real
   negative examples.
4. Engineers spatial + temporal features.
5. Trains a Poisson gradient-boosted model to predict crash COUNT per
   site-month (risk), training on the past and testing on the held-out future.
6. Scores the risk of each intersection for the next month and exports
   risk.geojson (one Point per intersection) for mapping.

Run:  python3 predict.py
Then: python3 app.py  and open http://localhost:8777
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_poisson_deviance
from sklearn.neighbors import BallTree

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
HERE = Path(__file__).parent
# The crash dataset lives in the sibling vision-zero/ folder (dataset only);
# generated artifacts (risk.geojson, geocache.json) live here next to the code.
DATA_DIR = HERE.parent / "vision-zero"
DATA = DATA_DIR / "data.csv"
OUT_GEOJSON = HERE / "risk.geojson"

TRAIN_END = "2024-12-31"   # train on <= this date, test on what comes after
MODES = ["mv", "ped", "bike"]
SITE_SPLIT_M = 150    # same street-name pair farther apart than this = different intersections
NEIGHBOR_M = 300      # radius for the neighbor-risk feature
TZ = "America/New_York"


# ----------------------------------------------------------------------------
# 1. Load + clean: one row per intersection crash, keyed by intersection site
# ----------------------------------------------------------------------------
def intersection_key(a: str, b: str) -> str:
    """Order/case/space-insensitive name for the intersection of streets a and b."""
    return " & ".join(sorted(s.strip().upper() for s in (a, b)))


def assign_sites(df: pd.DataFrame) -> pd.Series:
    """Site id per crash: the intersection name, split by location when one
    name pair occurs in several places (e.g. Washington St in two neighborhoods)."""
    site = df["name"].copy()
    for name, g in df.groupby("name"):
        if len(g) < 2:
            continue
        labels = DBSCAN(eps=SITE_SPLIT_M / 6_371_000, min_samples=1,
                        metric="haversine").fit_predict(
            np.radians(g[["latitude", "longitude"]].to_numpy()))
        if labels.max() == 0:
            continue
        # number clusters by size, largest first
        order = pd.Series(labels).value_counts().index
        rank = {lab: i + 1 for i, lab in enumerate(order)}
        site.loc[g.index] = [f"{name} #{rank[lab]}" for lab in labels]
    return site


def load_crashes(path: Path = DATA) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["when"] = pd.to_datetime(df["when"], utc=True, errors="coerce")
    df = df.dropna(subset=["when", "latitude", "longitude"])
    # Keep Boston-ish bounding box; drop obvious junk coordinates.
    df = df[
        df["latitude"].between(42.20, 42.45)
        & df["longitude"].between(-71.20, -70.98)
    ]
    # Intersection rows carry the two crossing streets in cross_street(_2);
    # mid-block ("Street") and "Other" rows have no intersection to predict.
    a = df["cross_street"].fillna("").astype(str).str.strip()
    b = df["cross_street_2"].fillna("").astype(str).str.strip()
    df = df[(df["where"] == "Intersection") & (a != "") & (b != "")].copy()
    df["name"] = [intersection_key(x, y) for x, y in
                  zip(df["cross_street"], df["cross_street_2"])]
    df["site"] = assign_sites(df)
    df["local"] = df["when"].dt.tz_convert(TZ)
    # Floor each timestamp to the first of its month (tz-naive).
    df["month"] = df["when"].dt.tz_localize(None).values.astype("datetime64[M]")
    df["month"] = pd.to_datetime(df["month"])
    return df


GEOCACHE = HERE / "geocache.json"   # cached OSM Nominatim labels per H3 res-9 cell


def _load_geocache() -> dict:
    if GEOCACHE.exists():
        try:
            return json.loads(GEOCACHE.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def neighborhood_for(lat: float, lng: float, cache: dict) -> str:
    """Neighborhood from the cached OSM label ("road, neighborhood") of the H3 res-9 cell."""
    label = cache.get(h3.latlng_to_cell(lat, lng, 9), "")
    return label.rsplit(", ", 1)[1] if ", " in label else ""


def site_info(df: pd.DataFrame) -> pd.DataFrame:
    """Per intersection: display name, location, crash stats, and when crashes happen."""
    cache = _load_geocache()
    cutoff = df["month"].max() - pd.DateOffset(months=11)   # last 12 months of data
    rows = []
    for site, g in df.groupby("site"):
        modes = g["mode"].value_counts()
        lat, lng = float(g["latitude"].median()), float(g["longitude"].median())
        rows.append({
            "site": site,
            "label": g["name"].iloc[0].title(),
            "neighborhood": neighborhood_for(lat, lng, cache),
            "lat": lat,
            "lng": lng,
            "total_crashes": len(g),
            "mv": int(modes.get("mv", 0)),
            "ped": int(modes.get("ped", 0)),
            "bike": int(modes.get("bike", 0)),
            "last12": int((g["month"] >= cutoff).sum()),
            "peak_hour": int(g["local"].dt.hour.mode().iloc[0]),
            "peak_day": DAYS[int(g["local"].dt.day_of_week.mode().iloc[0])],
            "first": g["when"].min().date().isoformat(),
            "last": g["when"].max().date().isoformat(),
        })
    return pd.DataFrame(rows).set_index("site")


# ----------------------------------------------------------------------------
# 2. Build the complete site x month panel (this is the key step)
# ----------------------------------------------------------------------------
def build_panel(df: pd.DataFrame) -> pd.DataFrame:
    sites = sorted(df["site"].unique())
    months = pd.date_range(df["month"].min(), df["month"].max(), freq="MS")

    # counts per site-month-mode
    counts = (
        df.groupby(["site", "month", "mode"]).size().rename("n").reset_index()
    )
    wide = (
        counts.pivot_table(
            index=["site", "month"], columns="mode", values="n", fill_value=0
        )
        .reset_index()
    )
    for m in MODES:
        if m not in wide.columns:
            wide[m] = 0
    wide["crashes"] = wide[MODES].sum(axis=1)

    # full grid: every site x every month (fills in the zeros = negatives)
    full = pd.MultiIndex.from_product(
        [sites, months], names=["site", "month"]
    ).to_frame(index=False)
    panel = full.merge(wide, on=["site", "month"], how="left").fillna(0)
    for c in MODES + ["crashes"]:
        panel[c] = panel[c].astype(int)
    return panel.sort_values(["site", "month"]).reset_index(drop=True)


# ----------------------------------------------------------------------------
# 3. Feature engineering: spatial (A) + temporal (B)
# ----------------------------------------------------------------------------
def add_features(panel: pd.DataFrame, info: pd.DataFrame) -> pd.DataFrame:
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

    # --- WHERE (framing A): intersection coordinates ---
    p["lat"] = p["site"].map(info["lat"])
    p["lng"] = p["site"].map(info["lng"])

    # --- Per-site history (leak-free: only uses the PAST of each site) ---
    p = p.sort_values(["site", "month"]).reset_index(drop=True)
    g = p.groupby("site")["crashes"]
    # trailing 12-month crash rate for this site, shifted so it excludes "now"
    p["site_roll12"] = (
        g.transform(lambda s: s.shift(1).rolling(12, min_periods=1).mean())
    ).fillna(0)
    # cumulative mean up to (but not including) this month
    p["site_expanding"] = (
        g.transform(lambda s: s.shift(1).expanding().mean())
    ).fillna(0)
    p["site_last"] = g.transform(lambda s: s.shift(1)).fillna(0)

    # --- Spatial neighborhood risk (framing A smoothing) ---
    # mean training-period crash rate of the OTHER intersections within
    # NEIGHBOR_M (training months only, so the test period does not leak in).
    rate = (p[p["month"] <= pd.Timestamp(TRAIN_END)].groupby("site")["crashes"]
            .mean().reindex(info.index).fillna(0).to_numpy())
    pts = np.radians(info[["lat", "lng"]].to_numpy())
    nbrs = BallTree(pts, metric="haversine").query_radius(pts, r=NEIGHBOR_M / 6_371_000)
    neigh_score = {
        site: float(rate[idx[idx != i]].mean()) if len(idx) > 1 else 0.0
        for i, (site, idx) in enumerate(zip(info.index, nbrs))
    }
    p["neighbor_hist"] = p["site"].map(neigh_score)

    return p


FEATURES = [
    "lat", "lng",
    "month_sin", "month_cos", "is_winter",
    "site_roll12", "site_expanding", "site_last", "neighbor_hist",
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

    # Baseline: predict each site's own training-period average every month.
    site_mean = tr.groupby("site")["crashes"].mean()
    base_vals = np.clip(te["site"].map(site_mean).fillna(y_tr.mean()).values, 1e-6, None)

    model_dev = mean_poisson_deviance(y_te, pred_te)
    base_dev = mean_poisson_deviance(y_te, base_vals)

    # Ranking quality: do predicted-risky intersections actually get more crashes?
    te_eval = te.copy()
    te_eval["pred"] = pred_te
    ranked = te_eval.groupby("site").agg(pred=("pred", "mean"),
                                        actual=("crashes", "sum"))
    top_decile = ranked.nlargest(max(1, len(ranked) // 10), "pred")
    capture = top_decile["actual"].sum() / ranked["actual"].sum()

    print("\n=== Held-out future evaluation (test = after "
          f"{TRAIN_END}) ===")
    print(f"test rows (site-months): {len(te):,}")
    print(f"Poisson deviance  model : {model_dev:.4f}")
    print(f"Poisson deviance  base  : {base_dev:.4f}  "
          f"(lower is better; model should beat baseline)")
    improvement = (base_dev - model_dev) / base_dev * 100
    print(f"improvement over baseline: {improvement:.1f}%")
    print(f"top-10% riskiest intersections captured {capture*100:.1f}% of "
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
def score_future(panel: pd.DataFrame, model, info: pd.DataFrame) -> pd.DataFrame:
    """Predict risk for the month right after the data ends, per intersection."""
    last_month = panel["month"].max()
    future = last_month + pd.offsets.MonthBegin(1)

    # take the most recent row per site as the feature template, roll time fwd
    latest = (
        panel.sort_values("month").groupby("site").tail(1).copy()
    )

    # Recompute history features AS OF the end of data (looking into `future`),
    # so they reflect everything we actually observed up to last_month. The
    # stored values on this row excluded last_month itself (they were shifted),
    # so recompute them to include the full observed history.
    g = panel.groupby("site")["crashes"]
    roll12 = g.apply(lambda s: s.tail(12).mean()).to_dict()
    last_obs = g.apply(lambda s: s.iloc[-1]).to_dict()
    expand = g.mean().to_dict()
    latest["site_roll12"] = latest["site"].map(roll12).fillna(0)
    latest["site_last"] = latest["site"].map(last_obs).fillna(0)
    latest["site_expanding"] = latest["site"].map(expand).fillna(0)

    latest["month"] = future
    latest = add_time_only(latest, future, base_year=panel["year"].min())

    latest["risk"] = np.clip(model.predict(latest[FEATURES]), 0, None)
    latest["risk_yr"] = latest["risk"] * 12  # expected crashes/year, readable
    # normalize 0..1 for color scaling on the map
    mx = latest["risk"].max() or 1.0
    latest["risk_norm"] = latest["risk"] / mx
    out = latest[["site", "risk", "risk_yr", "risk_norm"]].merge(
        info, left_on="site", right_index=True)

    print(f"\nScored {len(latest):,} intersections for {future.date()}")
    print(f"  riskiest: {latest['risk_yr'].max():.1f} expected crashes/year")
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


def export_geojson(scored: pd.DataFrame, path: Path = OUT_GEOJSON):
    feats = []
    for r in scored.to_dict("records"):
        props = {
            k: round(float(v), 6 if k in ("lat", "lng") else 4)
            if isinstance(v, (float, np.floating)) else
            int(v) if isinstance(v, np.integer) else v
            for k, v in r.items()
        }
        feats.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [props["lng"], props["lat"]]},
        })
    fc = {"type": "FeatureCollection", "features": feats}
    path.write_text(json.dumps(fc))
    print(f"wrote {path.name} ({len(feats)} intersections)")


# ----------------------------------------------------------------------------
def main():
    print("Loading crashes...")
    df = load_crashes()
    print(f"  {len(df):,} intersection crashes, "
          f"{df['when'].min().date()} -> {df['when'].max().date()}")

    print("Computing intersection details...")
    info = site_info(df)

    print("Building site x month panel...")
    panel = build_panel(df)
    panel = add_features(panel, info)
    print(f"  panel: {len(panel):,} site-month rows, "
          f"{panel['site'].nunique():,} intersections")

    print("Training Poisson risk model...")
    model = train(panel)

    scored = score_future(panel, model, info)
    export_geojson(scored)
    print("\nDone. Run `python3 app.py` and open http://localhost:8777")


if __name__ == "__main__":
    main()
