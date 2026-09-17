// Placement (Slot) statuses shared by joining, the marketplace and the creator dashboard.

// Work in progress; counts towards the active placement limit.
const ACTIVE_PLACEMENT_STATUSES = ["claimed", "submitted", "verifying"];
// A creator holds the place, active or finished.
const HELD_PLACEMENT_STATUSES = [...ACTIVE_PLACEMENT_STATUSES, "approved", "paid"];
const MAX_ACTIVE_PLACEMENTS = 3;

module.exports = { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS };
