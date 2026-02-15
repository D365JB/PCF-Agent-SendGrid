# Excel templates for shipment tracking

These CSVs are templates for the two new Excel **tables** the backend reads via Microsoft Graph:
- `Shipments`
- `ShipmentEvents`

If you prefer copy/paste without CSV quoting rules, use the TSV files instead:
- `Shipments.tsv`
- `ShipmentEvents.tsv`

## Fastest way to add them to your workbook
1) Open your workbook in Excel.
2) Create a new worksheet called `Shipments`.
3) Import or paste the content of `Shipments.csv` (or `Shipments.tsv`) into cell A1.
4) Select the range and use **Insert → Table** (or **Home → Format as Table**). Check **My table has headers**.
5) With the table selected, set **Table Name** (Table Design tab) to `Shipments`.

Repeat for `ShipmentEvents.csv` (or `ShipmentEvents.tsv`) on another worksheet and name the table `ShipmentEvents`.

## Notes
- Dates should be ISO strings like `2026-02-20T17:00:00Z` (recommended) or true Excel date/time values.
- The backend joins events to shipments by `ShipmentId` (preferred) or `TrackingNumber`.
- “Running late” is determined by `EstimatedDeliveryDate` from events vs `PlannedDeliveryDate` from shipments, with threshold `LATE_THRESHOLD_HOURS` (default 24).
