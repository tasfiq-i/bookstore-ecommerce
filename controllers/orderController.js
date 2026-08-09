const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Book = require('../models/Book');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const sendEmail = require('../utils/sendEmail');
const generateInvoicePDF = require('../utils/generateInvoice');
const { emitNewOrder, emitStockUpdate, emitOrderStatusChange } = require('../sockets/socketHandler');

const SHIPPING_FLAT_RATE = 60; // BDT flat shipping rate

// ─────────────────────────────────────────────────────
// Invoice helper — single source of truth for PDF generation,
// used by placeOrder, placeGuestOrder, downloadInvoice, updateOrderStatus
// ─────────────────────────────────────────────────────
const ensureInvoiceGenerated = async (order) => {
  const invoicesDir = path.join(__dirname, '..', 'public', 'invoices');

  if (!fs.existsSync(invoicesDir)) {
    fs.mkdirSync(invoicesDir, { recursive: true });
  }

  const fileName = `${order.orderNumber}.pdf`;
  const filePath = path.join(invoicesDir, fileName);

  await generateInvoicePDF(order, filePath);

  return filePath;
};

// ═══════════════════════════════════════════════════════
// AUTHENTICATED CHECKOUT
// ═══════════════════════════════════════════════════════

// @desc    Place a new order (Cash on Delivery)
// @route   POST /api/orders
// @access  Private/Customer
exports.placeOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    let createdOrder = null;
    let emailPayload = null;

    await session.withTransaction(async () => {
      const { useSavedAddress, addressId, shippingAddress, saveAddress, notes } = req.body;

      const user = await User.findById(req.user._id).session(session);

      let resolvedAddress;

      if (useSavedAddress === true || useSavedAddress === 'true') {
        if (!addressId) {
          throw new AppError('addressId is required when using a saved address', 400);
        }
        const savedAddress = user.addresses.id(addressId);
        if (!savedAddress) {
          throw new AppError('Selected saved address not found on your profile', 404);
        }
        resolvedAddress = {
          fullName: savedAddress.fullName,
          phone: savedAddress.phone,
          addressLine1: savedAddress.addressLine1,
          addressLine2: savedAddress.addressLine2 || '',
          city: savedAddress.city,
          state: savedAddress.state,
          postalCode: savedAddress.postalCode,
          country: savedAddress.country
        };
      } else {
        if (!shippingAddress) {
          throw new AppError('shippingAddress is required when not using a saved address', 400);
        }
        const required = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
        const missing = required.filter((field) => !shippingAddress[field] || !shippingAddress[field].trim());
        if (missing.length > 0) {
          throw new AppError(`Missing required shipping address fields: ${missing.join(', ')}`, 400);
        }

        resolvedAddress = {
          fullName: shippingAddress.fullName.trim(),
          phone: shippingAddress.phone.trim(),
          addressLine1: shippingAddress.addressLine1.trim(),
          addressLine2: (shippingAddress.addressLine2 || '').trim(),
          city: shippingAddress.city.trim(),
          state: shippingAddress.state.trim(),
          postalCode: shippingAddress.postalCode.trim(),
          country: (shippingAddress.country || 'Bangladesh').trim()
        };

        if (saveAddress === true || saveAddress === 'true') {
          const isFirstAddress = user.addresses.length === 0;
          user.addresses.push({ ...resolvedAddress, isDefault: isFirstAddress });
          await user.save({ session, validateBeforeSave: false });
        }
      }

      const cart = await Cart.findOne({ user: req.user._id })
        .populate({ path: 'items.book', select: 'title price discountPrice stock images isActive' })
        .session(session);

      if (!cart || cart.items.length === 0) {
        throw new AppError('Your cart is empty. Add items before checking out.', 400);
      }

      const stockIssues = [];
      for (const item of cart.items) {
        if (!item.book || !item.book.isActive) {
          stockIssues.push(`An item in your cart is no longer available`);
          continue;
        }
        if (item.quantity > item.book.stock) {
          stockIssues.push(
            `"${item.book.title}" — only ${item.book.stock} unit(s) left, but ${item.quantity} requested`
          );
        }
      }

      if (stockIssues.length > 0) {
        throw new AppError(`Cannot place order due to stock issues: ${stockIssues.join('; ')}`, 409);
      }

      const orderItems = cart.items.map((item) => {
        const effectivePrice = item.book.discountPrice != null ? item.book.discountPrice : item.book.price;
        return {
          book: item.book._id,
          title: item.book.title,
          image: item.book.images && item.book.images.length > 0 ? item.book.images[0].url : '',
          quantity: item.quantity,
          price: effectivePrice
        };
      });

      const itemsPrice = Math.round(
        orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100
      ) / 100;

      let discountAmount = 0;
      let couponCode = null;
      let coupon = null;

      if (cart.couponApplied && cart.couponApplied.code) {
        coupon = await Coupon.findOne({ code: cart.couponApplied.code }).session(session);
        if (coupon) {
          const validation = coupon.isValid(itemsPrice);
          if (validation.valid) {
            discountAmount = Math.round(coupon.calculateDiscount(itemsPrice) * 100) / 100;
            couponCode = coupon.code;
          }
        }
      }

      const shippingPrice = SHIPPING_FLAT_RATE;
      const totalPrice = Math.max(
        0,
        Math.round((itemsPrice - discountAmount + shippingPrice) * 100) / 100
      );

      const order = await Order.create(
        [
          {
            user: req.user._id,
            isGuestOrder: false,
            items: orderItems,
            shippingAddress: resolvedAddress,
            paymentMethod: 'COD',
            paymentStatus: 'pending',
            itemsPrice,
            discountAmount,
            couponCode,
            shippingPrice,
            totalPrice,
            status: 'pending',
            notes: notes ? notes.trim().slice(0, 500) : ''
          }
        ],
        { session }
      );

      createdOrder = order[0];

      for (const item of orderItems) {
        const book = await Book.findById(item.book).session(session);
        if (book.stock < item.quantity) {
          throw new AppError(
            `"${book.title}" stock changed during checkout. Only ${book.stock} left. Please try again.`,
            409
          );
        }
        book.stock -= item.quantity;
        book.soldCount += item.quantity;
        await book.save({ session });
      }

      if (coupon && couponCode) {
        coupon.usedCount += 1;
        await coupon.save({ session });
      }

      cart.clearCart();
      await cart.save({ session });

      emailPayload = {
        to: req.user.email,
        customerName: resolvedAddress.fullName,
        orderNumber: createdOrder.orderNumber,
        items: orderItems,
        itemsPrice,
        discountAmount,
        couponCode,
        shippingPrice,
        totalPrice,
        shippingAddress: resolvedAddress
      };
    });

    const populatedOrder = await Order.findById(createdOrder._id).populate('user', 'name email');
    emitNewOrder(populatedOrder);

    for (const item of populatedOrder.items) {
      const updatedBook = await Book.findById(item.book);
      if (updatedBook) emitStockUpdate(updatedBook);
    }

    let invoicePath = null;
    try {
      invoicePath = await ensureInvoiceGenerated(populatedOrder);
      populatedOrder.invoiceUrl = `/invoices/${populatedOrder.orderNumber}.pdf`;
      await Order.findByIdAndUpdate(populatedOrder._id, { invoiceUrl: populatedOrder.invoiceUrl });
    } catch (invoiceError) {
      console.error('Invoice generation failed (order still placed successfully):', invoiceError.message);
    }

    sendEmail({
      to: emailPayload.to,
      template: 'orderConfirmation',
      data: emailPayload,
      attachments: invoicePath
        ? [{ filename: `Invoice-${populatedOrder.orderNumber}.pdf`, path: invoicePath }]
        : []
    }).catch((err) => console.error('Order confirmation email failed:', err.message));

    return ApiResponse.success(res, 201, 'Order placed successfully', { order: populatedOrder });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

// ═══════════════════════════════════════════════════════
// GUEST CHECKOUT
// ═══════════════════════════════════════════════════════

// @desc    Place a guest order (no account required)
// @route   POST /api/orders/guest
// @access  Public
exports.placeGuestOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    let createdOrder = null;
    let emailPayload = null;

    await session.withTransaction(async () => {
      const { items, guestInfo, shippingAddress, notes } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('Your cart is empty. Add items before checking out.', 400);
      }
      if (!guestInfo || !guestInfo.name || !guestInfo.email || !guestInfo.phone) {
        throw new AppError('Please provide your name, email, and phone number', 400);
      }

      const required = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
      const missing = required.filter((f) => !shippingAddress || !shippingAddress[f] || !shippingAddress[f].trim());
      if (missing.length > 0) {
        throw new AppError(`Missing required shipping address fields: ${missing.join(', ')}`, 400);
      }

      const resolvedAddress = {
        fullName: shippingAddress.fullName.trim(),
        phone: shippingAddress.phone.trim(),
        addressLine1: shippingAddress.addressLine1.trim(),
        addressLine2: (shippingAddress.addressLine2 || '').trim(),
        city: shippingAddress.city.trim(),
        state: shippingAddress.state.trim(),
        postalCode: shippingAddress.postalCode.trim(),
        country: (shippingAddress.country || 'Bangladesh').trim()
      };

      const orderItems = [];
      const stockIssues = [];

      for (const reqItem of items) {
        if (!reqItem.bookId || !mongoose.Types.ObjectId.isValid(reqItem.bookId)) {
          throw new AppError('Invalid item in cart', 400);
        }
        const qty = parseInt(reqItem.quantity, 10);
        if (!qty || qty < 1) {
          throw new AppError('Invalid quantity in cart', 400);
        }

        const book = await Book.findById(reqItem.bookId).session(session);

        if (!book || !book.isActive) {
          stockIssues.push('An item in your cart is no longer available');
          continue;
        }
        if (qty > book.stock) {
          stockIssues.push(`"${book.title}" — only ${book.stock} unit(s) left, but ${qty} requested`);
          continue;
        }

        const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
        orderItems.push({
          book: book._id,
          title: book.title,
          image: book.images && book.images.length > 0 ? book.images[0].url : '',
          quantity: qty,
          price: effectivePrice
        });
      }

      if (stockIssues.length > 0) {
        throw new AppError(`Cannot place order: ${stockIssues.join('; ')}`, 409);
      }
      if (orderItems.length === 0) {
        throw new AppError('No valid items found in your cart', 400);
      }

      const itemsPrice = Math.round(
        orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100
      ) / 100;

      const shippingPrice = SHIPPING_FLAT_RATE;
      const totalPrice = Math.round((itemsPrice + shippingPrice) * 100) / 100;

      const order = await Order.create(
        [
          {
            user: null,
            isGuestOrder: true,
            guestInfo: {
              name: guestInfo.name.trim(),
              email: guestInfo.email.trim().toLowerCase(),
              phone: guestInfo.phone.trim()
            },
            items: orderItems,
            shippingAddress: resolvedAddress,
            paymentMethod: 'COD',
            paymentStatus: 'pending',
            itemsPrice,
            discountAmount: 0,
            couponCode: null,
            shippingPrice,
            totalPrice,
            status: 'pending',
            notes: notes ? notes.trim().slice(0, 500) : ''
          }
        ],
        { session }
      );

      createdOrder = order[0];

      for (const item of orderItems) {
        const book = await Book.findById(item.book).session(session);
        if (book.stock < item.quantity) {
          throw new AppError(`"${book.title}" stock changed during checkout. Please try again.`, 409);
        }
        book.stock -= item.quantity;
        book.soldCount += item.quantity;
        await book.save({ session });
      }

      emailPayload = {
        to: guestInfo.email.trim().toLowerCase(),
        customerName: resolvedAddress.fullName,
        orderNumber: createdOrder.orderNumber,
        items: orderItems,
        itemsPrice,
        discountAmount: 0,
        couponCode: null,
        shippingPrice,
        totalPrice,
        shippingAddress: resolvedAddress
      };
    });

    emitNewOrder(createdOrder);

    for (const item of createdOrder.items) {
      const updatedBook = await Book.findById(item.book);
      if (updatedBook) emitStockUpdate(updatedBook);
    }

    let invoicePath = null;
    try {
      invoicePath = await ensureInvoiceGenerated(createdOrder);
      createdOrder.invoiceUrl = `/invoices/${createdOrder.orderNumber}.pdf`;
      await Order.findByIdAndUpdate(createdOrder._id, { invoiceUrl: createdOrder.invoiceUrl });
    } catch (e) {
      console.error('Guest invoice generation failed:', e.message);
    }

    sendEmail({
      to: emailPayload.to,
      template: 'orderConfirmation',
      data: emailPayload,
      attachments: invoicePath ? [{ filename: `Invoice-${createdOrder.orderNumber}.pdf`, path: invoicePath }] : []
    }).catch((err) => console.error('Guest order confirmation email failed:', err.message));

    return ApiResponse.success(res, 201, 'Order placed successfully', {
      order: {
        _id: createdOrder._id,
        orderNumber: createdOrder.orderNumber,
        totalPrice: createdOrder.totalPrice,
        status: createdOrder.status,
        guestEmail: emailPayload.to
      }
    });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

// @desc    Guest order lookup by order number + email
// @route   GET /api/orders/guest/:orderNumber
// @access  Public
exports.getGuestOrder = async (req, res, next) => {
  try {
    const { orderNumber } = req.params;
    const { email } = req.query;

    if (!email) {
      return next(new AppError('Email is required to look up a guest order', 400));
    }

    const order = await Order.findOne({
      orderNumber,
      isGuestOrder: true,
      'guestInfo.email': email.trim().toLowerCase()
    });

    if (!order) {
      return next(new AppError('Order not found. Please check your order number and email.', 404));
    }

    return ApiResponse.success(res, 200, 'Order fetched successfully', { order });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// SHARED (AUTHENTICATED) ORDER ACTIONS
// ═══════════════════════════════════════════════════════

// @desc    Get logged-in user's order history
// @route   GET /api/orders/my-orders
// @access  Private
exports.getMyOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [orders, totalCount] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Order.countDocuments(filter)
    ]);

    return ApiResponse.success(res, 200, 'Orders fetched successfully', { orders }, {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalResults: totalCount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single order detail (owner or admin only)
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email phone');

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    if (order.isGuestOrder) {
      if (req.user.role !== 'admin') {
        return next(new AppError('You are not authorized to view this order', 403));
      }
    } else if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('You are not authorized to view this order', 403));
    }

    return ApiResponse.success(res, 200, 'Order fetched successfully', { order });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel an order (customer, only if still pending/confirmed)
// @route   PUT /api/orders/:id/cancel
// @access  Private
exports.cancelOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { reason } = req.body;
    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.isGuestOrder && req.user.role !== 'admin') {
        throw new AppError('You are not authorized to cancel this order', 403);
      }
      if (!order.isGuestOrder && order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new AppError('You are not authorized to cancel this order', 403);
      }

      if (!['pending', 'confirmed'].includes(order.status)) {
        throw new AppError(
          `Order cannot be cancelled once it is "${order.status}". Please contact support.`,
          400
        );
      }

      for (const item of order.items) {
        const book = await Book.findById(item.book).session(session);
        if (book) {
          book.stock += item.quantity;
          book.soldCount = Math.max(0, book.soldCount - item.quantity);
          await book.save({ session });
        }
      }

      order.updateStatus('cancelled', reason || 'Cancelled by customer');
      await order.save({ session });

      updatedOrder = order;
    });

    for (const item of updatedOrder.items) {
      const book = await Book.findById(item.book);
      if (book) emitStockUpdate(book);
    }
    emitOrderStatusChange(updatedOrder);

    const notifyEmail = updatedOrder.isGuestOrder ? updatedOrder.guestInfo.email : req.user.email;
    const notifyName = updatedOrder.isGuestOrder ? updatedOrder.guestInfo.name : req.user.name;

    sendEmail({
      to: notifyEmail,
      template: 'orderStatusUpdate',
      data: {
        customerName: notifyName,
        orderNumber: updatedOrder.orderNumber,
        status: 'cancelled',
        note: updatedOrder.cancellationReason
      }
    }).catch((err) => console.error('Cancellation email failed:', err.message));

    return ApiResponse.success(res, 200, 'Order cancelled successfully', { order: updatedOrder });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

// @desc    Reorder — add all items from a past order back into the cart
// @route   POST /api/orders/:id/reorder
// @access  Private
exports.reorder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    if (order.isGuestOrder || order.user.toString() !== req.user._id.toString()) {
      return next(new AppError('You are not authorized to reorder this order', 403));
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    const unavailableItems = [];
    const addedItems = [];

    for (const orderItem of order.items) {
      const book = await Book.findById(orderItem.book);

      if (!book || !book.isActive || book.stock <= 0) {
        unavailableItems.push(orderItem.title);
        continue;
      }

      const qtyToAdd = Math.min(orderItem.quantity, book.stock);
      const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
      cart.addItem(book._id, qtyToAdd, effectivePrice);
      addedItems.push(book.title);
    }

    await cart.save();

    let message = `${addedItems.length} item(s) added to your cart`;
    if (unavailableItems.length > 0) {
      message += `. ${unavailableItems.length} item(s) unavailable: ${unavailableItems.join(', ')}`;
    }

    return ApiResponse.success(res, 200, message, { addedItems, unavailableItems });
  } catch (error) {
    next(error);
  }
};

// @desc    Download/view the PDF invoice for an order (owner or admin only)
// @route   GET /api/orders/:id/invoice
// @access  Private
exports.downloadInvoice = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email');

    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    if (order.isGuestOrder) {
      if (req.user.role !== 'admin') {
        return next(new AppError('You are not authorized to access this invoice', 403));
      }
    } else if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('You are not authorized to access this invoice', 403));
    }

    const invoicesDir = path.join(__dirname, '..', 'public', 'invoices');
    const filePath = path.join(invoicesDir, `${order.orderNumber}.pdf`);

    if (!fs.existsSync(filePath)) {
      await ensureInvoiceGenerated(order);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${order.orderNumber}.pdf"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', () => {
      next(new AppError('Failed to stream invoice file', 500));
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// ADMIN ORDER MANAGEMENT
// ═══════════════════════════════════════════════════════

// @desc    Get all orders (admin) with filters
// @route   GET /api/orders
// @access  Private/Admin
exports.getAllOrders = async (req, res, next) => {
  try {
    const { status, paymentStatus, search, startDate, endDate, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'shippingAddress.fullName': { $regex: search, $options: 'i' } },
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } },
        { 'guestInfo.email': { $regex: search, $options: 'i' } }
      ];
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [orders, totalCount] = await Promise.all([
      Order.find(filter)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(filter)
    ]);

    return ApiResponse.success(res, 200, 'Orders fetched successfully', { orders }, {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalResults: totalCount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update order status (admin)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { status, note } = req.body;
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return next(new AppError('Invalid order status', 400));
    }

    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      if (order.status === 'cancelled') {
        throw new AppError('Cannot change status of a cancelled order', 400);
      }

      if (order.status === 'delivered' && status !== 'delivered') {
        throw new AppError('Cannot change status of a delivered order', 400);
      }

      if (status === 'cancelled' && order.status !== 'cancelled') {
        for (const item of order.items) {
          const book = await Book.findById(item.book).session(session);
          if (book) {
            book.stock += item.quantity;
            book.soldCount = Math.max(0, book.soldCount - item.quantity);
            await book.save({ session });
          }
        }
      }

      if (status === 'delivered') {
        order.paymentStatus = 'paid';
      }

      order.updateStatus(status, note || '');
      await order.save({ session });

      updatedOrder = order;
    });

    const populatedOrder = await Order.findById(updatedOrder._id).populate('user', 'name email');

    if (!populatedOrder.isGuestOrder) {
      emitOrderStatusChange(populatedOrder);
    }

    if (status === 'cancelled') {
      for (const item of populatedOrder.items) {
        const book = await Book.findById(item.book);
        if (book) emitStockUpdate(book);
      }
    }

    ensureInvoiceGenerated(populatedOrder).catch((err) =>
      console.error('Invoice regeneration after status update failed:', err.message)
    );

    const notifyEmail = populatedOrder.isGuestOrder ? populatedOrder.guestInfo.email : populatedOrder.user.email;
    const notifyName = populatedOrder.isGuestOrder ? populatedOrder.guestInfo.name : populatedOrder.user.name;

    sendEmail({
      to: notifyEmail,
      template: 'orderStatusUpdate',
      data: {
        customerName: notifyName,
        orderNumber: populatedOrder.orderNumber,
        status: populatedOrder.status,
        note: note || ''
      }
    }).catch((err) => console.error('Status update email failed:', err.message));

    return ApiResponse.success(res, 200, 'Order status updated successfully', { order: populatedOrder });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

// @desc    Update payment status (admin)
// @route   PUT /api/orders/:id/payment-status
// @access  Private/Admin
exports.updatePaymentStatus = async (req, res, next) => {
  try {
    const { paymentStatus } = req.body;
    const validStatuses = ['pending', 'paid', 'failed'];

    if (!validStatuses.includes(paymentStatus)) {
      return next(new AppError('Invalid payment status', 400));
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return next(new AppError('Order not found', 404));
    }

    order.paymentStatus = paymentStatus;
    await order.save();

    return ApiResponse.success(res, 200, 'Payment status updated successfully', { order });
  } catch (error) {
    next(error);
  }
};