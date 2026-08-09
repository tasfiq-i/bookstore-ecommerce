/* ═══════════════════════════════════════════════════════
   BookStore — Unified Socket.io Client
   Single connection shared across the whole site. Auto-joins
   catalog room always, user room if logged in, admin room if
   admin. Other scripts subscribe via BookStoreSocket.on(...)
   instead of creating their own io() instance.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const TokenStore = window.BookStore ? window.BookStore.TokenStore : null;

  let socket = null;
  let connected = false;
  const pendingListeners = {}; // event -> [callbacks] registered before connect

  function ensureSocket() {
    if (socket) return socket;

    if (typeof io === 'undefined') {
      console.warn('[BookStoreSocket] Socket.io client library not found — real-time features disabled.');
      return null;
    }

    socket = io({
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1500,
      reconnectionAttempts: 20
    });

    socket.on('connect', () => {
      connected = true;
      $(document).trigger('socket:connected');

      // Every page joins the public catalog room for live stock/product updates
      socket.emit('join-catalog-room');

      const user = TokenStore && TokenStore.getUser();
      if (user) {
        socket.emit('join-user-room', user.id);
        if (user.role === 'admin') {
          socket.emit('join-admin-room', user.id);
        }
      }
    });

    socket.on('disconnect', () => {
      connected = false;
      $(document).trigger('socket:disconnected');
    });

    socket.on('connect_error', (err) => {
      console.warn('[BookStoreSocket] Connection error:', err.message);
    });

    // Attach any listeners that were registered before the socket existed
    Object.keys(pendingListeners).forEach((event) => {
      pendingListeners[event].forEach((cb) => socket.on(event, cb));
    });

    return socket;
  }

  const BookStoreSocket = {
    connect() {
      return ensureSocket();
    },
    isConnected() {
      return connected;
    },
    getSocket() {
      return socket;
    },

    /** Subscribe to a server event. Works even if called before connect(). */
    on(event, callback) {
      if (!pendingListeners[event]) pendingListeners[event] = [];
      pendingListeners[event].push(callback);
      const s = ensureSocket();
      if (s) s.on(event, callback);
    },

    off(event, callback) {
      if (pendingListeners[event]) {
        pendingListeners[event] = pendingListeners[event].filter((cb) => cb !== callback);
      }
      if (socket) socket.off(event, callback);
    },

    emit(event, payload) {
      const s = ensureSocket();
      if (s) s.emit(event, payload);
    },

    joinCatalogRoom() {
      this.emit('join-catalog-room');
    },
    joinUserRoom(userId) {
      this.emit('join-user-room', userId);
    },
    joinAdminRoom(userId) {
      this.emit('join-admin-room', userId);
    },

    // ── Convenience wrappers for the three event families your
    //    backend (sockets/socketHandler.js) already emits ──

    /** cb({ bookId, stock, stockStatus }) */
    onStockUpdate(cb) {
      this.on('stock-update', cb);
    },
    /** cb({ bookId, title, stock, price, discountPrice }) */
    onCatalogUpdate(cb) {
      this.on('catalog-update', cb);
    },
    /** cb({ orderId, orderNumber, totalPrice, customerName, itemCount, createdAt }) — admin room only */
    onNewOrder(cb) {
      this.on('new-order', cb);
    },
    /** cb({ orderId, orderNumber, status, updatedAt }) — the ordering customer's room only */
    onOrderStatusChanged(cb) {
      this.on('order-status-changed', cb);
    },

    /** Generic toast-based notification helper for any event carrying a `.message` field */
    notifyOnEvent(event, toastType) {
      this.on(event, (data) => {
        if (window.BookStore && data && data.message) {
          window.BookStore.Toast[toastType || 'info'](data.message);
        }
      });
    }
  };

  window.BookStoreSocket = BookStoreSocket;

  $(function () {
    BookStoreSocket.connect();
  });
})(window, jQuery);