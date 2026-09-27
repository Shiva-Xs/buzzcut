Person ids in currentOperation, employee login, OSRTC stations, kolkata_bus

The branch carries 13 commits, more than its title says: `currentOperation` now returns the driver's and conductor's person ids, and the branch also adds employee login and registration, two read endpoints, an OSRTC station source and kolkata_bus data.

### Fleet operator
- `CurrentOperationResponse` gains `driver_person_id` and `conductor_person_id` (`Option<i64>`), looked up as `emp_id` in `employees_internal` by token; a missing or empty token (the DB stores `""` in places) or no matching row gives `null`
- New `POST /internal/fleet-operator/{gtfs_id}/employee/login` and `/employee/register`: email auth compares the client-sent `email_hash` and `password_hash` with `employees_internal` and returns the token and a `driver` or `conductor` role from the designation

### Read endpoints
- `GET /waybill/{gtfs_id}/metadata/{waybill_no}` returns the vehicle, service type, and the driver's name and mobile number
- `GET /cluster/{gtfs_id}/destinations/{stop_code}` groups stops by a `clusterId` parsed from each stop's `desc`, and falls back to single-stop walks when no stop has one

### OSRTC and data
- For the feed named by `osrtc_feed_key` (`odisha_osrtc` in dev), `get_stops` and `get_stop` serve stations from a new `OsrtcStationCache` that logs in to the OSRTC API and refreshes every `osrtc_station_refresh_interval_hours` (1 in dev); it stays off when the OSRTC credentials aren't set
- kolkata_bus gets fleet tags K1001 to K1005, and routes 1001 to 1004 (and 1001033 to 1004033) become SHUTTLE instead of PREMIUM; the online-waybill query gets the missing `is_flexi`; the service-type cache is keyed by `gtfs_id:vehicle_no`

Login trusts the hashes the client sends, so a stored hash works as a password.

Not tested: the test plan in the notes is unchecked. Call `currentOperation` with a driver token, a conductor token, a vehicle number and an unknown token, then the new endpoints.
