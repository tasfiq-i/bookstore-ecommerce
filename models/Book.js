const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5']
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters']
    }
  },
  {
     timestamps: true
  }
);

const bookSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Book title is required'],
      trim: true,
      minlength: [1, 'Title cannot be empty'],
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    slug: {
      type: String,
      unique: true, // Automatically creates a unique index
      lowercase: true
    },
    isbn: {
      type: String,
      required: [true, 'ISBN is required'],
      unique: true, // Automatically creates a unique index
      trim: true,
      match: [/^(?:\d{10}|\d{13})$/, 'ISBN must be 10 or 13 digits']
    },
    description: {
      type: String,
      required: [true, 'Book description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters'],
      maxlength: [3000, 'Description cannot exceed 3000 characters']
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required']
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Author',
      required: [true, 'Author is required']
    },
    publisher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Publisher',
      required: [true, 'Publisher is required']
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative']
    },
    discountPrice: {
      type: Number,
      min: [0, 'Discount price cannot be negative'],
      validate: {
        validator: function (value) {
          return value == null || value < this.price;
        },
        message: 'Discount price must be less than the original price'
      }
    },
    stock: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Stock cannot be negative'],
      default: 0
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
      min: [0, 'Threshold cannot be negative']
    },
    images: [
      {
        url: {
           type: String,
            required: true
          },
        publicId: {
           type: String,
            required: true 
          }
      }
    ],
    language: {
      type: String,
      trim: true,
      enum: ['English', 'Bangla', 'Arabic', 'Hindi', 'Urdu'],
      default: 'Bangla'
    },
    pages: {
      type: Number,
      min: [1, 'Pages must be at least 1']
    },
    format: {
      type: String,
      enum: ['Paperback', 'Hardcover', 'E-Book', 'Audiobook','Mass Market Paperback','Spiral Bound','Board Book',],
      default: 'Paperback'
    },
    publishedDate: {
      type: Date
    },
    tags: [{
      type: String, 
      trim: true, 
      lowercase: true }],
    ratings: {
      average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5 
    },
      count: {
      type: Number, 
      default: 0 
      }
    },
    reviews: [reviewSchema],
    soldCount: {
      type: Number,
      default: 0,
      min: 0
    },
    isFeatured: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for search, filter, and sort performance

bookSchema.index({ title: 'text', description: 'text', tags: 'text' });
bookSchema.index({ category: 1 });
bookSchema.index({ author: 1 });
bookSchema.index({ publisher: 1 });
bookSchema.index({ price: 1 });
bookSchema.index({ 'ratings.average': -1 });
bookSchema.index({ stock: 1 });
bookSchema.index({ createdAt: -1 });

// Auto-generate unique slug
bookSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug =
      this.title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Math.random().toString(36).substring(2, 8);
  }
  next();
});

// Virtual: effective selling price
bookSchema.virtual('finalPrice').get(function () {
  return this.discountPrice != null ? this.discountPrice : this.price;
});

// Virtual: stock status label
bookSchema.virtual('stockStatus').get(function () {
  if (this.stock <= 0) return 'out-of-stock';
  if (this.stock <= this.lowStockThreshold) return 'low-stock';
  return 'in-stock';
});

// Instance method: check if requested quantity is available
bookSchema.methods.hasStock = function (quantity) {
  return this.stock >= quantity;
};

// Instance method: reduce stock (used at order placement)
bookSchema.methods.reduceStock = async function (quantity) {
  if (this.stock < quantity) {
    throw new Error(`Insufficient stock for "${this.title}". Only ${this.stock} left.`);
  }
  this.stock -= quantity;
  this.soldCount += quantity;
  await this.save();
  return this;
};

// Instance method: restore stock (used on order cancellation)
bookSchema.methods.restoreStock = async function (quantity) {
  this.stock += quantity;
  this.soldCount = Math.max(0, this.soldCount - quantity);
  await this.save();
  return this;
};

// Instance method: recalculate average rating
bookSchema.methods.recalculateRatings = function () {
  if (this.reviews.length === 0) {
    this.ratings.average = 0;
    this.ratings.count = 0;
  } else {
    const total = this.reviews.reduce((sum, r) => sum + r.rating, 0);
    this.ratings.average = Math.round((total / this.reviews.length) * 10) / 10;
    this.ratings.count = this.reviews.length;
  }
};

// Static method: find books with low stock (for admin alerts)
bookSchema.statics.findLowStock = function () {
  return this.find({
    $expr: { $lte: ['$stock', '$lowStockThreshold'] },
    isActive: true
  });
};

module.exports = mongoose.model('Book', bookSchema);