function timeAgo(date) {
  if (!date) return undefined;
  const diffMs = Date.now() - new Date(date).getTime();
  if (diffMs < 60 * 1000) return "just now";
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

module.exports = { timeAgo };
