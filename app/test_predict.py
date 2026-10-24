import json

import h3
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


def test_split_train_test_drops_sites_unknown_at_train_end():
    m = pd.to_datetime(["2024-11-01", "2025-02-01"])
    panel = pd.DataFrame({"site": ["A", "A", "B", "B"], "month": list(m) * 2,
                          "crashes": [1, 0, 0, 2]})
    tr, te = P.split_train_test(panel)
    assert set(tr["site"]) == {"A"} and set(te["site"]) == {"A"}
