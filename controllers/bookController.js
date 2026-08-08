const mongoose = require('mongoose');
const Book = require('../models/Book');
const Category = require('../models/Category');
const Author = require('../models/Author');
const Publisher = require('../models/Publisher');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const cloudinary = require('../config/cloudinary');
const { emitStockUpdate, emitNewOrStockBook } = require('../sockets/socketHandler');

// ─────────────────────────────────────────────────────────
// @desc    Get all books with live search, multi-filter, sort, pagination
// @route   GET /api/books
// @access  Public
// Query params supported:
//   search, category, author, publisher, minPrice, maxPrice,
//   minRating, format, language, inStock, isFeatured,
//   sort (price_asc|price_desc|rating|newest|popular|title_asc),
//   page, limit
// ─────────────────────────────────────────────────────────
exports.getBooks = async (req, res, next) => {
  try {
    const {
      search,
      category,
      author,
      publisher,
      minPrice,
      maxPrice,
      minRating,
      format,
      language,
      inStock,
      isFeatured,
      sort,
      page = 1,
      limit = 12
    } = req.query;

    const filter = { isActive: true };

    // ── Text search (title, description, tags via text index) ──
    if (search && search.trim()) {
      filter.$text = { $search: search.trim() };
    }

    // ── Category filter (accepts comma-separated IDs) ──
    if (category) {
      const categoryIds = category.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (categoryIds.length > 0) filter.category = { $in: categoryIds };
    }

    // ── Author filter ──
    if (author) {
      const authorIds = author.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (authorIds.length > 0) filter.author = { $in: authorIds };
    }

    // ── Publisher filter ──
    if (publisher) {
      const publisherIds = publisher.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (publisherIds.length > 0) filter.publisher = { $in: publisherIds };
    }

    // ── Price range filter ──
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
      if (Object.keys(filter.price).length === 0) delete filter.price;
    }

    // ── Rating filter ──
    if (minRating) {
      filter['ratings.average'] = { $gte: parseFloat(minRating) };
    }

    // ── Format filter (Paperback, Hardcover, E-Book, Audiobook) ──
    if (format) {
      const formats = format.split(',');
      filter.format = { $in: formats };
    }

    // ── Language filter ──
    if (language) {
      filter.language = { $regex: `^${language}$`, $options: 'i' };
    }

    // ── Stock filter ──
    if (inStock === 'true') {
      filter.stock = { $gt: 0 };
    }

    // ── Featured filter ──
    if (isFeatured === 'true') {
      filter.isFeatured = true;
    }

    // ── Sorting ──
    let sortOption = { createdAt: -1 }; // default: newest first
    switch (sort) {
      case 'price_asc':
        sortOption = { price: 1 };
        break;
      case 'price_desc':
        sortOption = { price: -1 };
        break;
      case 'rating':
        sortOption = { 'ratings.average': -1, 'ratings.count': -1 };
        break;
      case 'popular':
        sortOption = { soldCount: -1 };
        break;
      case 'title_asc':
        sortOption = { title: 1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      default:
        if (filter.$text) sortOption = { score: { $meta: 'textScore' } };
    }

    // ── Pagination ──
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    const projection = filter.$text ? { score: { $meta: 'textScore' } } : {};

    const [books, totalCount] = await Promise.all([
      Book.find(filter, projection)
        .populate('category', 'name slug')
        .populate('author', 'name slug')
        .populate('publisher', 'name slug')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Book.countDocuments(filter)
    ]);

    return ApiResponse.success(res, 200, 'Books fetched successfully', { books }, {
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      totalResults: totalCount,
      resultsPerPage: limitNum
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single book by slug or id
// @route   GET /api/books/:idOrSlug
// @access  Public
exports.getBook = async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);

    const book = await Book.findOne(
      isObjectId ? { _id: idOrSlug, isActive: true } : { slug: idOrSlug, isActive: true }
    )
      .populate('category', 'name slug')
      .populate('author', 'name slug bio photo')
      .populate('publisher', 'name slug logo')
      .populate('reviews.user', 'name avatar');

    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    // Fetch related books (same category, excluding this book)
    const relatedBooks = await Book.find({
      category: book.category._id,
      _id: { $ne: book._id },
      isActive: true
    })
      .select('title slug price discountPrice images ratings stock')
      .limit(6)
      .lean();

    return ApiResponse.success(res, 200, 'Book fetched successfully', { book, relatedBooks });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new book
// @route   POST /api/books
// @access  Private/Admin
exports.createBook = async (req, res, next) => {
  try {
    const {
      title,
      isbn,
      description,
      category,
      author,
      publisher,
      price,
      discountPrice,
      stock,
      lowStockThreshold,
      language,
      pages,
      format,
      publishedDate,
      tags,
      isFeatured
    } = req.body;

    // Validate referenced entities exist
    const [categoryExists, authorExists, publisherExists] = await Promise.all([
      Category.findById(category),
      Author.findById(author),
      Publisher.findById(publisher)
    ]);

    if (!categoryExists) return next(new AppError('Selected category does not exist', 400));
    if (!authorExists) return next(new AppError('Selected author does not exist', 400));
    if (!publisherExists) return next(new AppError('Selected publisher does not exist', 400));

    // Check ISBN uniqueness explicitly for a friendly error
    const existingIsbn = await Book.findOne({ isbn: isbn.trim() });
    if (existingIsbn) {
      return next(new AppError(`A book with ISBN "${isbn}" already exists`, 400));
    }

    if (!req.files || req.files.length === 0) {
      return next(new AppError('At least one book image is required', 400));
    }

    const images = req.files.map((file) => ({
      url: file.path,
      publicId: file.filename
    }));

    const bookData = {
      title,
      isbn,
      description,
      category,
      author,
      publisher,
      price: parseFloat(price),
      stock: parseInt(stock, 10),
      images,
      language: language || 'English',
      format: format || 'Paperback',
      isFeatured: isFeatured === 'true' || isFeatured === true
    };

    if (discountPrice) bookData.discountPrice = parseFloat(discountPrice);
    if (lowStockThreshold) bookData.lowStockThreshold = parseInt(lowStockThreshold, 10);
    if (pages) bookData.pages = parseInt(pages, 10);
    if (publishedDate) bookData.publishedDate = publishedDate;
    if (tags) {
      bookData.tags = Array.isArray(tags)
        ? tags
        : tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    }

    const book = await Book.create(bookData);

    const populatedBook = await Book.findById(book._id)
      .populate('category', 'name slug')
      .populate('author', 'name slug')
      .populate('publisher', 'name slug');

    // Notify all connected catalog clients of the new book in real time
    emitNewOrStockBook(populatedBook);

    return ApiResponse.success(res, 201, 'Book created successfully', { book: populatedBook });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a book
// @route   PUT /api/books/:id
// @access  Private/Admin
exports.updateBook = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    const {
      title,
      isbn,
      description,
      category,
      author,
      publisher,
      price,
      discountPrice,
      stock,
      lowStockThreshold,
      language,
      pages,
      format,
      publishedDate,
      tags,
      isFeatured,
      isActive,
      removeImageIds // comma-separated publicIds of images to remove
    } = req.body;

    // Validate referenced entities if being changed
    if (category) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) return next(new AppError('Selected category does not exist', 400));
      book.category = category;
    }
    if (author) {
      const authorExists = await Author.findById(author);
      if (!authorExists) return next(new AppError('Selected author does not exist', 400));
      book.author = author;
    }
    if (publisher) {
      const publisherExists = await Publisher.findById(publisher);
      if (!publisherExists) return next(new AppError('Selected publisher does not exist', 400));
      book.publisher = publisher;
    }

    if (isbn && isbn.trim() !== book.isbn) {
      const existingIsbn = await Book.findOne({ isbn: isbn.trim(), _id: { $ne: book._id } });
      if (existingIsbn) {
        return next(new AppError(`A book with ISBN "${isbn}" already exists`, 400));
      }
      book.isbn = isbn;
    }

    if (title) book.title = title;
    if (description) book.description = description;
    if (price !== undefined) book.price = parseFloat(price);
    if (discountPrice !== undefined) {
      book.discountPrice = discountPrice === '' || discountPrice === null ? undefined : parseFloat(discountPrice);
    }
    if (lowStockThreshold !== undefined) book.lowStockThreshold = parseInt(lowStockThreshold, 10);
    if (language) book.language = language;
    if (pages !== undefined) book.pages = parseInt(pages, 10);
    if (format) book.format = format;
    if (publishedDate) book.publishedDate = publishedDate;
    if (isFeatured !== undefined) book.isFeatured = isFeatured === 'true' || isFeatured === true;
    if (isActive !== undefined) book.isActive = isActive === 'true' || isActive === true;

    if (tags) {
      book.tags = Array.isArray(tags)
        ? tags
        : tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    }

    // ── Track stock change to decide whether to emit stock-update ──
    const previousStock = book.stock;
    let stockChanged = false;
    if (stock !== undefined) {
      const newStock = parseInt(stock, 10);
      if (newStock !== previousStock) stockChanged = true;
      book.stock = newStock;
    }

    // ── Remove specific images ──
    if (removeImageIds) {
      const idsToRemove = removeImageIds.split(',').map((id) => id.trim());
      const imagesToDelete = book.images.filter((img) => idsToRemove.includes(img.publicId));

      await Promise.all(
        imagesToDelete.map((img) =>
          cloudinary.uploader.destroy(img.publicId).catch((err) =>
            console.error('Failed to delete book image:', err.message)
          )
        )
      );

      book.images = book.images.filter((img) => !idsToRemove.includes(img.publicId));
    }

    // ── Add new images ──
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => ({
        url: file.path,
        publicId: file.filename
      }));
      book.images.push(...newImages);
    }

    if (book.images.length === 0) {
      return next(new AppError('A book must have at least one image', 400));
    }

    await book.save();

    const populatedBook = await Book.findById(book._id)
      .populate('category', 'name slug')
      .populate('author', 'name slug')
      .populate('publisher', 'name slug');

    // Real-time: notify catalog clients of updated info (price/stock/etc.)
    emitNewOrStockBook(populatedBook);
    if (stockChanged) {
      emitStockUpdate(populatedBook);
    }

    return ApiResponse.success(res, 200, 'Book updated successfully', { book: populatedBook });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a book
// @route   DELETE /api/books/:id
// @access  Private/Admin
exports.deleteBook = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    // Clean up all Cloudinary images
    await Promise.all(
      book.images.map((img) =>
        cloudinary.uploader.destroy(img.publicId).catch((err) =>
          console.error('Failed to delete book image:', err.message)
        )
      )
    );

    await book.deleteOne();

    return ApiResponse.success(res, 200, 'Book deleted successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Adjust stock directly (quick admin action, e.g., restock)
// @route   PATCH /api/books/:id/stock
// @access  Private/Admin
exports.adjustStock = async (req, res, next) => {
  try {
    const { stock, operation } = req.body; // operation: 'set' | 'increment' | 'decrement'

    if (stock === undefined || isNaN(stock)) {
      return next(new AppError('A valid stock number is required', 400));
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    const stockValue = parseInt(stock, 10);

    switch (operation) {
      case 'increment':
        book.stock += stockValue;
        break;
      case 'decrement':
        if (book.stock < stockValue) {
          return next(new AppError(`Cannot decrement by ${stockValue}. Only ${book.stock} in stock.`, 400));
        }
        book.stock -= stockValue;
        break;
      case 'set':
      default:
        if (stockValue < 0) {
          return next(new AppError('Stock cannot be negative', 400));
        }
        book.stock = stockValue;
        break;
    }

    await book.save();

    emitStockUpdate(book);
    emitNewOrStockBook(book);

    return ApiResponse.success(res, 200, 'Stock updated successfully', {
      bookId: book._id,
      stock: book.stock,
      stockStatus: book.stockStatus
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get real-time stock status for a single book (lightweight polling endpoint)
// @route   GET /api/books/:id/stock-status
// @access  Public
exports.getStockStatus = async (req, res, next) => {
  try {
    const book = await Book.findById(req.params.id).select('stock lowStockThreshold title');
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    return ApiResponse.success(res, 200, 'Stock status fetched', {
      bookId: book._id,
      stock: book.stock,
      stockStatus: book.stockStatus
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add a review to a book (immediate publish, one review per user)
// @route   POST /api/books/:id/reviews
// @access  Private/Customer
exports.addReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return next(new AppError('Rating must be between 1 and 5', 400));
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    const alreadyReviewed = book.reviews.find(
      (review) => review.user.toString() === req.user._id.toString()
    );

    if (alreadyReviewed) {
      return next(new AppError('You have already reviewed this book. You can edit your existing review instead.', 400));
    }

    const review = {
      user: req.user._id,
      name: req.user.name,
      rating: parseInt(rating, 10),
      comment: comment ? comment.trim() : ''
    };

    book.reviews.push(review);
    book.recalculateRatings();
    await book.save();

    return ApiResponse.success(res, 201, 'Review added successfully', {
      review,
      ratings: book.ratings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update own review
// @route   PUT /api/books/:id/reviews/:reviewId
// @access  Private/Customer (owner only)
exports.updateReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    const { id, reviewId } = req.params;

    const book = await Book.findById(id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    const review = book.reviews.id(reviewId);
    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    if (review.user.toString() !== req.user._id.toString()) {
      return next(new AppError('You can only edit your own review', 403));
    }

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return next(new AppError('Rating must be between 1 and 5', 400));
      }
      review.rating = parseInt(rating, 10);
    }
    if (comment !== undefined) review.comment = comment.trim();

    book.recalculateRatings();
    await book.save();

    return ApiResponse.success(res, 200, 'Review updated successfully', {
      review,
      ratings: book.ratings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete own review (or admin can delete any)
// @route   DELETE /api/books/:id/reviews/:reviewId
// @access  Private
exports.deleteReview = async (req, res, next) => {
  try {
    const { id, reviewId } = req.params;

    const book = await Book.findById(id);
    if (!book) {
      return next(new AppError('Book not found', 404));
    }

    const review = book.reviews.id(reviewId);
    if (!review) {
      return next(new AppError('Review not found', 404));
    }

    if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('You can only delete your own review', 403));
    }

    review.deleteOne();
    book.recalculateRatings();
    await book.save();

    return ApiResponse.success(res, 200, 'Review deleted successfully', { ratings: book.ratings });
  } catch (error) {
    next(error);
  }
};

// @desc    Get filter metadata (min/max price, available formats/languages) for building filter UI
// @route   GET /api/books/filters/meta
// @access  Public
exports.getFilterMeta = async (req, res, next) => {
  try {
    const [priceRange, formats, languages, categories, authors, publishers] = await Promise.all([
      Book.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' } } }
      ]),
      Book.distinct('format', { isActive: true }),
      Book.distinct('language', { isActive: true }),
      Category.find({ isActive: true }).select('name slug').sort({ name: 1 }),
      Author.find({ isActive: true }).select('name slug').sort({ name: 1 }),
      Publisher.find({ isActive: true }).select('name slug').sort({ name: 1 })
    ]);

    return ApiResponse.success(res, 200, 'Filter metadata fetched successfully', {
      priceRange: priceRange[0] || { minPrice: 0, maxPrice: 0 },
      formats,
      languages,
      categories,
      authors,
      publishers
    });
  } catch (error) {
    next(error);
  }
};