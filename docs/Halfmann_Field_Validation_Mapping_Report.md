# Halfmann Field Validation Mapping Report

Generated: 2026-06-07

## Summary

The reported well setpoint, yesterday flow, tubing differential, priority, and compressor desired-flow mismatches were traced to stale dashboard fallback data, not to current `LatestDeviceData`.

The production panel endpoint currently reports:

- `latestDeviceData.count = 5`
- `dashboardSnapshot.state = fallback-cache`
- `dashboardSnapshot.httpStatus = 401`

That means the Murphy dashboard snapshot is not authenticated, so the server is merging a cached rich panel snapshot for dashboard-only tags. Those cached values match the incorrect values reported from the site.

## Corrective Action In This Patch

The Live View now hides dashboard fallback-cache values for current-sensitive fields instead of showing stale numbers as live readings.

Affected field groups:

- Well actual flow
- Well desired flow setpoint
- Well calculated desired flow
- Well yesterday flow
- Well static pressure
- Well tubing / injection differential pressure
- Well casing / tubing pressure
- Well priority
- Compressor desired flow from the panel

The Live View also displays a warning when dashboard fallback cache is active:

`Murphy dashboard auth is unavailable, so dashboard-only panel values are hidden instead of showing old cached readings. Live values still shown are from the current MLink feed.`

## Current Source Trace

| Display Field | Register | Current Source | Current Site Value | Field-Correct Value | Required Fix |
| --- | ---: | --- | ---: | ---: | --- |
| Well 444 desired flow | `460234` | `dashboardSnapshot fallback-cache` | `1.150` | `1.200` | Hide until current MLink/dashboard source is available |
| Well 213 desired flow | `460262` | `dashboardSnapshot fallback-cache` | `1.050` | `1.100` | Hide until current MLink/dashboard source is available |
| Well 333 desired flow | `460276` | `dashboardSnapshot fallback-cache` | `1.400` | `1.450` | Hide until current MLink/dashboard source is available |
| Well 444 yesterday flow | `460236` | `dashboardSnapshot fallback-cache` | `0.000` | `1.213` | Hide until current MLink/dashboard source is available |
| Well 214 differential | `460216` | `dashboardSnapshot fallback-cache` | `126` | `115` | Hide until current MLink/dashboard source is available |
| Well 444 differential | `460230` | `dashboardSnapshot fallback-cache` | `104` | `114` | Hide until current MLink/dashboard source is available |
| Well 334 differential | `460244` | `dashboardSnapshot fallback-cache` | `169` | `165` | Hide until current MLink/dashboard source is available |
| Well 213 differential | `460258` | `dashboardSnapshot fallback-cache` | `88` | `96` | Hide until current MLink/dashboard source is available |
| Well 333 differential | `460272` | `dashboardSnapshot fallback-cache` | `157` | `165` | Hide until current MLink/dashboard source is available |
| Compressor desired flow | `460002-460008` | `dashboardSnapshot fallback-cache` | `1.588` | `1.600` | Hide until current MLink/dashboard source is available |

## Current Live Feed Values Still Available

These values currently come from `latestDeviceData` and remain eligible for display:

| Display Field | Register | Source |
| --- | ---: | --- |
| Well 214 actual flow | `460212` | `latestDeviceData` |
| Well 444 actual flow | `460226` | `latestDeviceData` |
| Well 334 actual flow | `460240` | `latestDeviceData` |
| Well 213 actual flow | `460254` | `latestDeviceData` |
| Unit 2130 actual flow | `400656` | `latestDeviceData` |
| Unit 2128 actual flow | `400656` | `latestDeviceData` |
| Unit 2127 actual flow | `400656` | `latestDeviceData` |

## Remaining Data Gaps

These cannot be accurately repaired in the website alone unless MLink publishes the live tag or dashboard snapshot auth is restored:

- Well 333 actual flow if absent from `LatestDeviceData`
- All desired well setpoints if only available through dashboard snapshot
- Yesterday flow totals if only available through dashboard snapshot
- Tubing differential if only available through dashboard snapshot
- Compressor desired flow if only available through dashboard snapshot
- Missing Unit 2129 tags if the public feed only publishes 8 datapoints

## Standby Unit 1396

The app now stops carrying previously held supplemental values forward when the current Unit 1396 snapshot indicates the standby unit is off (`engine speed <= 0` and no current flow). This prevents stale engine load / oil pressure values from appearing live after unit power is turned off.
