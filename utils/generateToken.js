const generateTokenAndSetCookie = (res, userId, role) => {
  const jwt = require('jsonwebtoken');

  const token = jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });

  const cookieExpireDays = parseInt(process.env.JWT_COOKIE_EXPIRE, 10) || 7;

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(Date.now() + cookieExpireDays * 24 * 60 * 60 * 1000)
  });

  return token;
};

module.exports = generateTokenAndSetCookie;