const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [4, 'Coupon code must be at least 4 characters'],
      maxlength: [20, 'Coupon code cannot exceed 20 characters']
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: [true, 'Discount type is required']
    },
    discountValue: {
      type: Number,
      required: [true, 'Discount value is required'],
      min: [0, 'Discount value cannot be negative'],
      validate: {
        validator: function (value) {
          if (this.discountType === 'percentage') {
            return value > 0 && value <= 100;
          }
          return value > 0;
        },
        message: 'Invalid discount value for the selected discount type'
      }
    },
    minPurchaseAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxDiscountAmount: {
      type: Number,
      default: null
    },
    usageLimit: {
      type: Number,
      default: null,
      min: [1, 'Usage limit must be at least 1']
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    expiryDate: {
      type: Date,
      required: [true, 'Expiry date is required'],
      validate: {
        validator: function (value) {
          return value > Date.now();
        },
        message: 'Expiry date must be in the future'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

//couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ expiryDate: 1 });

// Instance method: validate coupon eligibility
couponSchema.methods.isValid = function (cartTotal) {
  if (!this.isActive) return { valid: false, message: 'Coupon is inactive' };
  if (this.expiryDate < Date.now()) return { valid: false, message: 'Coupon has expired' };
  if (this.usageLimit != null && this.usedCount >= this.usageLimit) {
    return { valid: false, message: 'Coupon usage limit reached' };
  }
  if (cartTotal < this.minPurchaseAmount) {
    return {
      valid: false,
      message: `Minimum purchase of ${this.minPurchaseAmount} required for this coupon`
    };
  }
  return { valid: true, message: 'Coupon is valid' };
};

// Instance method: calculate discount amount
couponSchema.methods.calculateDiscount = function (cartTotal) {
  let discount = 0;
  if (this.discountType === 'percentage') {
    discount = (cartTotal * this.discountValue) / 100;
    if (this.maxDiscountAmount != null) {
      discount = Math.min(discount, this.maxDiscountAmount);
    }
  } else {
    discount = this.discountValue;
  }
  return Math.min(discount, cartTotal);
};

module.exports = mongoose.model('Coupon', couponSchema);