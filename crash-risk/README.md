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

Predicts crash **risk** (expected crashes) per location for the month ahead,
combining:

- **Where** (spatial): crashes binned into H3 res-9 hexagons, each with its own
  crash history plus a neighbor-risk feature.
- **When** (temporal): a complete hexagon x month panel with seasonality
  (cyclical month, winter flag) and rolling 12-month history.

The model is a Poisson gradient-boosted regressor (scikit-learn
`HistGradientBoostingRegressor`) predicting crash count per hexagon-month. It is
trained on 2015-2024 and evaluated on the held-out future (2025-2026): its
top-10% riskiest hexagons capture ~39% of actual future crashes.

Each hexagon is labeled with a real street + neighborhood name via OpenStreetMap
**Nominatim** reverse geocoding (cached in `geocache.json`), falling back to the
CSV street fields when Nominatim has no useful name.

## Map

The frontend renders with **MapLibre GL JS** on the **OpenFreeMap** "liberty"
vector basemap — no API key required. A toggle switches the risk hexagon overlay
on/off while the basemap stays visible.

## Files

- `predict.py` — model pipeline. Trains, evaluates, writes `risk.geojson`.
  Reads the dataset from `../vision-zero/data.csv`.
- `app.py` — Flask backend serving the app and a JSON API.
- `index.html` — single-page MapLibre + OpenFreeMap UI with a ranked, searchable
  location list and a hexagon-overlay toggle.
- `risk.geojson` — generated risk layer with location names + stats
  (copied to `../public/data/crash-risk.geojson` for the Next.js app).
- `requirements.txt` — Python dependencies.
- `geocache.json` — cached OSM Nominatim reverse-geocoding results.

## Run

```bash
cd crash-risk
python3 -m pip install -r requirements.txt   # flask, pandas, numpy, scikit-learn, h3 (v4)
python3 predict.py                           # build risk.geojson (+ copy to ../public/data/)
python3 app.py                               # serve at http://localhost:8777
```

`predict.py` also prints the top-10% capture of a naive baseline (hexes ranked
by their plain training-period crash count) next to the model's capture, so you
can see whether the model beats simple counting.

`app.py` auto-runs `predict.py` if `risk.geojson` is missing. The first
`predict.py` run reverse-geocodes ~1,000 hexes via Nominatim (~18 min, 1 req/sec)
and caches the result; later runs are instant.

## API

- `GET /api/risk` — GeoJSON hexagons with risk + location names.
- `GET /api/locations?q=&limit=` — ranked, searchable location list.
- `GET /api/stats` — dashboard summary.

## Caveats

Police-reported crash data reflects reporting/patrol bias, not ground truth.
Raw counts conflate "dangerous" with "busy"; normalizing by traffic/pedestrian
volume would be the next step. The model predicts risk, not individual events.
