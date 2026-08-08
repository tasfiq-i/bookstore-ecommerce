const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  getCart,
  addItem,
  updateItemQuantity,
  removeItem,
  clearCart,
  validateCart,
  applyCoupon,
  removeCoupon,
  getCartCount
} = require('../controllers/cartController');

const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// ─── Validation Chains ─────────────────────────────────
const addItemValidation = [
  body('bookId').notEmpty().withMessage('Book ID is required')
    .isMongoId().withMessage('Invalid book ID'),
  body('quantity').optional()
    .isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
];

const updateQuantityValidation = [
  param('bookId').isMongoId().withMessage('Invalid book ID'),
  body('quantity').notEmpty().withMessage('Quantity is required')
    .isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1 and 100')
];

const bookIdParamValidation = [
  param('bookId').isMongoId().withMessage('Invalid book ID')
];

const couponValidation = [
  body('code').trim().notEmpty().withMessage('Coupon code is required')
    .isLength({ min: 4, max: 20 }).withMessage('Coupon code must be between 4 and 20 characters')
];

// ─── All cart routes require authentication ─────────────
// Restricting to 'customer' role — admins manage the store, not shop in it,
// but authorize('customer') can be relaxed to authorize('customer','admin')
// if you want admins to also be able to test-purchase.
router.use(protect, authorize('customer', 'admin'));

router.get('/', getCart);
router.get('/validate', validateCart);
router.get('/count', getCartCount);

router.post('/items', addItemValidation, validate, addItem);
router.put('/items/:bookId', updateQuantityValidation, validate, updateItemQuantity);
router.delete('/items/:bookId', bookIdParamValidation, validate, removeItem);

router.delete('/', clearCart);

router.post('/coupon', couponValidation, validate, applyCoupon);
router.delete('/coupon', removeCoupon);

module.exports = router;