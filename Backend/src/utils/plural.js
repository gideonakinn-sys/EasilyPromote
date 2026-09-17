// "1 hour", "3 hours": a count with its noun in the right number.
function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

module.exports = { plural };
