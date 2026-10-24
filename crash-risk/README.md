# Boston crash-risk web app

A predictive crash-risk model and web app built on the Boston Vision Zero crash
dataset (in `../vision-zero/data.csv`).

> **Moved:** this app now lives in `crash-risk/` inside the LastMile repo.
> The LastMile Next.js app does not run this Python code; it reads a copy of
> the output at `public/data/crash-risk.geojson` (served at
> `/data/crash-risk.geojson` and through `GET /api/crash/locations`).
> `predict.py` refreshes that copy automatically whenever `../public/data/`
> exists, so rerunning it updates the Next.js app too. In LastMile the layer is
> shown as **recorded crash history**, not as a prediction.

## What it does

Predicts crash **risk** (expected crashes) per **street intersection** for the
month ahead, combining:

- **Where** (spatial): every crash the city records as an `Intersection` crash
  is keyed by its two crossing streets (`cross_street`, `cross_street_2`;
  case-, space- and order-insensitive). When one name pair occurs in several
  places (e.g. `Washington St & School St`), DBSCAN splits it into separate
  intersections 150 m apart or more. Each intersection is a single point at the
  median location of its crashes. Features: its own crash history plus the
  training-period crash rate of other intersections within 300 m.
- **When** (temporal): a complete intersection x month panel with seasonality
  (cyclical month, winter flag) and rolling 12-month history.

The model is a Poisson gradient-boosted regressor (scikit-learn
`HistGradientBoostingRegressor`) predicting crash count per intersection-month.
It is trained on 2015-2024 and evaluated on the held-out future (2025-2026),
over intersections that had at least one crash by end of 2024: deviance is
~3% below a per-intersection-average baseline, and its top-10% riskiest
intersections capture ~51% of actual future crashes.

Each intersection also carries details for the map: neighborhood (from cached
OpenStreetMap Nominatim labels in `geocache.json`, no network calls), crashes
by mode, crashes in the last 12 months, and the local day of week and hour
when most of its crashes happened.

## Map

The frontend renders with **MapLibre GL JS** on the **OpenFreeMap** "liberty"
vector basemap — no API key required. Zoomed out, a risk heatmap shows the
prone areas; from zoom 12 it fades into one circle per intersection, colored
and sized by predicted risk. Click a circle (or a list row) for its details.
The list searches street names and neighborhoods. A toggle hides the risk
layers.

## Files

- `predict.py` — model pipeline. Trains, evaluates, writes `risk.geojson`.
  Reads the dataset from `../vision-zero/data.csv`.
- `app.py` — Flask backend serving the app and a JSON API.
- `index.html` — single-page MapLibre + OpenFreeMap UI.
- `risk.geojson` — generated layer: one Point per intersection with risk + details
  (copied to `../public/data/crash-risk.geojson` for the Next.js app).
- `requirements.txt` — Python dependencies.
- `geocache.json` — cached OSM Nominatim labels per H3 res-9 cell (neighborhoods).
- `test_predict.py`, `test_app.py` — pytest suite.

## Run

```bash
cd crash-risk
python3 -m pip install -r requirements.txt pytest   # flask, pandas, numpy, scikit-learn, h3 (v4)
python3 predict.py                                  # build risk.geojson (+ copy to ../public/data/), ~15 s
python3 app.py                                      # serve at http://localhost:8777
python3 -m pytest -q                                # tests
```

`predict.py` also prints the top-10% capture of a naive baseline (intersections
ranked by their plain training-period crash count) next to the model's capture,
so you can see whether the model beats simple counting.

`app.py` auto-runs `predict.py` if `risk.geojson` is missing.

## API

- `GET /api/risk` — GeoJSON intersection points with risk + details.
- `GET /api/locations?q=&limit=` — ranked intersections; `q` matches street or neighborhood.
- `GET /api/stats` — dashboard summary.

## Caveats

Police-reported crash data reflects reporting/patrol bias, not ground truth.
Mid-block crashes (the CSV's `Street` rows, ~48%) are excluded; only
intersection crashes are modeled. Raw counts conflate "dangerous" with "busy"; normalizing by traffic/pedestrian
volume would be the next step. The model predicts risk, not individual events.


