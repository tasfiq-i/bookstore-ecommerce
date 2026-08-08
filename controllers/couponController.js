const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const generateCouponCode = require('../utils/generateCouponCode');

// ═══════════════════════════════════════════════════════
// PUBLIC / CUSTOMER
// ═══════════════════════════════════════════════════════

// @desc    Validate a coupon code against the current cart (pre-flight check)
// @route   POST /api/coupons/validate
// @access  Private/Customer
// Body: { code }
// This does NOT apply the coupon — it's a read-only check the frontend can call
// as the user types a code, before committing via POST /api/cart/coupon (Step 7).
exports.validateCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;

    if (!code || !code.trim()) {
      return next(new AppError('Coupon code is required', 400));
    }

    const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });

    if (!coupon) {
      return ApiResponse.success(res, 200, 'Coupon check complete', {
        valid: false,
        message: 'Invalid coupon code'
      });
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: 'items.book',
      select: 'price discountPrice'
    });

    const subtotal =
      cart && cart.items.length > 0
        ? Math.round(
            cart.items.reduce((sum, item) => {
              const price = item.book.discountPrice != null ? item.book.discountPrice : item.book.price;
              return sum + price * item.quantity;
            }, 0) * 100
          ) / 100
        : 0;

    const validation = coupon.isValid(subtotal);

    if (!validation.valid) {
      return ApiResponse.success(res, 200, 'Coupon check complete', {
        valid: false,
        message: validation.message
      });
    }

    const estimatedDiscount = Math.round(coupon.calculateDiscount(subtotal) * 100) / 100;

    return ApiResponse.success(res, 200, 'Coupon is valid', {
      valid: true,
      message: 'Coupon is valid and can be applied',
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      estimatedDiscount,
      minPurchaseAmount: coupon.minPurchaseAmount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of currently active, publicly displayable coupons (e.g., for a promo banner)
// @route   GET /api/coupons/active
// @access  Public
exports.getActivePublicCoupons = async (req, res, next) => {
  try {
    const now = new Date();

    const coupons = await Coupon.find({
      isActive: true,
      expiryDate: { $gt: now },
      $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }]
    })
      .select('code description discountType discountValue minPurchaseAmount maxDiscountAmount expiryDate')
      .sort({ createdAt: -1 })
      .limit(10);

    return ApiResponse.success(res, 200, 'Active coupons fetched successfully', { coupons });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// ADMIN CRUD
// ═══════════════════════════════════════════════════════

// @desc    Get all coupons (admin) with filters
// @route   GET /api/coupons
// @access  Private/Admin
exports.getAllCoupons = async (req, res, next) => {
  try {
    const { search, isActive, status, page = 1, limit = 20 } = req.query;

    const filter = {};
    const now = new Date();

    if (search) {
      filter.code = { $regex: search, $options: 'i' };
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    // status: 'expired' | 'exhausted' | 'live'
    if (status === 'expired') {
      filter.expiryDate = { $lte: now };
    } else if (status === 'live') {
      filter.expiryDate = { $gt: now };
      filter.isActive = true;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [coupons, totalCount] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Coupon.countDocuments(filter)
    ]);

    // Annotate each coupon with a computed live status for the admin UI
    const annotated = coupons.map((c) => {
      const obj = c.toObject();
      let computedStatus = 'live';
      if (!c.isActive) computedStatus = 'disabled';
      else if (c.expiryDate <= now) computedStatus = 'expired';
      else if (c.usageLimit != null && c.usedCount >= c.usageLimit) computedStatus = 'exhausted';
      obj.computedStatus = computedStatus;
      return obj;
    });

    return ApiResponse.success(res, 200, 'Coupons fetched successfully', { coupons: annotated }, {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalResults: totalCount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single coupon detail
// @route   GET /api/coupons/:id
// @access  Private/Admin
exports.getCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError('Coupon not found', 404));
    }

    return ApiResponse.success(res, 200, 'Coupon fetched successfully', { coupon });
  } catch (error) {
    next(error);
  }
};

// @desc    Generate a random coupon code (does NOT create the coupon, just returns a suggested code)
// @route   POST /api/coupons/generate-code
// @access  Private/Admin
// Body: { prefix?: string, length?: number }
exports.generateCode = async (req, res, next) => {
  try {
    const { prefix, length } = req.body;

    let attempts = 0;
    let code;
    let isUnique = false;

    // Regenerate on the rare chance of a collision (checked against DB)
    while (!isUnique && attempts < 10) {
      code = generateCouponCode({
        prefix,
        length: length && length >= 4 && length <= 12 ? parseInt(length, 10) : 6
      });
      const existing = await Coupon.findOne({ code });
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      return next(new AppError('Failed to generate a unique coupon code. Please try again.', 500));
    }

    return ApiResponse.success(res, 200, 'Coupon code generated successfully', { code });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new coupon
// @route   POST /api/coupons
// @access  Private/Admin
exports.createCoupon = async (req, res, next) => {
  try {
    const {
      code,
      autoGenerate,
      prefix,
      description,
      discountType,
      discountValue,
      minPurchaseAmount,
      maxDiscountAmount,
      usageLimit,
      expiryDate
    } = req.body;

    let finalCode;

    if (autoGenerate === true || autoGenerate === 'true') {
      let attempts = 0;
      let isUnique = false;
      while (!isUnique && attempts < 10) {
        finalCode = generateCouponCode({ prefix });
        const existing = await Coupon.findOne({ code: finalCode });
        if (!existing) isUnique = true;
        attempts++;
      }
      if (!isUnique) {
        return next(new AppError('Failed to generate a unique coupon code. Please try again.', 500));
      }
    } else {
      if (!code || !code.trim()) {
        return next(new AppError('Coupon code is required when not using auto-generation', 400));
      }
      finalCode = code.trim().toUpperCase();

      const existing = await Coupon.findOne({ code: finalCode });
      if (existing) {
        return next(new AppError(`Coupon code "${finalCode}" already exists`, 400));
      }
    }

    const couponData = {
      code: finalCode,
      description: description || '',
      discountType,
      discountValue: parseFloat(discountValue),
      expiryDate
    };

    if (minPurchaseAmount !== undefined) couponData.minPurchaseAmount = parseFloat(minPurchaseAmount);
    if (maxDiscountAmount !== undefined && maxDiscountAmount !== '') {
      couponData.maxDiscountAmount = parseFloat(maxDiscountAmount);
    }
    if (usageLimit !== undefined && usageLimit !== '') {
      couponData.usageLimit = parseInt(usageLimit, 10);
    }

    const coupon = await Coupon.create(couponData);

    return ApiResponse.success(res, 201, `Coupon "${coupon.code}" created successfully`, { coupon });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
exports.updateCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError('Coupon not found', 404));
    }

    const {
      code,
      description,
      discountType,
      discountValue,
      minPurchaseAmount,
      maxDiscountAmount,
      usageLimit,
      expiryDate,
      isActive
    } = req.body;

    // Changing the code after usage has begun could confuse customers who saved/shared it —
    // we allow it, but warn via a friendly check on already-used coupons.
    if (code && code.trim().toUpperCase() !== coupon.code) {
      if (coupon.usedCount > 0) {
        return next(
          new AppError(
            `Cannot change the code of a coupon that has already been used ${coupon.usedCount} time(s). Deactivate it and create a new one instead.`,
            400
          )
        );
      }
      const newCode = code.trim().toUpperCase();
      const existing = await Coupon.findOne({ code: newCode, _id: { $ne: coupon._id } });
      if (existing) {
        return next(new AppError(`Coupon code "${newCode}" already exists`, 400));
      }
      coupon.code = newCode;
    }

    if (description !== undefined) coupon.description = description;
    if (discountType) coupon.discountType = discountType;
    if (discountValue !== undefined) coupon.discountValue = parseFloat(discountValue);
    if (minPurchaseAmount !== undefined) coupon.minPurchaseAmount = parseFloat(minPurchaseAmount);
    if (maxDiscountAmount !== undefined) {
      coupon.maxDiscountAmount = maxDiscountAmount === '' || maxDiscountAmount === null
        ? null
        : parseFloat(maxDiscountAmount);
    }
    if (usageLimit !== undefined) {
      coupon.usageLimit = usageLimit === '' || usageLimit === null ? null : parseInt(usageLimit, 10);
    }
    if (expiryDate) coupon.expiryDate = expiryDate;
    if (isActive !== undefined) coupon.isActive = isActive === true || isActive === 'true';

    await coupon.save();

    return ApiResponse.success(res, 200, 'Coupon updated successfully', { coupon });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle coupon active/inactive (quick enable/disable without full edit)
// @route   PATCH /api/coupons/:id/toggle
// @access  Private/Admin
exports.toggleCouponStatus = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError('Coupon not found', 404));
    }

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    return ApiResponse.success(
      res,
      200,
      `Coupon "${coupon.code}" ${coupon.isActive ? 'activated' : 'deactivated'} successfully`,
      { coupon }
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
exports.deleteCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError('Coupon not found', 404));
    }

    if (coupon.usedCount > 0) {
      return next(
        new AppError(
          `Cannot delete coupon "${coupon.code}" — it has been used ${coupon.usedCount} time(s) and is referenced by past orders. Deactivate it instead to preserve order history integrity.`,
          400
        )
      );
    }

    await coupon.deleteOne();

    return ApiResponse.success(res, 200, 'Coupon deleted successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Get coupon usage statistics (which orders used it, total discount given)
// @route   GET /api/coupons/:id/stats
// @access  Private/Admin
exports.getCouponStats = async (req, res, next) => {
  try {
    const Order = require('../models/Order');

    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return next(new AppError('Coupon not found', 404));
    }

    const ordersUsingCoupon = await Order.find({ couponCode: coupon.code })
      .populate('user', 'name email')
      .select('orderNumber user totalPrice discountAmount status createdAt')
      .sort({ createdAt: -1 });

    const totalDiscountGiven = Math.round(
      ordersUsingCoupon.reduce((sum, order) => sum + (order.discountAmount || 0), 0) * 100
    ) / 100;

    return ApiResponse.success(res, 200, 'Coupon statistics fetched successfully', {
      coupon,
      usageCount: ordersUsingCoupon.length,
      totalDiscountGiven,
      orders: ordersUsingCoupon
    });
  } catch (error) {
    next(error);
  }
};