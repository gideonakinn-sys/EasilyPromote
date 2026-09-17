// Which admin roles can use which actions. The API enforces these; the panel hides or disables
// what a role can't use.

// Paying and reviewing withdrawals, the payout run, the payout check, refunds, voids and
// cancelling a paid campaign.
export const MONEY_ROLES: readonly string[] = ["finance_admin", "super_admin"];

// Complete Campaign.
export const COMPLETE_ROLES: readonly string[] = ["admin", "super_admin", "finance_admin"];

// Setting or changing a sign-up reward.
export const REWARD_ROLES: readonly string[] = ["admin", "super_admin", "finance_admin"];
