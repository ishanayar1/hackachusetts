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
