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
