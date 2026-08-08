const transporter = require('../config/nodemailer');

const formatCurrency = (amount) => `৳${Number(amount).toFixed(2)}`;

const buildOrderItemsHtml = (items) =>
  items
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.title}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.price)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(item.price * item.quantity)}</td>
      </tr>`
    )
    .join('');

const emailTemplates = {
  welcome: (data) => ({
    subject: 'Welcome to BookStore!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">📚 BookStore</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #2c3e50;">Welcome, ${data.name}!</h2>
          <p style="color: #555; line-height: 1.6;">
            Thank you for creating an account with BookStore. We're excited to have you join our community of book lovers.
          </p>
          <p style="color: #555; line-height: 1.6;">
            Browse our catalog, discover new titles, and enjoy a seamless shopping experience.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/books" style="background-color: #2c3e50; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Start Shopping
            </a>
          </div>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          &copy; ${new Date().getFullYear()} BookStore. All rights reserved.
        </div>
      </div>
    `
  }),

  passwordReset: (data) => ({
    subject: 'Password Reset Request - BookStore',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">📚 BookStore</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #2c3e50;">Password Reset Request</h2>
          <p style="color: #555; line-height: 1.6;">
            Hi ${data.name}, we received a request to reset your password. Click the button below to proceed.
            This link is valid for 10 minutes.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.resetUrl}" style="background-color: #e74c3c; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #999; font-size: 13px;">
            If you did not request this, please ignore this email. Your password will remain unchanged.
          </p>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          &copy; ${new Date().getFullYear()} BookStore. All rights reserved.
        </div>
      </div>
    `
  }),

  orderConfirmation: (data) => ({
    subject: `Order Confirmed - ${data.orderNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">📚 BookStore</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #2c3e50;">Thank you for your order, ${data.customerName}!</h2>
          <p style="color: #555; line-height: 1.6;">
            Your order <strong>${data.orderNumber}</strong> has been placed successfully and is being processed.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #fff;">
            <thead>
              <tr style="background-color: #2c3e50; color: #fff;">
                <th style="padding: 10px; text-align: left;">Item</th>
                <th style="padding: 10px; text-align: center;">Qty</th>
                <th style="padding: 10px; text-align: right;">Price</th>
                <th style="padding: 10px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${buildOrderItemsHtml(data.items)}
            </tbody>
          </table>

          <table style="width: 100%; margin-top: 10px;">
            <tr>
              <td style="padding: 4px 10px; color: #555;">Subtotal:</td>
              <td style="padding: 4px 10px; text-align: right; color: #555;">${formatCurrency(data.itemsPrice)}</td>
            </tr>
            ${
              data.discountAmount > 0
                ? `<tr>
                    <td style="padding: 4px 10px; color: #27ae60;">Discount ${data.couponCode ? `(${data.couponCode})` : ''}:</td>
                    <td style="padding: 4px 10px; text-align: right; color: #27ae60;">-${formatCurrency(data.discountAmount)}</td>
                  </tr>`
                : ''
            }
            <tr>
              <td style="padding: 4px 10px; color: #555;">Shipping:</td>
              <td style="padding: 4px 10px; text-align: right; color: #555;">${formatCurrency(data.shippingPrice)}</td>
            </tr>
            <tr style="font-weight: bold; font-size: 16px;">
              <td style="padding: 10px; border-top: 2px solid #2c3e50; color: #2c3e50;">Total:</td>
              <td style="padding: 10px; border-top: 2px solid #2c3e50; text-align: right; color: #2c3e50;">${formatCurrency(data.totalPrice)}</td>
            </tr>
          </table>

          <h3 style="color: #2c3e50; margin-top: 25px;">Shipping Address</h3>
          <p style="color: #555; line-height: 1.6;">
            ${data.shippingAddress.fullName}<br/>
            ${data.shippingAddress.addressLine1}${data.shippingAddress.addressLine2 ? ', ' + data.shippingAddress.addressLine2 : ''}<br/>
            ${data.shippingAddress.city}, ${data.shippingAddress.state} ${data.shippingAddress.postalCode}<br/>
            ${data.shippingAddress.country}<br/>
            Phone: ${data.shippingAddress.phone}
          </p>

          <p style="color: #555; line-height: 1.6;">
            <strong>Payment Method:</strong> Cash on Delivery
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/orders" style="background-color: #2c3e50; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Order
            </a>
          </div>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          &copy; ${new Date().getFullYear()} BookStore. All rights reserved.
        </div>
      </div>
    `
  }),

  orderStatusUpdate: (data) => ({
    subject: `Order ${data.orderNumber} - Status Updated to ${data.status}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #2c3e50; padding: 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0;">📚 BookStore</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #2c3e50;">Order Status Update</h2>
          <p style="color: #555; line-height: 1.6;">
            Hi ${data.customerName}, your order <strong>${data.orderNumber}</strong> status has been updated to:
          </p>
          <div style="text-align: center; margin: 20px 0;">
            <span style="background-color: #2c3e50; color: #fff; padding: 10px 25px; border-radius: 20px; font-weight: bold; text-transform: uppercase; display: inline-block;">
              ${data.status}
            </span>
          </div>
          ${data.note ? `<p style="color: #555; line-height: 1.6;">Note: ${data.note}</p>` : ''}
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/orders" style="background-color: #2c3e50; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Track Your Order
            </a>
          </div>
        </div>
        <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
          &copy; ${new Date().getFullYear()} BookStore. All rights reserved.
        </div>
      </div>
    `
  })
};

/**
 * Send an email using a predefined template
 * @param {Object} options
 * @param {string} options.to - recipient email
 * @param {string} options.subject - override subject (optional, template provides default)
 * @param {string} options.template - template key
 * @param {Object} options.data - data to inject into template
 * @param {Array}  options.attachments - optional nodemailer attachments array
 */
const sendEmail = async ({ to, subject, template, data, attachments }) => {
  if (!emailTemplates[template]) {
    throw new Error(`Email template "${template}" not found`);
  }

  const { subject: templateSubject, html } = emailTemplates[template](data);

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to,
    subject: subject || templateSubject,
    html
  };

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  const info = await transporter.sendMail(mailOptions);
  console.log(`📧 Email sent: ${info.messageId} to ${to}`);
  return info;
};

module.exports = sendEmail;