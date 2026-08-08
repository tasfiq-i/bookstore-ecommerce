const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const { AppError } = require('./errorHandler');

const createCloudinaryStorage = (folderName) => {
  return new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `bookstore/${folderName}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }]
    }
  });
};

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extValid = allowedTypes.test(file.originalname.toLowerCase());
  const mimeValid = allowedTypes.test(file.mimetype);

  if (extValid && mimeValid) {
    cb(null, true);
  } else {
    cb(new AppError('Only image files (jpg, jpeg, png, webp) are allowed', 400), false);
  }
};

const uploadBookImages = multer({
  storage: createCloudinaryStorage('books'),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 } // 5MB per file, max 5 files
});

const uploadAuthorPhoto = multer({
  storage: createCloudinaryStorage('authors'),
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }
});

const uploadPublisherLogo = multer({
  storage: createCloudinaryStorage('publishers'),
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }
});

const uploadCategoryImage = multer({
  storage: createCloudinaryStorage('categories'),
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }
});

const uploadAvatar = multer({
  storage: createCloudinaryStorage('avatars'),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

module.exports = {
  uploadBookImages,
  uploadAuthorPhoto,
  uploadPublisherLogo,
  uploadCategoryImage,
  uploadAvatar
};