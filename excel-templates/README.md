# Excel workbook template

Use the unified, sanitized workbook template:
- `SAP_Order_Simulator_TEMPLATE.xlsx`

It contains the required Excel **tables** (including `Shipments` and `ShipmentEvents`) that the backend reads via Microsoft Graph.

If you need to regenerate the template, run:
- `generate_workbook_template.py`

## Optional: generate Inventory/Locations/Allocations tables

If you want a standalone workbook containing the `Locations`, `Inventory`, and `OrderAllocations` tables (to copy into your master workbook), run:

```powershell
python -m pip install openpyxl
python .\generate_inventory_location_tables.py
```
