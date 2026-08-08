const mongoose = require('mongoose');

const publisherSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Publisher name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Publisher name must be at least 2 characters'],
      maxlength: [100, 'Publisher name cannot exceed 100 characters']
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
    logo: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' }
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    establishedYear: {
      type: Number,
      min: [1400, 'Established year seems invalid'],
      max: [new Date().getFullYear(), 'Established year cannot be in the future']
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

//publisherSchema.index({ name: 1 }, { unique: true });
//publisherSchema.index({ slug: 1 }, { unique: true });

publisherSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

publisherSchema.virtual('bookCount', {
  ref: 'Book',
  localField: '_id',
  foreignField: 'publisher',
  count: true
});

publisherSchema.set('toJSON', { virtuals: true });
publisherSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Publisher', publisherSchema);