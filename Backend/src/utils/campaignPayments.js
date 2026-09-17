const BusinessProfile = require("../models/BusinessProfile");
const Transaction = require("../models/Transaction");
const { bookEscrowDeposit } = require("./escrow");
const { creditReferralTopup, roundMoney } = require("./referralEarnings");
const { isContentCampaign } = require("./campaignPay");
const { isHybridCampaign } = require("./hybridBonus");

// What the campaign's checkout charged: views price plus the referral budget. Campaigns
// paid before referral budgets joined checkout were charged the views price only.
function expectedPaymentAmount(campaign) {
  return campaign.paymentAmount > 0 ? campaign.paymentAmount : campaign.budget;
}

// Books a verified campaign payment: the referral budget into its own pot, the views
// price into escrow. Both are keyed on the payment reference, so the webhook and the
// brand's status check can confirm the same payment at once. Returns whether this call
// booked the views deposit. A content campaign's payment (creator budget plus fee) is its
// fixed pot, paid out per completed deliverable. A hybrid campaign's payment also carries the bonus
// pool and its fee, booked to the bonus pot as a top-up row under the same reference (ticket 10).
async function bookCampaignPayment(campaign, reference) {
  const extraAmount = Math.max(roundMoney(expectedPaymentAmount(campaign) - campaign.budget), 0);
  if (isHybridCampaign(campaign)) {
    await bookBonusPool(campaign, reference);
  } else if (extraAmount > 0) {
    await creditReferralTopup({ campaignId: campaign._id, reference, amount: extraAmount, fromCampaignPayment: true });
  }
  return bookEscrowDeposit({
    campaignId: campaign._id,
    amount: campaign.budget,
    reference,
    bucket: isContentCampaign(campaign) ? "fixed" : "views",
    feeAmount: roundMoney(campaign.platformFee),
  });
}

// A brand's app counts as connected once its own server has sent a code check and a
// conversion. Referral campaigns can't be paid for before then.
async function brandAppVerified(businessId) {
  const profile = await BusinessProfile.findOne({ userId: businessId }).select("referralVerification").lean();
  return Boolean(profile && profile.referralVerification && profile.referralVerification.verifiedAt);
}

// Whether the brand has paid anything into this campaign (its checkout or a top-up). Cancelling a
// paid campaign sends refunds, so only finance and super admins can; the admin panel reads the same rule.
async function campaignHasPayments(campaignId) {
  return Boolean(await Transaction.exists({ campaignId, type: { $in: ["escrow_deposit", "topup"] } }));
}

// Books a hybrid campaign's bonus pool and fee once per payment reference (the unique {reference, type}
// index makes a second confirmation a no-op). The pool itself was set up with the campaign.
async function bookBonusPool(campaign, reference) {
  const bonus = campaign.hybridBonus;
  try {
    await Transaction.create({
      campaignId: campaign._id,
      type: "topup",
      bucket: "bonus",
      amount: roundMoney(bonus.pool + (bonus.platformFee || 0)),
      feeAmount: roundMoney(bonus.platformFee || 0),
      status: "escrow_deposit",
      reference,
      date: new Date(),
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

// What a hybrid campaign's checkout charges beyond its base: the bonus pool plus its fee.
function bonusCheckoutAmount(campaign) {
  return isHybridCampaign(campaign) ? roundMoney(campaign.hybridBonus.pool + (campaign.hybridBonus.platformFee || 0)) : 0;
}

module.exports = { expectedPaymentAmount, bookCampaignPayment, bonusCheckoutAmount, brandAppVerified, campaignHasPayments };
