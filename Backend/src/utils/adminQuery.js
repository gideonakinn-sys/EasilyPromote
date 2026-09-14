const mongoose = require("mongoose");

const MAX_LIMIT = 100;

function paging(query, defaultLimit = 20) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(total, { page, limit }) {
  return { total, page, pages: Math.max(Math.ceil(total / limit), 1) };
}

function isObjectId(value) {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value) && /^[a-f0-9]{24}$/i.test(value);
}

// Search text comes from the admin UI; escape it so it is matched literally.
function searchRegex(value) {
  const text = String(value || "").trim().slice(0, 100);
  return text ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { paging, pageMeta, isObjectId, searchRegex, parseDate, csvCell };
