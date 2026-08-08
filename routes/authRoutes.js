const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
  forgotPassword,
  resetPassword
} = require('../controllers/authController');

const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { uploadAvatar } = require('../middleware/upload');

// ─── Validation Chains ─────────────────────────────────
const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').optional().trim()
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Please provide a valid phone number')
];

const loginValidation = [
  body('email').trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').notEmpty().withMessage('New password is required')
    .isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
];

const addressValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('Please provide a valid phone number'),
  body('addressLine1').trim().notEmpty().withMessage('Address line 1 is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('postalCode').trim().notEmpty().withMessage('Postal code is required')
];

const forgotPasswordValidation = [
  body('email').trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address').normalizeEmail()
];

const resetPasswordValidation = [
  param('token').notEmpty().withMessage('Reset token is required'),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

// ─── Public Routes ─────────────────────────────────────
router.post('/register', registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.post('/forgot-password', forgotPasswordValidation, validate, forgotPassword);
router.put('/reset-password/:token', resetPasswordValidation, validate, resetPassword);

// ─── Private Routes ─────────────────────────────────────
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, uploadAvatar.single('avatar'), updateProfile);
router.put('/change-password', protect, changePasswordValidation, validate, changePassword);

router.post('/address', protect, addressValidation, validate, addAddress);
router.put('/address/:addressId', protect, addressValidation, validate, updateAddress);
router.delete('/address/:addressId', protect, deleteAddress);

module.exports = router;