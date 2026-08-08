const crypto = require('crypto');
const User = require('../models/User');
const Cart = require('../models/Cart');
const ApiResponse = require('../utils/apiResponse');
const { AppError } = require('../middleware/errorHandler');
const generateTokenAndSetCookie = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return next(new AppError('An account with this email already exists', 400));
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: 'customer' // role is never taken from client input — always defaults server-side
    });

    // Create an empty cart for the new user
    await Cart.create({ user: user._id, items: [] });

    const token = generateTokenAndSetCookie(res, user._id, user.role);

    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    // Fire-and-forget welcome email (non-blocking, doesn't fail registration if email fails)
    sendEmail({
      to: user.email,
      subject: 'Welcome to BookStore!',
      template: 'welcome',
      data: { name: user.name }
    }).catch((err) => console.error('Welcome email failed:', err.message));

    return ApiResponse.success(res, 201, 'Registration successful', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      token
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Please provide both email and password', 400));
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

    if (!user) {
      return next(new AppError('Invalid email or password', 401));
    }

    if (!user.isActive) {
      return next(new AppError('This account has been deactivated. Contact support.', 403));
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return next(new AppError('Invalid email or password', 401));
    }

    const token = generateTokenAndSetCookie(res, user._id, user.role);

    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    return ApiResponse.success(res, 200, 'Login successful', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      },
      token
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user (clear cookie)
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    res.cookie('token', 'none', {
      expires: new Date(Date.now() + 5 * 1000),
      httpOnly: true
    });
    return ApiResponse.success(res, 200, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
};

// @desc    Get currently logged-in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    return ApiResponse.success(res, 200, 'User fetched successfully', { user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update profile (name, phone, avatar)
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const updateFields = {};

    if (name) updateFields.name = name;
    if (phone) updateFields.phone = phone;

    // If avatar was uploaded via multer-cloudinary middleware
    if (req.file) {
      updateFields.avatar = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }

    const user = await User.findByIdAndUpdate(req.user._id, updateFields, {
      new: true,
      runValidators: true
    });

    if (!user) {
      return next(new AppError('User not found', 404));
    }

    return ApiResponse.success(res, 200, 'Profile updated successfully', { user });
  } catch (error) {
    next(error);
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(new AppError('Please provide both current and new password', 400));
    }

    if (newPassword.length < 6) {
      return next(new AppError('New password must be at least 6 characters', 400));
    }

    const user = await User.findById(req.user._id).select('+password');

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return next(new AppError('Current password is incorrect', 401));
    }

    if (currentPassword === newPassword) {
      return next(new AppError('New password must be different from current password', 400));
    }

    user.password = newPassword;
    await user.save();

    const token = generateTokenAndSetCookie(res, user._id, user.role);

    return ApiResponse.success(res, 200, 'Password changed successfully', { token });
  } catch (error) {
    next(error);
  }
};

// @desc    Add or update shipping address
// @route   POST /api/auth/address
// @access  Private
exports.addAddress = async (req, res, next) => {
  try {
    const { fullName, phone, addressLine1, addressLine2, city, state, postalCode, country, isDefault } = req.body;

    const user = await User.findById(req.user._id);

    if (isDefault) {
      user.addresses.forEach((addr) => (addr.isDefault = false));
    }

    user.addresses.push({
      fullName,
      phone,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      isDefault: isDefault || user.addresses.length === 0 // first address is default automatically
    });

    await user.save();

    return ApiResponse.success(res, 201, 'Address added successfully', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a specific address
// @route   PUT /api/auth/address/:addressId
// @access  Private
exports.updateAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);

    const address = user.addresses.id(addressId);
    if (!address) {
      return next(new AppError('Address not found', 404));
    }

    const { fullName, phone, addressLine1, addressLine2, city, state, postalCode, country, isDefault } = req.body;

    if (fullName) address.fullName = fullName;
    if (phone) address.phone = phone;
    if (addressLine1) address.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) address.addressLine2 = addressLine2;
    if (city) address.city = city;
    if (state) address.state = state;
    if (postalCode) address.postalCode = postalCode;
    if (country) address.country = country;

    if (isDefault) {
      user.addresses.forEach((addr) => (addr.isDefault = false));
      address.isDefault = true;
    }

    await user.save();

    return ApiResponse.success(res, 200, 'Address updated successfully', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete an address
// @route   DELETE /api/auth/address/:addressId
// @access  Private
exports.deleteAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);

    const address = user.addresses.id(addressId);
    if (!address) {
      return next(new AppError('Address not found', 404));
    }

    const wasDefault = address.isDefault;
    address.deleteOne();

    // If deleted address was default, promote the next one
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();

    return ApiResponse.success(res, 200, 'Address deleted successfully', { addresses: user.addresses });
  } catch (error) {
    next(error);
  }
};

// @desc    Forgot password - send reset token via email
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      // Don't reveal whether the email exists (prevents account enumeration)
      return ApiResponse.success(
        res,
        200,
        'If an account with that email exists, a password reset link has been sent'
      );
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request - BookStore',
        template: 'passwordReset',
        data: { name: user.name, resetUrl }
      });

      return ApiResponse.success(
        res,
        200,
        'If an account with that email exists, a password reset link has been sent'
      );
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return next(new AppError('Failed to send reset email. Please try again later.', 500));
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password using token
// @route   PUT /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return next(new AppError('Password reset token is invalid or has expired', 400));
    }

    if (!password || password.length < 6) {
      return next(new AppError('Password must be at least 6 characters', 400));
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const token = generateTokenAndSetCookie(res, user._id, user.role);

    return ApiResponse.success(res, 200, 'Password reset successful', { token });
  } catch (error) {
    next(error);
  }
};