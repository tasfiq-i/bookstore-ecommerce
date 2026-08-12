const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      default: 1
    },
    priceAtAddition: {
      type: Number,
      required: true
    }
  },
  { _id: true, timestamps: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    items: [cartItemSchema],
    couponApplied: {
      code: { type: String, default: null },
      discountAmount: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);



// Virtual: subtotal (before discount)
cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Instance method: add or update item
cartSchema.methods.addItem = function (bookId, quantity, price) {
  const existingItem = this.items.find(
    (item) => item.book.toString() === bookId.toString()
  );

  if (existingItem) {
    existingItem.quantity += quantity;
    existingItem.priceAtAddition = price;
  } else {
    this.items.push({ book: bookId, quantity, priceAtAddition: price });
  }
};

// Instance method: update quantity of a specific item
cartSchema.methods.updateItemQuantity = function (bookId, quantity) {
  const item = this.items.find((item) => item.book.toString() === bookId.toString());
  if (!item) {
    throw new Error('Item not found in cart');
  }
  item.quantity = quantity;
};

// Instance method: remove item
cartSchema.methods.removeItem = function (bookId) {
  this.items = this.items.filter((item) => item.book.toString() !== bookId.toString());
};

// Instance method: clear cart
cartSchema.methods.clearCart = function () {
  this.items = [];
  this.couponApplied = { code: null, discountAmount: 0 };
};

module.exports = mongoose.model('Cart', cartSchema);