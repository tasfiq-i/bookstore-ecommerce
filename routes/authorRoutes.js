const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const {
  getAuthors,
  getAuthor,
  createAuthor,
  updateAuthor,
  deleteAuthor
} = require('../controllers/authorController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadAuthorPhoto } = require('../middleware/upload');

const authorValidation = [
  body('name').trim().notEmpty().withMessage('Author name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Author name must be between 2 and 100 characters'),
  body('bio').optional().trim()
    .isLength({ max: 1000 }).withMessage('Bio cannot exceed 1000 characters'),
  body('nationality').optional().trim(),
  body('birthDate').optional().isISO8601().withMessage('Please provide a valid date')
];

router.get('/', optionalAuth, getAuthors);
router.get('/:idOrSlug', getAuthor);

router.post(
  '/',
  protect,
  authorize('admin'),
  uploadAuthorPhoto.single('photo'),
  authorValidation,
  validate,
  createAuthor
);

router.put(
  '/:id',
  protect,
  authorize('admin'),
  uploadAuthorPhoto.single('photo'),
  updateAuthor
);

router.delete('/:id', protect, authorize('admin'), deleteAuthor);

module.exports = router;