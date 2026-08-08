const Author = require('../models/Author');
const Book = require('../models/Book');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const cloudinary = require('../config/cloudinary');

// @desc    Get all authors
// @route   GET /api/authors
// @access  Public
exports.getAuthors = async (req, res, next) => {
  try {
    const { search, includeInactive } = req.query;

    const filter = includeInactive === 'true' && req.user?.role === 'admin' ? {} : { isActive: true };

    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const authors = await Author.find(filter).populate('bookCount').sort({ name: 1 });

    return ApiResponse.success(res, 200, 'Authors fetched successfully', { authors });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single author
// @route   GET /api/authors/:idOrSlug
// @access  Public
exports.getAuthor = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);

    const author = await Author.findOne(
      isObjectId ? { _id: idOrSlug } : { slug: idOrSlug }
    ).populate('bookCount');

    if (!author) {
      return next(new AppError('Author not found', 404));
    }

    return ApiResponse.success(res, 200, 'Author fetched successfully', { author });
  } catch (error) {
    next(error);
  }
};

// @desc    Create author
// @route   POST /api/authors
// @access  Private/Admin
exports.createAuthor = async (req, res, next) => {
  try {
    const { name, bio, nationality, birthDate } = req.body;

    const authorData = { name, bio, nationality };
    if (birthDate) authorData.birthDate = birthDate;

    if (req.file) {
      authorData.photo = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    const author = await Author.create(authorData);

    return ApiResponse.success(res, 201, 'Author created successfully', { author });
  } catch (error) {
    next(error);
  }
};

// @desc    Update author
// @route   PUT /api/authors/:id
// @access  Private/Admin
exports.updateAuthor = async (req, res, next) => {
  try {
    const author = await Author.findById(req.params.id);
    if (!author) {
      return next(new AppError('Author not found', 404));
    }

    const { name, bio, nationality, birthDate, isActive } = req.body;

    if (name) author.name = name;
    if (bio !== undefined) author.bio = bio;
    if (nationality !== undefined) author.nationality = nationality;
    if (birthDate) author.birthDate = birthDate;
    if (isActive !== undefined) author.isActive = isActive;

    if (req.file) {
      if (author.photo?.publicId) {
        await cloudinary.uploader.destroy(author.photo.publicId).catch((err) =>
          console.error('Failed to delete old author photo:', err.message)
        );
      }
      author.photo = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    await author.save();

    return ApiResponse.success(res, 200, 'Author updated successfully', { author });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete author
// @route   DELETE /api/authors/:id
// @access  Private/Admin
exports.deleteAuthor = async (req, res, next) => {
  try {
    const author = await Author.findById(req.params.id);
    if (!author) {
      return next(new AppError('Author not found', 404));
    }

    const bookCount = await Book.countDocuments({ author: author._id });
    if (bookCount > 0) {
      return next(
        new AppError(
          `Cannot delete author "${author.name}" — assigned to ${bookCount} book(s). Reassign or delete those books first.`,
          400
        )
      );
    }

    if (author.photo?.publicId) {
      await cloudinary.uploader.destroy(author.photo.publicId).catch((err) =>
        console.error('Failed to delete author photo:', err.message)
      );
    }

    await author.deleteOne();

    return ApiResponse.success(res, 200, 'Author deleted successfully');
  } catch (error) {
    next(error);
  }
};