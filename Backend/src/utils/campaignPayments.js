const BusinessProfile = require("../models/BusinessProfile");
const { bookEscrowDeposit } = require("./escrow");
const { creditReferralTopup, roundMoney } = require("./referralEarnings");

// What the campaign's checkout charged: views price plus the referral budget. Campaigns
// paid before referral budgets joined checkout were charged the views price only.
function expectedPaymentAmount(campaign) {
  return campaign.paymentAmount > 0 ? campaign.paymentAmount : campaign.budget;
}

// Books a verified campaign payment: the referral budget into its own pot, the views
// price into escrow. Both are keyed on the payment reference, so the webhook and the
// brand's status check can confirm the same payment at once. Returns whether this call
// booked the views deposit.
async function bookCampaignPayment(campaign, reference) {
  const referralAmount = Math.max(roundMoney(expectedPaymentAmount(campaign) - campaign.budget), 0);
  if (referralAmount > 0) {
    await creditReferralTopup({ campaignId: campaign._id, reference, amount: referralAmount, fromCampaignPayment: true });
  }
  return bookEscrowDeposit({ campaignId: campaign._id, amount: campaign.budget, reference });
}

// A brand's app counts as connected once its own server has sent a code check and a
// conversion. Referral campaigns can't be paid for before then.
async function brandAppVerified(businessId) {
  const profile = await BusinessProfile.findOne({ userId: businessId }).select("referralVerification").lean();
  return Boolean(profile && profile.referralVerification && profile.referralVerification.verifiedAt);
}

module.exports = { expectedPaymentAmount, bookCampaignPayment, brandAppVerified };
