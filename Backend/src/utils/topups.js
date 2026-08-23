const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const { ensureCampaignSlots } = require("./ensureSlots");

// How many extra views a given amount buys on this campaign.
function viewsForAmount(campaign, amount) {
  const rate =
    campaign.costPerView ||
    (campaign.budget > 0 && campaign.targetViews > 0 ? campaign.budget / campaign.targetViews : 0);
  return rate > 0 ? Math.round(amount / rate) : 0;
}

// Credits a verified top-up exactly once.
//
// The Paystack reference is the idempotency key. Both the charge.success webhook
// and the brand's browser returning to the callback URL race to credit the same
// payment, so whoever loses the claim must do nothing. `amount` must come from
// Paystack, never from the client — the callback URL carries an amount the brand
// could edit.
async function creditTopup({ campaignId, reference, amount }) {
  if (!reference) return { credited: false, reason: "missing_reference" };
  if (!(amount > 0)) return { credited: false, reason: "invalid_amount" };

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return { credited: false, reason: "campaign_not_found" };

  // Atomic claim: returns the existing doc if one is already there, null if we
  // inserted it. Only the inserter credits.
  const existing = await Transaction.findOneAndUpdate(
    { reference, type: "topup" },
    {
      $setOnInsert: {
        campaignId: campaign._id,
        type: "topup",
        amount,
        status: "escrow_deposit",
        reference,
        date: new Date(),
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true }
  );

  if (existing) {
    return { credited: false, alreadyCredited: true, campaign };
  }

  const extraViews = viewsForAmount(campaign, amount);
  if (extraViews > 0) {
    campaign.targetViews += extraViews;
    await campaign.save();
    await ensureCampaignSlots(campaign);
  }

  return { credited: true, campaign, amount, extraViews };
}

module.exports = { creditTopup, viewsForAmount };
