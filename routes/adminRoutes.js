const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const {
  getDashboardSummary,
  getRecentActivity,
  getSalesAnalytics,
  getTopSellingBooks,
  getRevenueByCategory,
  getOrderStatusDistribution,
  getLowStockReport,
  getOutOfStockReport,
  getInventorySummary,
  getAllUsers,
  getUserDetail,
  toggleUserStatus,
  updateUserRole,
  deleteUser
} = require('../controllers/adminController');

const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// ─── All admin routes require authentication + admin role ──
router.use(protect, authorize('admin'));

// ─── Validation Chains ─────────────────────────────────
const dateRangeValidation = [
  query('startDate').optional().isISO8601().withMessage('startDate must be a valid date'),
  query('endDate').optional().isISO8601().withMessage('endDate must be a valid date')
];

const toggleStatusValidation = [
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('isActive').notEmpty().withMessage('isActive is required').isBoolean().withMessage('isActive must be a boolean')
];

const updateRoleValidation = [
  param('id').isMongoId().withMessage('Invalid user ID'),
  body('role').notEmpty().withMessage('Role is required').isIn(['customer', 'admin']).withMessage('Role must be customer or admin')
];

// ─── Dashboard ──────────────────────────────────────────
router.get('/dashboard/summary', getDashboardSummary);
router.get('/dashboard/recent-activity', getRecentActivity);

// ─── Sales & Revenue Analytics ─────────────────────────
router.get('/analytics/sales', dateRangeValidation, validate, getSalesAnalytics);
router.get('/analytics/top-books', getTopSellingBooks);
router.get('/analytics/revenue-by-category', dateRangeValidation, validate, getRevenueByCategory);
router.get('/analytics/order-status-distribution', getOrderStatusDistribution);

// ─── Inventory Reports ──────────────────────────────────
router.get('/inventory/low-stock', getLowStockReport);
router.get('/inventory/out-of-stock', getOutOfStockReport);
router.get('/inventory/summary', getInventorySummary);

// ─── User Management ────────────────────────────────────
router.get('/users', getAllUsers);
router.get('/users/:id', param('id').isMongoId().withMessage('Invalid user ID'), validate, getUserDetail);
router.put('/users/:id/status', toggleStatusValidation, validate, toggleUserStatus);
router.put('/users/:id/role', updateRoleValidation, validate, updateUserRole);
router.delete('/users/:id', param('id').isMongoId().withMessage('Invalid user ID'), validate, deleteUser);

module.exports = router;