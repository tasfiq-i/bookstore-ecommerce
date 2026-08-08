const crypto = require('crypto');

/**
 * Generates a random, human-friendly coupon code.
 * Format: optional PREFIX- + 6-8 random uppercase alphanumeric chars
 * Excludes visually ambiguous characters (0, O, 1, I, L) to avoid customer typos.
 * @param {Object} options
 * @param {string} options.prefix - optional prefix like "SAVE20", "WELCOME"
 * @param {number} options.length - length of the random suffix (default 6)
 * @returns {string} generated code, e.g. "SAVE20-7K9XQD" or "7K9XQD3M"
 */
const generateCouponCode = ({ prefix = '', length = 6 } = {}) => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  let suffix = '';

  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    suffix += chars[randomBytes[i] % chars.length];
  }

  const cleanPrefix = prefix
    ? prefix
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12)
    : '';

  return cleanPrefix ? `${cleanPrefix}-${suffix}` : suffix;
};

module.exports = generateCouponCode;