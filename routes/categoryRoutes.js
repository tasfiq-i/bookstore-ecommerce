const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../controllers/categoryController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadCategoryImage } = require('../middleware/upload');

const categoryValidation = [
  body('name').trim().notEmpty().withMessage('Category name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Category name must be between 2 and 50 characters'),
  body('description').optional().trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters')
];

router.get('/', optionalAuth, getCategories);
router.get('/:idOrSlug', getCategory);

router.post(
  '/',
  protect,
  authorize('admin'),
  uploadCategoryImage.single('image'),
  categoryValidation,
  validate,
  createCategory
);

router.put(
  '/:id',
  protect,
  authorize('admin'),
  uploadCategoryImage.single('image'),
  updateCategory
);

router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;