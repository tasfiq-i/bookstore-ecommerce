const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Book = require('../models/Book');
const Coupon = require('../models/Coupon');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');

// ─────────────────────────────────────────────────────────
// Internal helper: builds a fully populated, priced cart summary
// Recomputes totals live from current Book prices/stock (never trusts stale cart data)
// ─────────────────────────────────────────────────────────
const buildCartSummary = async (userId) => {
  let cart = await Cart.findOne({ user: userId }).populate({
    path: 'items.book',
    select: 'title slug price discountPrice images stock lowStockThreshold isActive'
  });

  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }

  // Filter out items whose book was deleted or deactivated since being added
  const validItems = [];
  let removedItems = [];

  for (const item of cart.items) {
    if (!item.book || item.book.isActive === false) {
      removedItems.push(item.book ? item.book.title : 'A removed book');
      continue;
    }
    validItems.push(item);
  }

  // Persist removal of invalid items if any were found
  if (removedItems.length > 0) {
    cart.items = validItems;
    await cart.save();
  }

  const items = validItems.map((item) => {
    const book = item.book;
    const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
    const availableStock = book.stock;
    const isStockInsufficient = item.quantity > availableStock;

    return {
      _id: item._id,
      book: {
        _id: book._id,
        title: book.title,
        slug: book.slug,
        image: book.images && book.images.length > 0 ? book.images[0].url : null,
        price: book.price,
        discountPrice: book.discountPrice,
        effectivePrice,
        stock: availableStock,
        stockStatus: book.stock <= 0 ? 'out-of-stock' : book.stock <= book.lowStockThreshold ? 'low-stock' : 'in-stock'
      },
      quantity: item.quantity,
      lineTotal: Math.round(effectivePrice * item.quantity * 100) / 100,
      isStockInsufficient,
      maxAvailable: availableStock
    };
  });

  const subtotal = Math.round(
    items.reduce((sum, item) => sum + item.lineTotal, 0) * 100
  ) / 100;

  let discountAmount = 0;
  let couponInfo = null;

  if (cart.couponApplied && cart.couponApplied.code) {
    const coupon = await Coupon.findOne({ code: cart.couponApplied.code });

    if (coupon) {
      const validation = coupon.isValid(subtotal);
      if (validation.valid) {
        discountAmount = Math.round(coupon.calculateDiscount(subtotal) * 100) / 100;
        couponInfo = {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountAmount
        };
      } else {
        // Coupon became invalid (expired/limit reached) since it was applied — auto-remove
        cart.couponApplied = { code: null, discountAmount: 0 };
        await cart.save();
      }
    } else {
      cart.couponApplied = { code: null, discountAmount: 0 };
      await cart.save();
    }
  }

  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const hasStockIssues = items.some((item) => item.isStockInsufficient);

  return {
    cartId: cart._id,
    items,
    itemCount,
    subtotal,
    discountAmount,
    coupon: couponInfo,
    total: total < 0 ? 0 : total,
    hasStockIssues,
    removedItems
  };
};

// @desc    Get current user's cart
// @route   GET /api/cart
// @access  Private
exports.getCart = async (req, res, next) => {
  try {
    const summary = await buildCartSummary(req.user._id);

    let message = 'Cart fetched successfully';
    if (summary.removedItems.length > 0) {
      message = `Cart fetched successfully. ${summary.removedItems.length} item(s) were removed because they are no longer available: ${summary.removedItems.join(', ')}`;
    }

    return ApiResponse.success(res, 200, message, summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Add item to cart (or increment if already present)
// @route   POST /api/cart/items
// @access  Private
exports.addItem = async (req, res, next) => {
  try {
    const { bookId, quantity = 1 } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return next(new AppError('Invalid book ID', 400));
    }

    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) {
      return next(new AppError('Quantity must be at least 1', 400));
    }

    const book = await Book.findById(bookId);
    if (!book || !book.isActive) {
      return next(new AppError('Book not found or is no longer available', 404));
    }

    // ── Server-side stock validation (never trust the client) ──
    if (book.stock <= 0) {
      return next(new AppError(`"${book.title}" is currently out of stock`, 400));
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    const existingItem = cart.items.find((item) => item.book.toString() === bookId);
    const requestedTotalQty = existingItem ? existingItem.quantity + qty : qty;

    if (requestedTotalQty > book.stock) {
      return next(
        new AppError(
          `Cannot add ${qty} unit(s) of "${book.title}". Only ${book.stock - (existingItem ? existingItem.quantity : 0)} more available (${book.stock} in stock).`,
          400
        )
      );
    }

    const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
    cart.addItem(bookId, qty, effectivePrice);
    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, `"${book.title}" added to cart`, summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Update quantity of a specific cart item
// @route   PUT /api/cart/items/:bookId
// @access  Private
exports.updateItemQuantity = async (req, res, next) => {
  try {
    const { bookId } = req.params;
    const { quantity } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return next(new AppError('Invalid book ID', 400));
    }

    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1) {
      return next(new AppError('Quantity must be at least 1. Use the remove endpoint to delete an item.', 400));
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return next(new AppError('Cart not found', 404));
    }

    const existingItem = cart.items.find((item) => item.book.toString() === bookId);
    if (!existingItem) {
      return next(new AppError('Item not found in cart', 404));
    }

    const book = await Book.findById(bookId);
    if (!book || !book.isActive) {
      return next(new AppError('This book is no longer available', 404));
    }

    // ── Live stock validation on update ──
    if (qty > book.stock) {
      return next(
        new AppError(`Only ${book.stock} unit(s) of "${book.title}" are available in stock`, 400)
      );
    }

    const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
    cart.updateItemQuantity(bookId, qty);
    existingItem.priceAtAddition = effectivePrice;
    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, 'Cart updated successfully', summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Remove a specific item from cart
// @route   DELETE /api/cart/items/:bookId
// @access  Private
exports.removeItem = async (req, res, next) => {
  try {
    const { bookId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return next(new AppError('Invalid book ID', 400));
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return next(new AppError('Cart not found', 404));
    }

    const itemExists = cart.items.some((item) => item.book.toString() === bookId);
    if (!itemExists) {
      return next(new AppError('Item not found in cart', 404));
    }

    cart.removeItem(bookId);

    // If cart becomes empty, clear any applied coupon too
    if (cart.items.length === 0) {
      cart.couponApplied = { code: null, discountAmount: 0 };
    }

    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, 'Item removed from cart', summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Clear entire cart
// @route   DELETE /api/cart
// @access  Private
exports.clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return next(new AppError('Cart not found', 404));
    }

    cart.clearCart();
    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, 'Cart cleared successfully', summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Sync/validate entire cart against live stock (called on cart page load)
// @route   GET /api/cart/validate
// @access  Private
exports.validateCart = async (req, res, next) => {
  try {
    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(
      res,
      200,
      summary.hasStockIssues
        ? 'Some items in your cart have limited stock. Please review before checkout.'
        : 'Cart is valid and ready for checkout',
      summary
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Apply a coupon code to the cart
// @route   POST /api/cart/coupon
// @access  Private
exports.applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code || !code.trim()) {
      return next(new AppError('Coupon code is required', 400));
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: 'items.book',
      select: 'price discountPrice'
    });

    if (!cart || cart.items.length === 0) {
      return next(new AppError('Your cart is empty. Add items before applying a coupon.', 400));
    }

    const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
    if (!coupon) {
      return next(new AppError('Invalid coupon code', 404));
    }

    // Calculate current subtotal to validate against minPurchaseAmount
    const subtotal = Math.round(
      cart.items.reduce((sum, item) => {
        const price = item.book.discountPrice != null ? item.book.discountPrice : item.book.price;
        return sum + price * item.quantity;
      }, 0) * 100
    ) / 100;

    const validation = coupon.isValid(subtotal);
    if (!validation.valid) {
      return next(new AppError(validation.message, 400));
    }

    const discountAmount = Math.round(coupon.calculateDiscount(subtotal) * 100) / 100;

    cart.couponApplied = {
      code: coupon.code,
      discountAmount
    };
    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, `Coupon "${coupon.code}" applied successfully`, summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Remove applied coupon from cart
// @route   DELETE /api/cart/coupon
// @access  Private
exports.removeCoupon = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return next(new AppError('Cart not found', 404));
    }

    if (!cart.couponApplied || !cart.couponApplied.code) {
      return next(new AppError('No coupon is currently applied', 400));
    }

    cart.couponApplied = { code: null, discountAmount: 0 };
    await cart.save();

    const summary = await buildCartSummary(req.user._id);

    return ApiResponse.success(res, 200, 'Coupon removed successfully', summary);
  } catch (error) {
    next(error);
  }
};

// @desc    Get cart item count only (lightweight, for navbar badge)
// @route   GET /api/cart/count
// @access  Private
exports.getCartCount = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).select('items');

    const itemCount = cart
      ? cart.items.reduce((sum, item) => sum + item.quantity, 0)
      : 0;

    return ApiResponse.success(res, 200, 'Cart count fetched', { itemCount });
  } catch (error) {
    next(error);
  }
};