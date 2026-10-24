"""Save a fresh copy of this Hackachusetts starter source."""
import pathlib
import urllib.parse
import urllib.request

URL = "https://data.boston.gov/api/3/action/datastore_search?resource_id=e4bfe397-6bfc-49c5-9367-c879fac7401d&fields=dispatch_ts,mode_type,location_type,street,xstreet1,xstreet2,lat,long&sort=dispatch_ts%20desc&limit=100"
request = urllib.request.Request(URL, headers={"User-Agent": "HackachusettsKit"})
with urllib.request.urlopen(request, timeout=90) as response:
    payload = response.read()
suffix = pathlib.Path(urllib.parse.urlparse(URL).path).suffix
path = pathlib.Path("fresh" + suffix) if suffix in {".csv", ".txt", ".json", ".jsonl", ".parquet"} else pathlib.Path("fresh.json")
path.write_bytes(payload)
print(f"wrote {path} ({len(payload)} bytes)")
