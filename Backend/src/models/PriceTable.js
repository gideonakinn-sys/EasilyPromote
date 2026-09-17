const mongoose = require("mongoose");

// The per-view price table admin edits (ticket 11). One document, _id "views". Without it the
// defaults in config/pricing.js apply. `version` goes up by one on every change, so two admins
// saving at once can't overwrite each other.
const priceTableSchema = new mongoose.Schema(
  {
    _id: { type: String },
    tiers: {
      type: [{ _id: false, views: { type: Number, required: true }, price: { type: Number, required: true } }],
      default: [],
    },
    version: { type: Number, default: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PriceTable", priceTableSchema);
