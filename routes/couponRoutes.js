const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  validateCoupon,
  getActivePublicCoupons,
  getAllCoupons,
  getCoupon,
  generateCode,
  createCoupon,
  updateCoupon,
  toggleCouponStatus,
  deleteCoupon,
  getCouponStats
} = require('../controllers/couponController');

const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// ─── Validation Chains ─────────────────────────────────
const validateCouponValidation = [
  body('code').trim().notEmpty().withMessage('Coupon code is required')
];

const generateCodeValidation = [
  body('prefix').optional().trim().isLength({ max: 12 }).withMessage('Prefix cannot exceed 12 characters'),
  body('length').optional().isInt({ min: 4, max: 12 }).withMessage('Length must be between 4 and 12')
];

const createCouponValidation = [
  body('autoGenerate').optional().isBoolean().withMessage('autoGenerate must be a boolean'),
  body('code')
    .if(body('autoGenerate').not().equals('true'))
    .trim().notEmpty().withMessage('Coupon code is required when not auto-generating')
    .isLength({ min: 4, max: 20 }).withMessage('Coupon code must be between 4 and 20 characters'),
  body('description').optional().trim().isLength({ max: 300 }).withMessage('Description cannot exceed 300 characters'),
  body('discountType').notEmpty().withMessage('Discount type is required')
    .isIn(['percentage', 'fixed']).withMessage('Discount type must be "percentage" or "fixed"'),
  body('discountValue').notEmpty().withMessage('Discount value is required')
    .isFloat({ gt: 0 }).withMessage('Discount value must be greater than 0'),
  body('minPurchaseAmount').optional().isFloat({ min: 0 }).withMessage('Minimum purchase amount cannot be negative'),
  body('maxDiscountAmount').optional().isFloat({ min: 0 }).withMessage('Maximum discount amount cannot be negative'),
  body('usageLimit').optional().isInt({ min: 1 }).withMessage('Usage limit must be at least 1'),
  body('expiryDate').notEmpty().withMessage('Expiry date is required')
    .isISO8601().withMessage('Expiry date must be a valid date')
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error('Expiry date must be in the future');
      }
      return true;
    })
];

const updateCouponValidation = [
  body('code').optional().trim().isLength({ min: 4, max: 20 }).withMessage('Coupon code must be between 4 and 20 characters'),
  body('description').optional().trim().isLength({ max: 300 }).withMessage('Description cannot exceed 300 characters'),
  body('discountType').optional().isIn(['percentage', 'fixed']).withMessage('Discount type must be "percentage" or "fixed"'),
  body('discountValue').optional().isFloat({ gt: 0 }).withMessage('Discount value must be greater than 0'),
  body('minPurchaseAmount').optional().isFloat({ min: 0 }).withMessage('Minimum purchase amount cannot be negative'),
  body('maxDiscountAmount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Maximum discount amount cannot be negative'),
  body('usageLimit').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Usage limit must be at least 1'),
  body('expiryDate').optional().isISO8601().withMessage('Expiry date must be a valid date'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
];

const idValidation = [param('id').isMongoId().withMessage('Invalid coupon ID')];

// ─── Public Routes ─────────────────────────────────────
router.get('/active', getActivePublicCoupons);

// ─── Customer Routes (pre-flight check) ─────────────────
router.post('/validate', protect, authorize('customer', 'admin'), validateCouponValidation, validate, validateCoupon);

// ─── Admin Routes ────────────────────────────────────────
router.get('/', protect, authorize('admin'), getAllCoupons);
router.post('/generate-code', protect, authorize('admin'), generateCodeValidation, validate, generateCode);
router.post('/', protect, authorize('admin'), createCouponValidation, validate, createCoupon);

router.get('/:id', protect, authorize('admin'), idValidation, validate, getCoupon);
router.get('/:id/stats', protect, authorize('admin'), idValidation, validate, getCouponStats);
router.put('/:id', protect, authorize('admin'), idValidation, updateCouponValidation, validate, updateCoupon);
router.patch('/:id/toggle', protect, authorize('admin'), idValidation, validate, toggleCouponStatus);
router.delete('/:id', protect, authorize('admin'), idValidation, validate, deleteCoupon);

module.exports = router;