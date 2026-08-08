const mongoose = require('mongoose');

const authorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Author name is required'],
      trim: true,
      minlength: [2, 'Author name must be at least 2 characters'],
      maxlength: [100, 'Author name cannot exceed 100 characters']
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [1000, 'Bio cannot exceed 1000 characters'],
      default: ''
    },
    photo: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' }
    },
    nationality: {
      type: String,
      trim: true,
      default: ''
    },
    birthDate: {
      type: Date
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

authorSchema.index({ name: 1 });
//authorSchema.index({ slug: 1 }, { unique: true });

authorSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug =
      this.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Math.random().toString(36).substring(2, 7);
  }
  next();
});

authorSchema.virtual('bookCount', {
  ref: 'Book',
  localField: '_id',
  foreignField: 'author',
  count: true
});

authorSchema.set('toJSON', { virtuals: true });
authorSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Author', authorSchema);