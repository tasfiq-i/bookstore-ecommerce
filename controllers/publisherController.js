const Publisher = require('../models/Publisher');
const Book = require('../models/Book');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const cloudinary = require('../config/cloudinary');

// @desc    Get all publishers
// @route   GET /api/publishers
// @access  Public
exports.getPublishers = async (req, res, next) => {
  try {
    const { search, includeInactive } = req.query;

    const filter = includeInactive === 'true' && req.user?.role === 'admin' ? {} : { isActive: true };

    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const publishers = await Publisher.find(filter).populate('bookCount').sort({ name: 1 });

    return ApiResponse.success(res, 200, 'Publishers fetched successfully', { publishers });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single publisher
// @route   GET /api/publishers/:idOrSlug
// @access  Public
exports.getPublisher = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);

    const publisher = await Publisher.findOne(
      isObjectId ? { _id: idOrSlug } : { slug: idOrSlug }
    ).populate('bookCount');

    if (!publisher) {
      return next(new AppError('Publisher not found', 404));
    }

    return ApiResponse.success(res, 200, 'Publisher fetched successfully', { publisher });
  } catch (error) {
    next(error);
  }
};

// @desc    Create publisher
// @route   POST /api/publishers
// @access  Private/Admin
exports.createPublisher = async (req, res, next) => {
  try {
    const { name, description, website, establishedYear } = req.body;

    const existing = await Publisher.findOne({ name: name.trim() });
    if (existing) {
      return next(new AppError('A publisher with this name already exists', 400));
    }

    const publisherData = { name, description, website };
    if (establishedYear) publisherData.establishedYear = establishedYear;

    if (req.file) {
      publisherData.logo = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    const publisher = await Publisher.create(publisherData);

    return ApiResponse.success(res, 201, 'Publisher created successfully', { publisher });
  } catch (error) {
    next(error);
  }
};

// @desc    Update publisher
// @route   PUT /api/publishers/:id
// @access  Private/Admin
exports.updatePublisher = async (req, res, next) => {
  try {
    const publisher = await Publisher.findById(req.params.id);
    if (!publisher) {
      return next(new AppError('Publisher not found', 404));
    }

    const { name, description, website, establishedYear, isActive } = req.body;

    if (name && name.trim() !== publisher.name) {
      const existing = await Publisher.findOne({ name: name.trim(), _id: { $ne: publisher._id } });
      if (existing) {
        return next(new AppError('A publisher with this name already exists', 400));
      }
      publisher.name = name;
    }

    if (description !== undefined) publisher.description = description;
    if (website !== undefined) publisher.website = website;
    if (establishedYear) publisher.establishedYear = establishedYear;
    if (isActive !== undefined) publisher.isActive = isActive;

    if (req.file) {
      if (publisher.logo?.publicId) {
        await cloudinary.uploader.destroy(publisher.logo.publicId).catch((err) =>
          console.error('Failed to delete old publisher logo:', err.message)
        );
      }
      publisher.logo = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    await publisher.save();

    return ApiResponse.success(res, 200, 'Publisher updated successfully', { publisher });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete publisher
// @route   DELETE /api/publishers/:id
// @access  Private/Admin
exports.deletePublisher = async (req, res, next) => {
  try {
    const publisher = await Publisher.findById(req.params.id);
    if (!publisher) {
      return next(new AppError('Publisher not found', 404));
    }

    const bookCount = await Book.countDocuments({ publisher: publisher._id });
    if (bookCount > 0) {
      return next(
        new AppError(
          `Cannot delete publisher "${publisher.name}" — assigned to ${bookCount} book(s). Reassign or delete those books first.`,
          400
        )
      );
    }

    if (publisher.logo?.publicId) {
      await cloudinary.uploader.destroy(publisher.logo.publicId).catch((err) =>
        console.error('Failed to delete publisher logo:', err.message)
      );
    }

    await publisher.deleteOne();

    return ApiResponse.success(res, 200, 'Publisher deleted successfully');
  } catch (error) {
    next(error);
  }
};