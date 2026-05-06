function parsePagination(query, defaults = {}) {
  const limit = Math.min(
    50,
    Math.max(1, parseInt(query.limit) || defaults.limit || 20)
  );
  const page = Math.max(1, parseInt(query.page) || 1);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function validatePagination(query, res) {
  if (query.limit && parseInt(query.limit) > 50) {
    res.status(400).json({ error: 'limit must be <= 50' });
    return false;
  }
  if (query.page && parseInt(query.page) < 1) {
    res.status(400).json({ error: 'page must be >= 1' });
    return false;
  }
  return true;
}

function paginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}

module.exports = { parsePagination, validatePagination, paginationMeta };
