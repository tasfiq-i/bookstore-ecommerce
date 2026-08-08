const mongoose = require('mongoose');
const User = require('../models/User');
const Book = require('../models/Book');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Author = require('../models/Author');
const Publisher = require('../models/Publisher');
const Coupon = require('../models/Coupon');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');

// ═══════════════════════════════════════════════════════
// DASHBOARD SUMMARY
// ═══════════════════════════════════════════════════════

// @desc    Get dashboard summary metrics
// @route   GET /api/admin/dashboard/summary
// @access  Private/Admin
exports.getDashboardSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      totalRevenueAgg,
      totalOrders,
      totalBooks,
      totalUsers,
      todayOrders,
      todayRevenueAgg,
      monthRevenueAgg,
      lastMonthRevenueAgg,
      pendingOrders,
      lowStockCount,
      outOfStockCount,
      totalCategories,
      totalAuthors,
      totalPublishers,
      activeCoupons
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.countDocuments({ status: { $ne: 'cancelled' } }),
      Book.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments({ createdAt: { $gte: startOfToday }, status: { $ne: 'cancelled' } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfToday }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
            status: { $ne: 'cancelled' }
          }
        },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.countDocuments({ status: 'pending' }),
      Book.countDocuments({
        isActive: true,
        $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] }
      }),
      Book.countDocuments({ isActive: true, stock: 0 }),
      Category.countDocuments({ isActive: true }),
      Author.countDocuments({ isActive: true }),
      Publisher.countDocuments({ isActive: true }),
      Coupon.countDocuments({ isActive: true, expiryDate: { $gt: now } })
    ]);

    const totalRevenue = totalRevenueAgg[0]?.total || 0;
    const todayRevenue = todayRevenueAgg[0]?.total || 0;
    const monthRevenue = monthRevenueAgg[0]?.total || 0;
    const lastMonthRevenue = lastMonthRevenueAgg[0]?.total || 0;

    const monthGrowthPercent =
      lastMonthRevenue > 0
        ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 1000) / 10
        : monthRevenue > 0
        ? 100
        : 0;

    return ApiResponse.success(res, 200, 'Dashboard summary fetched successfully', {
      revenue: {
        total: Math.round(totalRevenue * 100) / 100,
        today: Math.round(todayRevenue * 100) / 100,
        thisMonth: Math.round(monthRevenue * 100) / 100,
        lastMonth: Math.round(lastMonthRevenue * 100) / 100,
        monthGrowthPercent
      },
      orders: {
        total: totalOrders,
        today: todayOrders,
        pending: pendingOrders
      },
      catalog: {
        totalBooks,
        totalCategories,
        totalAuthors,
        totalPublishers,
        lowStockCount,
        outOfStockCount
      },
      users: {
        totalCustomers: totalUsers
      },
      coupons: {
        active: activeCoupons
      }
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// SALES / REVENUE ANALYTICS
// ═══════════════════════════════════════════════════════

// @desc    Get sales analytics over a date range (daily breakdown)
// @route   GET /api/admin/analytics/sales
// @access  Private/Admin
// Query: startDate, endDate (ISO strings), defaults to last 30 days
exports.getSalesAnalytics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return next(new AppError('Invalid startDate or endDate', 400));
    }

    if (start > end) {
      return next(new AppError('startDate must be before endDate', 400));
    }

    const salesData = await Order.getSalesAnalytics(start, end);

    // Fill in zero-value days so the frontend chart doesn't have gaps
    const filledData = [];
    const dateMap = new Map(salesData.map((d) => [d._id, d]));
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    while (cursor <= endDay) {
      const dateKey = cursor.toISOString().split('T')[0];
      const existing = dateMap.get(dateKey);
      filledData.push({
        date: dateKey,
        totalSales: existing ? Math.round(existing.totalSales * 100) / 100 : 0,
        orderCount: existing ? existing.orderCount : 0
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const summary = {
      totalSales: Math.round(filledData.reduce((sum, d) => sum + d.totalSales, 0) * 100) / 100,
      totalOrders: filledData.reduce((sum, d) => sum + d.orderCount, 0),
      averageOrderValue: 0
    };
    summary.averageOrderValue =
      summary.totalOrders > 0 ? Math.round((summary.totalSales / summary.totalOrders) * 100) / 100 : 0;

    return ApiResponse.success(res, 200, 'Sales analytics fetched successfully', {
      dateRange: { start, end },
      dailyBreakdown: filledData,
      summary
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get best-selling books
// @route   GET /api/admin/analytics/top-books
// @access  Private/Admin
exports.getTopSellingBooks = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

    const topBooks = await Book.find({ isActive: true })
      .select('title slug images price discountPrice soldCount stock ratings')
      .sort({ soldCount: -1 })
      .limit(limitNum);

    return ApiResponse.success(res, 200, 'Top-selling books fetched successfully', { topBooks });
  } catch (error) {
    next(error);
  }
};

// @desc    Get revenue breakdown by category
// @route   GET /api/admin/analytics/revenue-by-category
// @access  Private/Admin
exports.getRevenueByCategory = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const matchStage = { status: { $ne: 'cancelled' } };
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const revenueByCategory = await Order.aggregate([
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'books',
          localField: 'items.book',
          foreignField: '_id',
          as: 'bookInfo'
        }
      },
      { $unwind: { path: '$bookInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$bookInfo.category',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          unitsSold: { $sum: '$items.quantity' }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: { path: '$categoryInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          categoryId: '$_id',
          categoryName: { $ifNull: ['$categoryInfo.name', 'Uncategorized/Deleted'] },
          revenue: { $round: ['$revenue', 2] },
          unitsSold: 1
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    return ApiResponse.success(res, 200, 'Revenue by category fetched successfully', { revenueByCategory });
  } catch (error) {
    next(error);
  }
};

// @desc    Get order status distribution
// @route   GET /api/admin/analytics/order-status-distribution
// @access  Private/Admin
exports.getOrderStatusDistribution = async (req, res, next) => {
  try {
    const distribution = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
      { $sort: { count: -1 } }
    ]);

    return ApiResponse.success(res, 200, 'Order status distribution fetched successfully', { distribution });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// STOCK / INVENTORY REPORTS
// ═══════════════════════════════════════════════════════

// @desc    Get low-stock books report
// @route   GET /api/admin/inventory/low-stock
// @access  Private/Admin
exports.getLowStockReport = async (req, res, next) => {
  try {
    const lowStockBooks = await Book.findLowStock()
      .populate('category', 'name')
      .populate('author', 'name')
      .sort({ stock: 1 });

    return ApiResponse.success(res, 200, 'Low-stock report fetched successfully', {
      count: lowStockBooks.length,
      books: lowStockBooks
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get out-of-stock books report
// @route   GET /api/admin/inventory/out-of-stock
// @access  Private/Admin
exports.getOutOfStockReport = async (req, res, next) => {
  try {
    const outOfStockBooks = await Book.find({ isActive: true, stock: 0 })
      .populate('category', 'name')
      .populate('author', 'name')
      .sort({ updatedAt: -1 });

    return ApiResponse.success(res, 200, 'Out-of-stock report fetched successfully', {
      count: outOfStockBooks.length,
      books: outOfStockBooks
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get full inventory valuation & stock summary
// @route   GET /api/admin/inventory/summary
// @access  Private/Admin
exports.getInventorySummary = async (req, res, next) => {
  try {
    const summary = await Book.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalUnitsInStock: { $sum: '$stock' },
          totalInventoryValue: { $sum: { $multiply: ['$stock', '$price'] } },
          totalTitles: { $sum: 1 },
          averagePrice: { $avg: '$price' }
        }
      }
    ]);

    const result = summary[0] || {
      totalUnitsInStock: 0,
      totalInventoryValue: 0,
      totalTitles: 0,
      averagePrice: 0
    };

    return ApiResponse.success(res, 200, 'Inventory summary fetched successfully', {
      totalUnitsInStock: result.totalUnitsInStock,
      totalInventoryValue: Math.round(result.totalInventoryValue * 100) / 100,
      totalTitles: result.totalTitles,
      averagePrice: Math.round(result.averagePrice * 100) / 100
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════

// @desc    Get all users (with search, role filter, pagination)
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res, next) => {
  try {
    const { search, role, isActive, page = 1, limit = 20 } = req.query;

    const filter = {};

    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [users, totalCount] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(filter)
    ]);

    return ApiResponse.success(res, 200, 'Users fetched successfully', { users }, {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalResults: totalCount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single user detail with order stats
// @route   GET /api/admin/users/:id
// @access  Private/Admin
exports.getUserDetail = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const [orderStats, recentOrders] = await Promise.all([
      Order.aggregate([
        { $match: { user: user._id, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: '$totalPrice' }
          }
        }
      ]),
      Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(5).select('orderNumber totalPrice status createdAt')
    ]);

    const stats = orderStats[0] || { totalOrders: 0, totalSpent: 0 };

    return ApiResponse.success(res, 200, 'User detail fetched successfully', {
      user,
      stats: {
        totalOrders: stats.totalOrders,
        totalSpent: Math.round(stats.totalSpent * 100) / 100
      },
      recentOrders
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Activate or deactivate a user account
// @route   PUT /api/admin/users/:id/status
// @access  Private/Admin
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body;

    if (isActive === undefined) {
      return next(new AppError('isActive field is required', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (user._id.toString() === req.user._id.toString()) {
      return next(new AppError('You cannot deactivate your own account', 400));
    }

    if (user.role === 'admin' && isActive === false) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return next(new AppError('Cannot deactivate the last remaining active admin account', 400));
      }
    }

    user.isActive = isActive === true || isActive === 'true';
    await user.save({ validateBeforeSave: false });

    return ApiResponse.success(
      res,
      200,
      `User account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      { user }
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Promote a user to admin, or demote an admin to customer
// @route   PUT /api/admin/users/:id/role
// @access  Private/Admin
exports.updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;

    if (!['customer', 'admin'].includes(role)) {
      return next(new AppError('Role must be either "customer" or "admin"', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (user._id.toString() === req.user._id.toString()) {
      return next(new AppError('You cannot change your own role', 400));
    }

    if (user.role === 'admin' && role === 'customer') {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return next(new AppError('Cannot demote the last remaining admin account', 400));
      }
    }

    const previousRole = user.role;
    user.role = role;
    await user.save({ validateBeforeSave: false });

    return ApiResponse.success(
      res,
      200,
      `User role changed from "${previousRole}" to "${role}" successfully`,
      { user }
    );
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a user account permanently (admin)
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    if (user._id.toString() === req.user._id.toString()) {
      return next(new AppError('You cannot delete your own account', 400));
    }

    if (user.role === 'admin') {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdminCount <= 1) {
        return next(new AppError('Cannot delete the last remaining admin account', 400));
      }
    }

    const orderCount = await Order.countDocuments({ user: user._id });
    if (orderCount > 0) {
      return next(
        new AppError(
          `This user has ${orderCount} order(s) on record. Deactivate the account instead of deleting it to preserve order history.`,
          400
        )
      );
    }

    await user.deleteOne();

    return ApiResponse.success(res, 200, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Get recent activity feed (latest orders + latest registrations) for dashboard
// @route   GET /api/admin/dashboard/recent-activity
// @access  Private/Admin
exports.getRecentActivity = async (req, res, next) => {
  try {
    const [recentOrders, recentUsers] = await Promise.all([
      Order.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(8)
        .select('orderNumber totalPrice status user createdAt'),
      User.find({ role: 'customer' }).sort({ createdAt: -1 }).limit(8).select('name email createdAt')
    ]);

    return ApiResponse.success(res, 200, 'Recent activity fetched successfully', {
      recentOrders,
      recentUsers
    });
  } catch (error) {
    next(error);
  }
};