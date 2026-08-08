const Category = require('../models/Category');
const Book = require('../models/Book');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const cloudinary = require('../config/cloudinary');

// @desc    Get all categories (public)
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res, next) => {
  try {
    const { includeInactive } = req.query;

    const filter = includeInactive === 'true' && req.user?.role === 'admin' ? {} : { isActive: true };

    const categories = await Category.find(filter)
      .populate('bookCount')
      .sort({ name: 1 });

    return ApiResponse.success(res, 200, 'Categories fetched successfully', { categories });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single category by slug or id
// @route   GET /api/categories/:idOrSlug
// @access  Public
exports.getCategory = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);

    const category = await Category.findOne(
      isObjectId ? { _id: idOrSlug } : { slug: idOrSlug }
    ).populate('bookCount');

    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    return ApiResponse.success(res, 200, 'Category fetched successfully', { category });
  } catch (error) {
    next(error);
  }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const existing = await Category.findOne({ name: name.trim() });
    if (existing) {
      return next(new AppError('A category with this name already exists', 400));
    }

    const categoryData = { name, description };

    if (req.file) {
      categoryData.image = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    const category = await Category.create(categoryData);

    return ApiResponse.success(res, 201, 'Category created successfully', { category });
  } catch (error) {
    next(error);
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    const { name, description, isActive } = req.body;

    if (name && name.trim() !== category.name) {
      const existing = await Category.findOne({ name: name.trim(), _id: { $ne: category._id } });
      if (existing) {
        return next(new AppError('A category with this name already exists', 400));
      }
      category.name = name;
    }

    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive;

    if (req.file) {
      // Delete old image from Cloudinary before setting new one
      if (category.image?.publicId) {
        await cloudinary.uploader.destroy(category.image.publicId).catch((err) =>
          console.error('Failed to delete old category image:', err.message)
        );
      }
      category.image = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    await category.save();

    return ApiResponse.success(res, 200, 'Category updated successfully', { category });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return next(new AppError('Category not found', 404));
    }

    const bookCount = await Book.countDocuments({ category: category._id });
    if (bookCount > 0) {
      return next(
        new AppError(
          `Cannot delete category "${category.name}" — it is assigned to ${bookCount} book(s). Reassign or delete those books first.`,
          400
        )
      );
    }

    if (category.image?.publicId) {
      await cloudinary.uploader.destroy(category.image.publicId).catch((err) =>
        console.error('Failed to delete category image:', err.message)
      );
    }

    await category.deleteOne();

    return ApiResponse.success(res, 200, 'Category deleted successfully');
  } catch (error) {
    next(error);
  }
};