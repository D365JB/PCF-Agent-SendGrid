# Excel shipment tracking tables (Graph workbook)

This project’s backend (AzureProxyWebApp) reads Excel **tables** from a workbook via Microsoft Graph.
To support:
- carrier events / tracking milestones
- normalization across shipping modes
- exception alerts ("running late") + proactive email messaging

…add **two tables** to the same workbook you already use for `Orders`, `OrderLines`, `Customers`, `Products`.

## 1) `Shipments` table
One row per shipment (can be 1:N with Orders).

**Required columns** (minimum)
- `ShipmentId` (text, unique)
- `OrderNumber` (text/number, matches `Orders[OrderNumber]`)
- `Mode` (text: `parcel|ltl|ftl|air|ocean|rail|courier|other`)
- `Carrier` (text)
- `TrackingNumber` (text)
- `PlannedDeliveryDate` (date/time or ISO string)

**Recommended columns** (used when present)
- `SAPShipmentId` (text)
- `Origin` (text)
- `Destination` (text)
- `PlannedShipDate` (date/time)
- `CustomerEmailOverride` (text)
- `LastEvaluatedAt` (date/time)
- `PredictedDeliveryDate` (date/time) *(backend can write this later if you want)*
- `PredictedDelayHours` (number)
- `IsRunningLate` (true/false)
- `LastMilestoneCode` (text)
- `LastMilestoneAt` (date/time)

**Example row**
| ShipmentId | OrderNumber | Mode | Carrier | TrackingNumber | PlannedDeliveryDate | SAPShipmentId |
|---|---|---|---|---|---|---|
| SHP-6600000680-01 | 6600000680 | parcel | UPS | 1Z999AA10123456784 | 2026-02-20T17:00:00Z | 0080001234 |

## 2) `ShipmentEvents` table
One row per raw event (from carrier or SAP). The backend normalizes these into milestones.

**Required columns** (minimum)
- `ShipmentId` *(preferred join key)* OR `TrackingNumber`
- `EventTime` (date/time or ISO string)
- `EventDescription` (text)

**Recommended columns**
- `Source` (text: `Carrier|SAP|Other`)
- `EventCode` (text)
- `Location` (text)
- `Status` (text)
- `EstimatedDeliveryDate` (date/time) *(if a carrier provides an updated ETA)*
- `Mode` (text) *(optional; otherwise backend uses Shipments[Mode])* 

**Example rows**
| ShipmentId | TrackingNumber | Source | EventTime | EventCode | EventDescription | Location | EstimatedDeliveryDate |
|---|---|---|---|---|---|---|---|
| SHP-6600000680-01 | 1Z999AA10123456784 | Carrier | 2026-02-15T09:10:00Z | PU | Picked up | Dallas, TX | |
| SHP-6600000680-01 | 1Z999AA10123456784 | Carrier | 2026-02-16T18:45:00Z | DEP | Departed facility | Dallas, TX | |
| SHP-6600000680-01 | 1Z999AA10123456784 | Carrier | 2026-02-18T07:30:00Z | EXC | Weather delay | Memphis, TN | 2026-02-22T17:00:00Z |

## How the backend uses these tables
When a user asks something like:
- “track shipment for order 6600000680”
- “carrier events / milestones for order 6600000680”
- “is order 6600000680 running late?”

…the backend:
1) reads `Orders` to resolve the order
2) reads `Shipments` to find shipments for that order
3) reads `ShipmentEvents` and normalizes events → milestone codes
4) computes **predicted delay** using `PlannedDeliveryDate` vs latest `EstimatedDeliveryDate` (if present)
5) flags **running late** when predicted delay exceeds the configured threshold

Default “running late” rule in code: **Predicted ETA > Planned ETA + 24 hours**.
