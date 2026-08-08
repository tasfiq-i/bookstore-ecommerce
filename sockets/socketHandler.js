let ioInstance = null;

const initSocket = (io) => {
  ioInstance = io;

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Client joins role-based rooms after identifying itself
    socket.on('join-admin-room', (adminId) => {
      socket.join('admin-room');
      console.log(`👨‍💼 Admin ${adminId} joined admin-room via socket ${socket.id}`);
    });

    socket.on('join-user-room', (userId) => {
      if (userId) {
        socket.join(`user-${userId}`);
        console.log(`👤 User ${userId} joined personal room via socket ${socket.id}`);
      }
    });

    socket.on('join-catalog-room', () => {
      socket.join('catalog-room');
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });
};

// Emit helpers — called from controllers after DB operations succeed

const emitNewOrder = (order) => {
  if (!ioInstance) return;
  ioInstance.to('admin-room').emit('new-order', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    totalPrice: order.totalPrice,
    customerName: order.shippingAddress.fullName,
    itemCount: order.items.length,
    createdAt: order.createdAt
  });
};

const emitStockUpdate = (book) => {
  if (!ioInstance) return;
  ioInstance.to('catalog-room').emit('stock-update', {
    bookId: book._id,
    stock: book.stock,
    stockStatus: book.stockStatus
  });
};

const emitNewOrStockBook = (book) => {
  if (!ioInstance) return;
  ioInstance.to('catalog-room').emit('catalog-update', {
    bookId: book._id,
    title: book.title,
    stock: book.stock,
    price: book.price,
    discountPrice: book.discountPrice
  });
};

const emitOrderStatusChange = (order) => {
  if (!ioInstance) return;
  ioInstance.to(`user-${order.user.toString()}`).emit('order-status-changed', {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    updatedAt: order.updatedAt
  });
};

module.exports = {
  initSocket,
  emitNewOrder,
  emitStockUpdate,
  emitNewOrStockBook,
  emitOrderStatusChange
};