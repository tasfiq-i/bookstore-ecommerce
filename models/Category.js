const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Category name must be at least 2 characters'],
      maxlength: [50, 'Category name cannot exceed 50 characters']
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: ''
    },
    image: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

//categorySchema.index({ name: 1 }, { unique: true });
//categorySchema.index({ slug: 1 }, { unique: true });

// Auto-generate slug from name
categorySchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Virtual: book count in this category
categorySchema.virtual('bookCount', {
  ref: 'Book',
  localField: '_id',
  foreignField: 'category',
  count: true
});

categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Category', categorySchema);