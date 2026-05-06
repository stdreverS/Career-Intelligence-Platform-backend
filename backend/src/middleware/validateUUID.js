const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = function validateUUID(...paramNames) {
  return (req, res, next) => {
    for (const param of paramNames) {
      const value = req.params[param] || req.body[param];
      if (value && !UUID_REGEX.test(value)) {
        return res.status(400).json({ error: `Invalid ID format: ${param}` });
      }
    }
    next();
  };
};
