const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Book = require('../models/Book');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const sendEmail = require('../utils/sendEmail');
const { emitNewOrder, emitStockUpdate, emitOrderStatusChange } = require('../sockets/socketHandler');

const SHIPPING_FLAT_RATE = 60; // BDT flat shipping rate; swap for zone-based logic later if needed

// ─────────────────────────────────────────────────────────
// @desc    Place a new order (Cash on Delivery)
// @route   POST /api/orders
// @access  Private/Customer
// Body:
//   useSavedAddress: boolean
//   addressId: string (required if useSavedAddress = true)
//   shippingAddress: object (required if useSavedAddress = false) -
//     { fullName, phone, addressLine1, addressLine2, city, state, postalCode, country }
//   saveAddress: boolean (optional - if true and using a new address, save it to profile too)
//   notes: string (optional)
// ─────────────────────────────────────────────────────────
exports.placeOrder = async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    let createdOrder = null;
    let emailPayload = null;

    await session.withTransaction(async () => {
      const { useSavedAddress, addressId, shippingAddress, saveAddress, notes } = req.body;

      // ── Resolve shipping address ──
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

        // Optionally persist this one-time address to the user's profile
        if (saveAddress === true || saveAddress === 'true') {
          const isFirstAddress = user.addresses.length === 0;
          user.addresses.push({ ...resolvedAddress, isDefault: isFirstAddress });
          await user.save({ session, validateBeforeSave: false });
        }
      }

      // ── Load cart with fresh book data ──
      const cart = await Cart.findOne({ user: req.user._id })
        .populate({ path: 'items.book', select: 'title price discountPrice stock images isActive' })
        .session(session);

      if (!cart || cart.items.length === 0) {
        throw new AppError('Your cart is empty. Add items before checking out.', 400);
      }

      // ── Final atomic stock validation (last line of defense against overselling) ──
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

      // ── Build order item snapshots ──
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

      // ── Resolve coupon (re-validated at checkout time, not trusted from cart) ──
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
          // If invalid at this exact moment, silently proceed without discount
          // rather than blocking checkout — customer isn't penalized for a coupon expiring mid-checkout
        }
      }

      const shippingPrice = SHIPPING_FLAT_RATE;
      const totalPrice = Math.max(
        0,
        Math.round((itemsPrice - discountAmount + shippingPrice) * 100) / 100
      );

      // ── Create the order ──
      const order = await Order.create(
        [
          {
            user: req.user._id,
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

      // ── Decrement stock for every book in the order (atomic, within transaction) ──
      for (const item of orderItems) {
        const book = await Book.findById(item.book).session(session);
        if (book.stock < item.quantity) {
          // Re-check inside the transaction in case of a race condition since the earlier check
          throw new AppError(
            `"${book.title}" stock changed during checkout. Only ${book.stock} left. Please try again.`,
            409
          );
        }
        book.stock -= item.quantity;
        book.soldCount += item.quantity;
        await book.save({ session });
      }

      // ── Increment coupon usage count ──
      if (coupon && couponCode) {
        coupon.usedCount += 1;
        await coupon.save({ session });
      }

      // ── Clear the cart ──
      cart.clearCart();
      await cart.save({ session });

      // Prepare email payload for after successful commit
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

    // ── Post-transaction side effects (only run if transaction committed successfully) ──

    // Real-time: notify admin dashboard of new order
    const populatedOrder = await Order.findById(createdOrder._id).populate('user', 'name email');
    emitNewOrder(populatedOrder);

    // Real-time: notify catalog clients of stock changes for each affected book
    for (const item of populatedOrder.items) {
      const updatedBook = await Book.findById(item.book);
      if (updatedBook) emitStockUpdate(updatedBook);
    }

    // Send order confirmation email (non-blocking — order is already placed successfully)
    sendEmail({
      to: emailPayload.to,
      template: 'orderConfirmation',
      data: emailPayload
    }).catch((err) => console.error('Order confirmation email failed:', err.message));

    return ApiResponse.success(res, 201, 'Order placed successfully', { order: populatedOrder });
  } catch (error) {
    next(error);
  } finally {
    session.endSession();
  }
};

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

    if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
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

      if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        throw new AppError('You are not authorized to cancel this order', 403);
      }

      if (!['pending', 'confirmed'].includes(order.status)) {
        throw new AppError(
          `Order cannot be cancelled once it is "${order.status}". Please contact support.`,
          400
        );
      }

      // ── Restore stock for every item ──
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

    // Real-time: reflect restored stock on catalog + notify customer
    for (const item of updatedOrder.items) {
      const book = await Book.findById(item.book);
      if (book) emitStockUpdate(book);
    }
    emitOrderStatusChange(updatedOrder);

    sendEmail({
      to: req.user.email,
      template: 'orderStatusUpdate',
      data: {
        customerName: req.user.name,
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

    if (order.user.toString() !== req.user._id.toString()) {
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
        { 'shippingAddress.phone': { $regex: search, $options: 'i' } }
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

      // If admin cancels an order that was still in-progress, restore stock
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

      // Mark COD payment as paid upon delivery
      if (status === 'delivered') {
        order.paymentStatus = 'paid';
      }

      order.updateStatus(status, note || '');
      await order.save({ session });

      updatedOrder = order;
    });

    const populatedOrder = await Order.findById(updatedOrder._id).populate('user', 'name email');

    // Real-time: notify the specific customer of their order status change
    emitOrderStatusChange(populatedOrder);

    // If cancelled by admin, also broadcast restored stock to catalog
    if (status === 'cancelled') {
      for (const item of populatedOrder.items) {
        const book = await Book.findById(item.book);
        if (book) emitStockUpdate(book);
      }
    }

    sendEmail({
      to: populatedOrder.user.email,
      template: 'orderStatusUpdate',
      data: {
        customerName: populatedOrder.user.name,
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

// @desc    Update payment status (admin) — mainly for COD confirmation
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