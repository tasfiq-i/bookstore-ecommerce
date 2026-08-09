const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const {
  placeOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  reorder,
  downloadInvoice,
  getAllOrders,
  updateOrderStatus,
  updatePaymentStatus,
  placeGuestOrder,
  getGuestOrder
} = require('../controllers/orderController');

const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// ─── Validation Chains ─────────────────────────────────
const placeOrderValidation = [
  body('useSavedAddress').optional().isBoolean().withMessage('useSavedAddress must be a boolean'),
  body('addressId')
    .if(body('useSavedAddress').equals('true'))
    .notEmpty().withMessage('addressId is required when using a saved address')
    .isMongoId().withMessage('Invalid address ID'),
  body('shippingAddress.fullName')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('Full name is required'),
  body('shippingAddress.phone')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Please provide a valid phone number'),
  body('shippingAddress.addressLine1')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('City is required'),
  body('shippingAddress.state')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('State is required'),
  body('shippingAddress.postalCode')
    .if(body('useSavedAddress').not().equals('true'))
    .trim().notEmpty().withMessage('Postal code is required'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
];

const placeGuestOrderValidation = [
  body('items').isArray({ min: 1 }).withMessage('Cart must contain at least one item'),
  body('items.*.bookId').isMongoId().withMessage('Invalid book ID in cart'),
  body('items.*.quantity').isInt({ min: 1, max: 100 }).withMessage('Invalid quantity in cart'),
  body('guestInfo.name').trim().notEmpty().withMessage('Name is required'),
  body('guestInfo.email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('guestInfo.phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Please provide a valid phone number'),
  body('shippingAddress.fullName').trim().notEmpty().withMessage('Full name is required'),
  body('shippingAddress.phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Please provide a valid phone number'),
  body('shippingAddress.addressLine1').trim().notEmpty().withMessage('Address line 1 is required'),
  body('shippingAddress.city').trim().notEmpty().withMessage('City is required'),
  body('shippingAddress.state').trim().notEmpty().withMessage('State is required'),
  body('shippingAddress.postalCode').trim().notEmpty().withMessage('Postal code is required'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
];

const getGuestOrderValidation = [
  param('orderNumber').trim().notEmpty().withMessage('Order number is required'),
  query('email').trim().isEmail().withMessage('A valid email is required')
];

const cancelOrderValidation = [
  param('id').isMongoId().withMessage('Invalid order ID'),
  body('reason').optional().trim().isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
];

const updateStatusValidation = [
  param('id').isMongoId().withMessage('Invalid order ID'),
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'])
    .withMessage('Invalid status value'),
  body('note').optional().trim().isLength({ max: 500 }).withMessage('Note cannot exceed 500 characters')
];

const updatePaymentStatusValidation = [
  param('id').isMongoId().withMessage('Invalid order ID'),
  body('paymentStatus')
    .notEmpty().withMessage('Payment status is required')
    .isIn(['pending', 'paid', 'failed']).withMessage('Invalid payment status')
];

// ─── Guest Routes (Public) — declared BEFORE '/:id' so the literal
//     "/guest" path segment is never swallowed by the ':id' param ──
router.post('/guest', placeGuestOrderValidation, validate, placeGuestOrder);
router.get('/guest/:orderNumber', getGuestOrderValidation, validate, getGuestOrder);

// ─── Customer Routes ─────────────────────────────────────
router.post('/', protect, authorize('customer', 'admin'), placeOrderValidation, validate, placeOrder);
router.get('/my-orders', protect, authorize('customer', 'admin'), getMyOrders);
router.post('/:id/reorder', protect, authorize('customer', 'admin'), param('id').isMongoId(), validate, reorder);
router.put('/:id/cancel', protect, authorize('customer', 'admin'), cancelOrderValidation, validate, cancelOrder);
router.get('/:id/invoice', protect, param('id').isMongoId().withMessage('Invalid order ID'), validate, downloadInvoice);

// ─── Shared Route (owner or admin — access check inside controller) ──
router.get('/:id', protect, param('id').isMongoId().withMessage('Invalid order ID'), validate, getOrder);

// ─── Admin-Only Routes ────────────────────────────────────
router.get('/', protect, authorize('admin'), getAllOrders);
router.put('/:id/status', protect, authorize('admin'), updateStatusValidation, validate, updateOrderStatus);
router.put(
  '/:id/payment-status',
  protect,
  authorize('admin'),
  updatePaymentStatusValidation,
  validate,
  updatePaymentStatus
);

module.exports = router;