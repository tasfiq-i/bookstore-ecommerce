const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify connection on startup (non-blocking)
transporter.verify((error) => {
  if (error) {
    console.error('❌ Email transporter configuration error:', error.message);
  } else {
    console.log('✅ Email transporter ready to send messages');
  }
});

module.exports = transporter;