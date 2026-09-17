# 10: Hybrid pay — base plus performance bonus

**What to build:** A brand can offer a base fee per approved deliverable plus a performance bonus. Creators see it on the marketplace under a Hybrid tab, get the base when their content is accepted and the bonus as results come in.

**Blocked by:** 03, 04, 09

**Milestone:** M7b · after launch · 18 Nov – 18 Dec

**Status:** done

## Acceptance criteria

- [x] Wizard offers Hybrid for content campaigns: brand sets base per deliverable and funds a bonus pool; bonus metric and cap per D4
- [x] Checkout charges base budget + bonus pool + platform fee from the shared calculator
- [x] Marketplace gains the Hybrid tab; cards read like `₦5,000 + bonus`
- [x] Base is paid on the fixed-pay trigger; the bonus is reserved from the bonus pool as views or conversions are verified, up to the per-creator cap
- [x] Wallet shows base and bonus separately
- [x] Reconciliation passes with Hybrid campaigns included

## Decisions

Recorded in SPEC.md as D2, D4 and D5 amended for hybrid: the fee is on top of the base and of the bonus pool; the bonus is a fourth pot ("bonus") with its own ledger rows (`bonus_credit`), held 7 days; unused pool plus its fee is refunded by finance/super admins at campaign end (`POST /api/admin/campaigns/:id/refund-unused-bonus`). Code: `Backend/src/utils/hybridBonus.js`, `hybridBonusRules.js`; tests: `test/e2e/hybrid-pay.test.js`, `test/unit/hybridBonusRules.test.js`.
