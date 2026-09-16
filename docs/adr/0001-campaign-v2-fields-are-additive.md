# Campaign v2 fields sit beside the existing campaign fields

Campaigns gain a campaign model, pay shape, rate authority, content destination, creator access, audience targeting and creator eligibility. We add these beside the existing `objective` (views | actions), `referral`, `targetViews` and slot fields instead of replacing them, and migrate existing campaigns to performance model, views metric and open call. Live campaigns, the admin panel, payouts and withdrawals all read the old fields, and Paystack can't hold money, so a breaking rename would put paid, running campaigns at risk mid-flight. A later cleanup may remove the old fields once nothing reads them.

## Consequences

For a while a campaign describes its intent twice (`objective: "actions"` and a sign-ups objective). New code reads the v2 fields; the migration keeps both in agreement.
