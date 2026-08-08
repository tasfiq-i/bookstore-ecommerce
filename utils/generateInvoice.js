const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const COLORS = {
  primary: '#2c3e50',
  accent: '#e67e22',
  muted: '#7f8c8d',
  lightGray: '#f4f6f8',
  border: '#dfe4ea',
  success: '#27ae60',
  text: '#2d3436'
};

const formatCurrency = (amount) => `Tk ${Number(amount).toFixed(2)}`;

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

/**
 * Generates a professional, text-only PDF invoice for an order.
 * @param {Object} order - Mongoose Order document (should be populated with `user`)
 * @param {String} outputPath - Absolute file path to write the PDF to
 * @returns {Promise<String>} resolves with outputPath on success
 */
const generateInvoicePDF = (order, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const stream = fs.createWriteStream(outputPath);

      doc.pipe(stream);

      // ═══════════════════════════════════════════════
      // HEADER
      // ═══════════════════════════════════════════════
      doc
        .fillColor(COLORS.primary)
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('BookStore', 50, 50);

      doc
        .fillColor(COLORS.muted)
        .fontSize(9)
        .font('Helvetica')
        .text('Comilla, Chittagong, Bangladesh', 50, 78)
        .text('support@bookstore.com  |  +880 1XXX-XXXXXX', 50, 91);

      doc
        .fillColor(COLORS.primary)
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('INVOICE', 400, 50, { width: 145, align: 'right' });

      doc
        .fillColor(COLORS.muted)
        .fontSize(9)
        .font('Helvetica')
        .text(`Invoice #: ${order.orderNumber}`, 350, 78, { width: 195, align: 'right' })
        .text(`Date: ${formatDate(order.createdAt)}`, 350, 91, { width: 195, align: 'right' })
        .text(`Status: ${order.status.toUpperCase()}`, 350, 104, { width: 195, align: 'right' });

      // Divider
      doc
        .moveTo(50, 130)
        .lineTo(545, 130)
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .stroke();

      // ═══════════════════════════════════════════════
      // BILL TO / SHIP TO
      // ═══════════════════════════════════════════════
      const infoTop = 150;

      doc
        .fillColor(COLORS.primary)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('BILLED TO', 50, infoTop);

      doc
        .fillColor(COLORS.text)
        .fontSize(9.5)
        .font('Helvetica')
        .text(order.shippingAddress.fullName, 50, infoTop + 16)
        .text(order.shippingAddress.phone, 50, infoTop + 30);

      if (order.user && order.user.email) {
        doc.text(order.user.email, 50, infoTop + 44);
      }

      doc
        .fillColor(COLORS.primary)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('SHIPPING ADDRESS', 300, infoTop, { width: 245 });

      const addrLine2 = order.shippingAddress.addressLine2
        ? `${order.shippingAddress.addressLine1}, ${order.shippingAddress.addressLine2}`
        : order.shippingAddress.addressLine1;

      doc
        .fillColor(COLORS.text)
        .fontSize(9.5)
        .font('Helvetica')
        .text(addrLine2, 300, infoTop + 16, { width: 245 })
        .text(
          `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}`,
          300,
          infoTop + 44,
          { width: 245 }
        )
        .text(order.shippingAddress.country, 300, infoTop + 58, { width: 245 });

      doc
        .fillColor(COLORS.primary)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text('PAYMENT METHOD', 50, infoTop + 70);

      doc
        .fillColor(COLORS.text)
        .fontSize(9.5)
        .font('Helvetica')
        .text('Cash on Delivery (COD)', 50, infoTop + 86)
        .text(`Payment Status: ${order.paymentStatus.toUpperCase()}`, 50, infoTop + 100);

      // ═══════════════════════════════════════════════
      // ITEMS TABLE
      // ═══════════════════════════════════════════════
      const tableTop = infoTop + 140;
      const colX = { item: 50, qty: 330, price: 390, total: 470 };
      const colW = { item: 270, qty: 50, price: 70, total: 75 };

      // Table header
      doc.rect(50, tableTop, 495, 24).fill(COLORS.primary);
      doc
        .fillColor('#ffffff')
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('ITEM', colX.item + 8, tableTop + 7)
        .text('QTY', colX.qty, tableTop + 7, { width: colW.qty, align: 'center' })
        .text('PRICE', colX.price, tableTop + 7, { width: colW.price, align: 'right' })
        .text('TOTAL', colX.total, tableTop + 7, { width: colW.total - 8, align: 'right' });

      let rowY = tableTop + 24;
      const rowHeight = 26;

      order.items.forEach((item, index) => {
        const isEven = index % 2 === 0;
        if (isEven) {
          doc.rect(50, rowY, 495, rowHeight).fill(COLORS.lightGray);
        }

        doc
          .fillColor(COLORS.text)
          .fontSize(9)
          .font('Helvetica')
          .text(truncateText(item.title, 48), colX.item + 8, rowY + 8, { width: colW.item - 10 })
          .text(String(item.quantity), colX.qty, rowY + 8, { width: colW.qty, align: 'center' })
          .text(formatCurrency(item.price), colX.price, rowY + 8, { width: colW.price, align: 'right' })
          .text(formatCurrency(item.price * item.quantity), colX.total, rowY + 8, {
            width: colW.total - 8,
            align: 'right'
          });

        rowY += rowHeight;

        // Page break handling for long orders
        if (rowY > 700) {
          doc.addPage();
          rowY = 50;
        }
      });

      // Bottom border of table
      doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor(COLORS.border).lineWidth(1).stroke();

      // ═══════════════════════════════════════════════
      // SUMMARY
      // ═══════════════════════════════════════════════
      let summaryY = rowY + 20;
      const summaryLabelX = 350;
      const summaryValueX = 470;
      const summaryValueW = 75;

      const summaryRow = (label, value, opts = {}) => {
        doc
          .fillColor(opts.color || COLORS.text)
          .fontSize(opts.size || 9.5)
          .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
          .text(label, summaryLabelX, summaryY, { width: 110 })
          .text(value, summaryValueX, summaryY, { width: summaryValueW, align: 'right' });
        summaryY += opts.spacing || 18;
      };

      summaryRow('Subtotal', formatCurrency(order.itemsPrice));

      if (order.discountAmount > 0) {
        summaryRow(
          `Discount ${order.couponCode ? `(${order.couponCode})` : ''}`,
          `-${formatCurrency(order.discountAmount)}`,
          { color: COLORS.success }
        );
      }

      summaryRow('Shipping', formatCurrency(order.shippingPrice));

      doc
        .moveTo(summaryLabelX, summaryY)
        .lineTo(545, summaryY)
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .stroke();
      summaryY += 10;

      summaryRow('TOTAL', formatCurrency(order.totalPrice), {
        bold: true,
        size: 13,
        color: COLORS.primary,
        spacing: 24
      });

      // ═══════════════════════════════════════════════
      // NOTES
      // ═══════════════════════════════════════════════
      if (order.notes) {
        summaryY += 10;
        doc
          .fillColor(COLORS.primary)
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('ORDER NOTES', 50, summaryY);
        doc
          .fillColor(COLORS.text)
          .fontSize(9)
          .font('Helvetica')
          .text(order.notes, 50, summaryY + 14, { width: 495 });
      }

      // ═══════════════════════════════════════════════
      // FOOTER
      // ═══════════════════════════════════════════════
      const footerY = 760;
      doc
        .moveTo(50, footerY)
        .lineTo(545, footerY)
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .stroke();

      doc
        .fillColor(COLORS.muted)
        .fontSize(8.5)
        .font('Helvetica')
        .text('Thank you for shopping with BookStore!', 50, footerY + 10, { width: 495, align: 'center' })
        .text(
          'This is a computer-generated invoice and does not require a signature.',
          50,
          footerY + 24,
          { width: 495, align: 'center' }
        );

      doc.end();

      stream.on('finish', () => resolve(outputPath));
      stream.on('error', (err) => reject(err));
    } catch (error) {
      reject(error);
    }
  });
};

function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength - 1) + '…' : text;
}

module.exports = generateInvoicePDF;