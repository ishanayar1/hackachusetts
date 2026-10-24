# Intersection Crash-Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict crash risk per real street intersection (a point on the map), not per H3 hexagon, and show richer per-intersection details on the map.

**Architecture:** Keep the existing pipeline shape in `app/predict.py` (load, panel, features, Poisson GBM, score, export). Replace the hexagon key with an intersection `site` id built from the CSV's two cross-street names, split by location when one name pair occurs in several places. Export GeoJSON Points; the map draws a heatmap at low zoom and sized/colored circles at street zoom.

**Tech Stack:** Python 3.15, pandas, numpy, scikit-learn (`HistGradientBoostingRegressor`, `DBSCAN`, `BallTree`), h3 (only for the neighborhood cache lookup), Flask, MapLibre GL JS 4.7.1 + OpenFreeMap. Tests: pytest.

**Spec:** User request (chat, 2026-10-24): "refactor the prediction model and everything, its not purpose to predict a huge hexagon, instead it should only predict the exact intersection where its accident prone and if you can add some details to the map its good."

## Global Constraints

- Work on branch `intersection-risk`. No `Co-Authored-By` or other attribution trailer in commits (user's global rule).
- Venv: `/Users/bou/Downloads/Hackaton/.venv-hack` (system Python is externally managed). Referred to below as `$PY` = `/Users/bou/Downloads/Hackaton/.venv-hack/bin/python`.
- Only crashes with `where == "Intersection"` count. Mid-block (`Street`) and `Other` rows are dropped.
- Intersection name = the two cross streets, stripped, upper-cased, sorted, joined by `" & "`.
- No new network calls. Neighborhood names come from the existing `app/geocache.json` (keyed by H3 res-9 cell). Delete the Nominatim fetch code.
- No new runtime dependencies. `pytest` is dev-only, installed into the venv.
- Port stays `8777`; API routes stay `/api/risk`, `/api/locations`, `/api/stats`.

## Review Focus

1. Same name pair in two neighborhoods (e.g. `LAGRANGE ST & WASHINGTON ST`) must become two points, not one point midway. Test: `test_assign_sites_splits_same_name_far_apart` (Task 1).
2. Name order, case and stray spaces (`" mass ave"` vs `"MASS AVE"`, A&B vs B&A) must map to one intersection. Test: `test_intersection_key_normalizes` (Task 1).
3. Peak-hour detail must be Boston local time, not UTC (CSV `when` is UTC). Test: `test_site_info_peak_hour_is_local` (Task 2).
4. `/api/locations?limit=abc` must not 500. Test: `test_locations_bad_limit_falls_back` (Task 3).
5. Street names are rendered via `innerHTML`; a name containing `<` must render as text. Check: `esc()` helper used for every CSV-derived string (Task 4, browser check).

---

### Task 1: Intersection sites

**Files:**
- Modify: `app/predict.py` (config block, `load_crashes`; delete `H3_RES`, `_row_label`, `NOMINATIM_*`, `_osm_name`, `reverse_geocode_hexes`)
- Create: `app/test_predict.py`

**Interfaces:**
- Produces:
  - `SITE_SPLIT_M = 150` (metres; DBSCAN radius for splitting one name pair)
  - `intersection_key(a: str, b: str) -> str`
  - `assign_sites(df: pd.DataFrame) -> pd.Series` (str, aligned to `df.index`; needs columns `name`, `latitude`, `longitude`). One cluster → site = `name`. Several → `f"{name} #{k}"`, `k` starting at 1, ordered by cluster size descending.
  - `load_crashes(path: Path = DATA) -> pd.DataFrame` with added columns `name`, `site`, `month` (naive month-start Timestamp), `local` (`when` converted to `America/New_York`). Keeps the existing bounding-box filter. Drops rows where either cross street is blank.

- [ ] **Step 1: Install pytest and write failing tests in `app/test_predict.py`**

```python
import pandas as pd
import predict as P

CSV_HEAD = "when,mode,where,street,cross_street,cross_street_2,latitude,longitude\n"

def test_intersection_key_normalizes():
    assert P.intersection_key(" mass ave", "Albany St ") == "ALBANY ST & MASS AVE"
    assert P.intersection_key("ALBANY ST", "MASS AVE") == "ALBANY ST & MASS AVE"

def test_load_crashes_keeps_only_intersections(tmp_path):
    f = tmp_path / "d.csv"
    f.write_text(CSV_HEAD +
        "2024-06-01 16:30:00+00,mv,Intersection,,A ST,B ST,42.30,-71.06\n"
        "2024-06-01 16:30:00+00,mv,Street,C ST,A ST,B ST,42.30,-71.06\n"
        "2024-06-01 16:30:00+00,mv,Intersection,,A ST,,42.30,-71.06\n")
    df = P.load_crashes(f)
    assert len(df) == 1
    assert df["site"].iloc[0] == "A ST & B ST"

def test_assign_sites_splits_same_name_far_apart():
    df = pd.DataFrame({
        "name": ["SCHOOL ST & WASHINGTON ST"] * 3,
        "latitude": [42.3000, 42.3001, 42.2500],
        "longitude": [-71.0600, -71.0601, -71.1200],
    })
    s = P.assign_sites(df)
    assert s.tolist() == ["SCHOOL ST & WASHINGTON ST #1"] * 2 + ["SCHOOL ST & WASHINGTON ST #2"]
```

Run: `$PY -m pip install -q pytest`

- [ ] **Step 2: Run tests, expect failure**

Run: `cd app && $PY -m pytest test_predict.py -q`
Expected: FAIL, `AttributeError: module 'predict' has no attribute 'intersection_key'`.

- [ ] **Step 3: Implement `intersection_key`, `assign_sites`, `load_crashes` in `app/predict.py`**

`assign_sites`: group by `name`; for each group run `sklearn.cluster.DBSCAN(eps=SITE_SPLIT_M / 6_371_000, min_samples=1, metric="haversine")` on `np.radians(lat, lng)`; skip DBSCAN for single-row groups. Remove the `hex` column and all Nominatim code. Keep `_load_geocache` and `GEOCACHE` (used in Task 2).

- [ ] **Step 4: Run tests, expect pass**

Run: `cd app && $PY -m pytest test_predict.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add app/predict.py app/test_predict.py
git commit -m "feat(model): key crashes by named intersection instead of hexagon"
```

---

### Task 2: Site details, model on sites, Point export

**Files:**
- Modify: `app/predict.py` (`hex_labels` replaced, `build_panel`, `add_features`, `train`, `score_future`, `export_geojson`, `main`, module docstring)
- Modify: `app/test_predict.py`
- Regenerate: `app/risk.geojson`

**Interfaces:**
- Consumes: `load_crashes`, `_load_geocache` (Task 1).
- Produces:
  - `NEIGHBOR_M = 300`
  - `neighborhood_for(lat: float, lng: float, cache: dict) -> str`: looks up `h3.latlng_to_cell(lat, lng, 9)` in `cache`; returns the text after the last `", "`, else `""`.
  - `site_info(df: pd.DataFrame) -> pd.DataFrame`, indexed by `site`, columns: `label` (name title-cased), `lat`, `lng` (median of crashes), `total_crashes`, `mv`, `ped`, `bike`, `first`, `last` (ISO dates), `peak_hour` (int 0–23, local), `peak_day` (`"Mon"`…`"Sun"`, local), `last12` (crashes in the final 12 months of data), `neighborhood` (str, `""` if unknown).
  - `build_panel(df)`: same as now with `site` in place of `hex`.
  - `add_features(panel, info)`: `lat`/`lng` from `info`; `neighbor_hist` = mean monthly crash rate (months `<= TRAIN_END` only, so the test period does not leak) of the other sites within `NEIGHBOR_M`, via `sklearn.neighbors.BallTree(metric="haversine").query_radius`; `0.0` if none. Other features unchanged; `FEATURES` list unchanged.
  - `score_future(panel, model, info) -> pd.DataFrame`: one row per site with `site, risk, risk_yr, risk_norm` plus all `info` columns.
  - `export_geojson(scored, path: Path = OUT_GEOJSON)`: `Point` features, `coordinates = [lng, lat]`, properties = `site` + every column `score_future` returns (floats rounded as today, ints as `int`).

- [ ] **Step 1: Add failing tests to `app/test_predict.py`**

```python
import h3

def test_site_info_peak_hour_is_local(tmp_path):
    f = tmp_path / "d.csv"
    f.write_text(CSV_HEAD +
        "2024-06-01 16:30:00+00,ped,Intersection,,A ST,B ST,42.30,-71.06\n"
        "2024-06-03 16:10:00+00,mv,Intersection,,B ST,A ST,42.30,-71.06\n")
    info = P.site_info(P.load_crashes(f))
    r = info.loc["A ST & B ST"]
    assert r["peak_hour"] == 12          # 16:xx UTC = 12:xx EDT
    assert r["label"] == "A St & B St"
    assert (r["total_crashes"], r["ped"], r["mv"]) == (2, 1, 1)

def test_neighborhood_for():
    cell = h3.latlng_to_cell(42.30, -71.06, 9)
    assert P.neighborhood_for(42.30, -71.06, {cell: "Blue Hill Ave, Roxbury"}) == "Roxbury"
    assert P.neighborhood_for(42.30, -71.06, {cell: "Blue Hill Ave"}) == ""
    assert P.neighborhood_for(42.30, -71.06, {}) == ""

def test_export_geojson_writes_points(tmp_path):
    scored = pd.DataFrame([{"site": "A ST & B ST", "label": "A St & B St", "lat": 42.3,
                            "lng": -71.06, "risk": 0.5, "risk_yr": 6.0, "risk_norm": 1.0}])
    out = tmp_path / "r.geojson"
    P.export_geojson(scored, out)
    feat = json.loads(out.read_text())["features"][0]
    assert feat["geometry"] == {"type": "Point", "coordinates": [-71.06, 42.3]}
    assert feat["properties"]["site"] == "A ST & B ST"
```

(add `import json` at the top.)

- [ ] **Step 2: Run tests, expect failure**

Run: `cd app && $PY -m pytest test_predict.py -q`
Expected: 3 FAIL (`site_info` / `neighborhood_for` missing, `export_geojson` takes no path).

- [ ] **Step 3: Implement the Interfaces above; update `main()` to `df → info = site_info(df) → panel → add_features(panel, info) → train → score_future(panel, model, info) → export_geojson(scored)`**

Delete `hex_labels`. Replace every `"hex"` key with `"site"`. Update the module docstring to describe intersections.

- [ ] **Step 4: Run tests, expect pass**

Run: `cd app && $PY -m pytest test_predict.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Run the full pipeline**

Run: `cd app && $PY predict.py`
Expected: finishes without error, prints the held-out evaluation (model deviance below baseline, "top-10% riskiest ... captured N%"), and `wrote risk.geojson (~4,0xx intersections)`. Record the capture % for the README. Run `$PY -c "import json;f=json.load(open('risk.geojson'))['features'];print(sum(1 for x in f if x['properties']['neighborhood'])/len(f))"` and note neighborhood coverage.

- [ ] **Step 6: Commit**

```bash
git add app/predict.py app/test_predict.py app/risk.geojson
git commit -m "feat(model): predict risk per intersection, export points with details"
```

---

### Task 3: API on intersections

**Files:**
- Modify: `app/app.py:57-98`
- Create: `app/test_app.py`

**Interfaces:**
- Consumes: `risk.geojson` Point features with the property names from Task 2.
- Produces (JSON the frontend reads):
  - `/api/locations` rows: `site, label, neighborhood, risk_yr, risk_norm, lat, lng, total_crashes, mv, ped, bike`. `limit` parsed with `request.args.get("limit", 100, type=int)`. Search `q` matches `label` or `neighborhood`.
  - `/api/stats`: `{"intersections": int, "historical_crashes": int, "top_risk_yr": float, "by_mode": {...}}` (`hexagons` key removed).

- [ ] **Step 1: Write failing tests in `app/test_app.py`**

```python
import json
import app as A

def _fixture(tmp_path, monkeypatch):
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-71.06, 42.3]},
              "properties": {"site": s, "label": s.title(), "neighborhood": "Roxbury",
                             "risk_yr": r, "risk_norm": r / 6, "lat": 42.3, "lng": -71.06,
                             "total_crashes": 3, "mv": 2, "ped": 1, "bike": 0}}
             for s, r in [("A ST & B ST", 6.0), ("C ST & D ST", 2.0)]]
    p = tmp_path / "risk.geojson"
    p.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    monkeypatch.setattr(A, "GEOJSON", p)
    monkeypatch.setattr(A, "_cache", None)
    return A.app.test_client()

def test_locations_bad_limit_falls_back(tmp_path, monkeypatch):
    r = _fixture(tmp_path, monkeypatch).get("/api/locations?limit=abc")
    assert r.status_code == 200
    assert [x["site"] for x in r.get_json()["results"]] == ["A ST & B ST", "C ST & D ST"]

def test_locations_search_by_neighborhood(tmp_path, monkeypatch):
    r = _fixture(tmp_path, monkeypatch).get("/api/locations?q=roxbury")
    assert r.get_json()["count"] == 2

def test_stats_counts_intersections(tmp_path, monkeypatch):
    s = _fixture(tmp_path, monkeypatch).get("/api/stats").get_json()
    assert s["intersections"] == 2 and s["top_risk_yr"] == 6.0
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd app && $PY -m pytest test_app.py -q`
Expected: FAIL (`KeyError: 'hex'` / 500 on `limit=abc` / `intersections` missing).

- [ ] **Step 3: Update `api_locations`, `api_stats` and the module docstring per Interfaces**

- [ ] **Step 4: Run all tests, expect pass**

Run: `cd app && $PY -m pytest -q`
Expected: `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add app/app.py app/test_app.py
git commit -m "feat(api): serve intersection points, validate limit, search neighborhoods"
```

---

### Task 4: Map — intersection points and details

**Files:**
- Modify: `app/index.html` (layers, popup, sidebar, toggle, legend, stats label)
- Modify: `app/README.md`

**Interfaces:**
- Consumes: `/api/risk` Point features and `/api/locations`, `/api/stats` from Task 3.

- [ ] **Step 1: Replace hexagon layers with point layers in `index.html`**

- `risk-heat`: `type: "heatmap"`, `weight` = `risk_norm`, `maxzoom: 15`, opacity fading from 0.8 at z12 to 0 at z14.5.
- `risk-pt`: `type: "circle"`, `minzoom: 12`, `circle-color` = `["get", "_color"]` (keep the existing `color()` ramp), `circle-radius` interpolated on zoom (z12 → 2 + 6·risk_norm, z17 → 5 + 16·risk_norm), white 1px stroke, opacity fading in z12–14.
- `risk-hover`: circle with white 3px stroke, filtered on `site`.
- Insert heat/point layers before the first symbol layer as today; delete the `ROAD_LAYERS` repaint code (it never changes anything now). Toggle label → "Risk layer"; toggles visibility of all three layers.

- [ ] **Step 2: Popup, sidebar, legend details**

- `esc(s)` helper (replace `& < > " '` with entities); every CSV-derived string goes through it.
- Popup: label (bold), neighborhood (muted, omitted when `""`), predicted crashes/yr, risk score /100, historic total with 🚗/🚶/🚲 split, "Last 12 months: N", "Most crashes: {peak_day}s around {peak_hour formatted as 12-hour, e.g. 5 PM}", first–last dates.
- Sidebar row sub-line: neighborhood · mode split. Stats tile "Zones" → "Intersections", reading `s.intersections`. Header copy: "Predicted crash risk per intersection for the month ahead…". `focusHex` → `focusSite`, keyed by `site`.
- Legend: title "Predicted risk", note "Circle size = risk".

- [ ] **Step 3: Verify in browser**

Restart the server: kill the old `app.py` on 8777, `cd app && nohup $PY app.py &`. Open http://localhost:8777 in the browser pane. Expected: heatmap at z11.5; zooming to a top-list intersection shows a circle on the actual intersection; popup shows all fields; search "roxbury" filters the list; toggle hides all risk layers; console has no errors.

- [ ] **Step 4: Update `app/README.md`**

Replace the hexagon description with: unit = named intersection (where == Intersection rows, name pair split by DBSCAN at 150 m), features unchanged except neighbor risk within 300 m, the new top-10% capture % from Task 2 Step 5, neighborhood from cached OSM labels, map = heatmap + circles. Add `pytest` to Run section: `python -m pytest -q`. Note in Caveats: mid-block crashes are excluded.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/README.md
git commit -m "feat(map): intersection circles, heatmap, and richer popups"
```
