const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const {
  getBooks,
  getBook,
  createBook,
  updateBook,
  deleteBook,
  adjustStock,
  getStockStatus,
  addReview,
  updateReview,
  deleteReview,
  getFilterMeta
} = require('../controllers/bookController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadBookImages } = require('../middleware/upload');

// ─── Validation Chains ─────────────────────────────────
const createBookValidation = [
  body('title').trim().notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('isbn').trim().notEmpty().withMessage('ISBN is required')
    .matches(/^(?:\d{10}|\d{13})$/).withMessage('ISBN must be 10 or 13 digits'),
  body('description').trim().notEmpty().withMessage('Description is required')
    .isLength({ min: 10, max: 3000 }).withMessage('Description must be between 10 and 3000 characters'),
  body('category').notEmpty().withMessage('Category is required')
    .isMongoId().withMessage('Invalid category ID'),
  body('author').notEmpty().withMessage('Author is required')
    .isMongoId().withMessage('Invalid author ID'),
  body('publisher').notEmpty().withMessage('Publisher is required')
    .isMongoId().withMessage('Invalid publisher ID'),
  body('price').notEmpty().withMessage('Price is required')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('discountPrice').optional()
    .isFloat({ min: 0 }).withMessage('Discount price must be a positive number'),
  body('stock').notEmpty().withMessage('Stock is required')
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  body('format').optional()
    .isIn(['Paperback', 'Hardcover', 'E-Book', 'Audiobook']).withMessage('Invalid format'),
  body('pages').optional().isInt({ min: 1 }).withMessage('Pages must be at least 1')
];

const updateBookValidation = [
  body('title').optional().trim().isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('isbn').optional().trim().matches(/^(?:\d{10}|\d{13})$/).withMessage('ISBN must be 10 or 13 digits'),
  body('description').optional().trim()
    .isLength({ min: 10, max: 3000 }).withMessage('Description must be between 10 and 3000 characters'),
  body('category').optional().isMongoId().withMessage('Invalid category ID'),
  body('author').optional().isMongoId().withMessage('Invalid author ID'),
  body('publisher').optional().isMongoId().withMessage('Invalid publisher ID'),
  body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  body('format').optional()
    .isIn(['Paperback', 'Hardcover', 'E-Book', 'Audiobook']).withMessage('Invalid format')
];

const stockAdjustValidation = [
  body('stock').notEmpty().withMessage('Stock value is required')
    .isInt().withMessage('Stock must be an integer'),
  body('operation').optional().isIn(['set', 'increment', 'decrement']).withMessage('Invalid operation')
];

const reviewValidation = [
  body('rating').notEmpty().withMessage('Rating is required')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters')
];

const updateReviewValidation = [
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters')
];

// ─── Public Routes ─────────────────────────────────────
router.get('/', optionalAuth, getBooks);
router.get('/filters/meta', getFilterMeta);
router.get('/:id/stock-status', getStockStatus);
router.get('/:idOrSlug', getBook);

// ─── Admin Routes (CRUD) ────────────────────────────────
router.post(
  '/',
  protect,
  authorize('admin'),
  uploadBookImages.array('images', 5),
  createBookValidation,
  validate,
  createBook
);

router.put(
  '/:id',
  protect,
  authorize('admin'),
  uploadBookImages.array('images', 5),
  updateBookValidation,
  validate,
  updateBook
);

router.delete('/:id', protect, authorize('admin'), deleteBook);

router.patch(
  '/:id/stock',
  protect,
  authorize('admin'),
  stockAdjustValidation,
  validate,
  adjustStock
);

// ─── Review Routes (Customer) ───────────────────────────
router.post(
  '/:id/reviews',
  protect,
  authorize('customer', 'admin'),
  reviewValidation,
  validate,
  addReview
);

router.put(
  '/:id/reviews/:reviewId',
  protect,
  authorize('customer', 'admin'),
  updateReviewValidation,
  validate,
  updateReview
);

router.delete('/:id/reviews/:reviewId', protect, authorize('customer', 'admin'), deleteReview);

module.exports = router;