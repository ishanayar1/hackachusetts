# Boston Vision Zero crash records

Saved 2026-10-18 for Hackachusetts.

All Boston Vision Zero crash records in the city's open table: mode, street, cross streets, and the published latitude and longitude. This is a crash location, not a residence. It is not the MassDOT crash file. The live call returns the 100 most recent rows. data.csv is the full saved table.

Rows in data.csv: 44986

Columns: when, mode, where, street, cross_street, cross_street_2, latitude, longitude

How to use it

- Spreadsheets: open data.csv in Excel or Google Sheets.
- Fresh copy: run `python fetch.py` or `node fetch.js`. Both call the URL below and save the response.
- The preview on the Hackachusetts site is a few rows of this same table.

Direct request

https://data.boston.gov/api/3/action/datastore_search?resource_id=e4bfe397-6bfc-49c5-9367-c879fac7401d&fields=dispatch_ts,mode_type,location_type,street,xstreet1,xstreet2,lat,long&sort=dispatch_ts%20desc&limit=100

Check the source license before publishing a project.

---

The crash-risk prediction model and web app built on this dataset live in the
sibling `../crash-risk/` folder. See `../crash-risk/README.md`.
