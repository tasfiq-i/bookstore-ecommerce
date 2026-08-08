const express = require('express');
const router = express.Router();
const { body } = require('express-validator');

const {
  getPublishers,
  getPublisher,
  createPublisher,
  updatePublisher,
  deletePublisher
} = require('../controllers/publisherController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadPublisherLogo } = require('../middleware/upload');

const publisherValidation = [
  body('name').trim().notEmpty().withMessage('Publisher name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Publisher name must be between 2 and 100 characters'),
  body('description').optional().trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('website').optional().trim()
    .isURL().withMessage('Please provide a valid URL').bail(),
  body('establishedYear').optional()
    .isInt({ min: 1400, max: new Date().getFullYear() })
    .withMessage(`Established year must be between 1400 and ${new Date().getFullYear()}`)
];

router.get('/', optionalAuth, getPublishers);
router.get('/:idOrSlug', getPublisher);

router.post(
  '/',
  protect,
  authorize('admin'),
  uploadPublisherLogo.single('logo'),
  publisherValidation,
  validate,
  createPublisher
);

router.put(
  '/:id',
  protect,
  authorize('admin'),
  uploadPublisherLogo.single('logo'),
  updatePublisher
);

router.delete('/:id', protect, authorize('admin'), deletePublisher);

module.exports = router;