/* ═══════════════════════════════════════════════════════
   BookStore — Guest Cart (localStorage-backed)
   Used only when the visitor is not logged in. Once they log
   in or register, mergeIntoAccount() pushes these items into
   their real DB cart and clears local storage.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const STORAGE_KEY = 'bookstore_guest_cart';

  function readRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeRaw(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  const GuestCart = {
    getItems() {
      return readRaw();
    },

    getCount() {
      return this.getItems().reduce((sum, i) => sum + i.quantity, 0);
    },

    addItem(bookId, quantity = 1) {
      const items = readRaw();
      const existing = items.find((i) => i.bookId === bookId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        items.push({ bookId, quantity });
      }
      writeRaw(items);
      $(document).trigger('guestcart:changed');
    },

    updateQuantity(bookId, quantity) {
      const items = readRaw();
      const item = items.find((i) => i.bookId === bookId);
      if (item) {
        item.quantity = Math.max(1, quantity);
        writeRaw(items);
        $(document).trigger('guestcart:changed');
      }
    },

    removeItem(bookId) {
      const items = readRaw().filter((i) => i.bookId !== bookId);
      writeRaw(items);
      $(document).trigger('guestcart:changed');
    },

    clear() {
      localStorage.removeItem(STORAGE_KEY);
      $(document).trigger('guestcart:changed');
    },

    isEmpty() {
      return this.getItems().length === 0;
    },

    /**
     * Fetches live book data for every item in the guest cart and returns
     * a summary shaped identically to the authenticated cart's
     * buildCartSummary() response, so cart.js can render either through
     * the same template logic.
     */
    async hydrate() {
      const { Api } = window.BookStore;
      const rawItems = readRaw();

      if (rawItems.length === 0) {
        return {
          items: [],
          itemCount: 0,
          subtotal: 0,
          discountAmount: 0,
          coupon: null,
          total: 0,
          hasStockIssues: false,
          removedItems: []
        };
      }

      const results = await Promise.all(
        rawItems.map((raw) =>
          Api.get(`/books/${raw.bookId}`)
            .then((res) => ({ raw, book: res.data.book }))
            .catch(() => ({ raw, book: null }))
        )
      );

      const items = [];
      const removedItems = [];
      let hasStockIssues = false;

      results.forEach(({ raw, book }) => {
        if (!book) {
          removedItems.push('An item in your cart is no longer available');
          return;
        }
        const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;
        const isStockInsufficient = raw.quantity > book.stock;
        if (isStockInsufficient) hasStockIssues = true;

        items.push({
          _id: raw.bookId,
          book: {
            _id: book._id,
            title: book.title,
            slug: book.slug,
            image: book.images && book.images.length ? book.images[0].url : null,
            price: book.price,
            discountPrice: book.discountPrice,
            effectivePrice,
            stock: book.stock,
            stockStatus: book.stockStatus
          },
          quantity: raw.quantity,
          lineTotal: Math.round(effectivePrice * raw.quantity * 100) / 100,
          isStockInsufficient,
          maxAvailable: book.stock
        });
      });

      if (removedItems.length > 0) {
        writeRaw(rawItems.filter((r) => items.some((i) => i._id === r.bookId)));
      }

      const subtotal = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;

      return {
        items,
        itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
        subtotal,
        discountAmount: 0,
        coupon: null,
        total: subtotal,
        hasStockIssues,
        removedItems
      };
    },

    /**
     * Called right after a successful login/register. Pushes local items
     * into the user's real DB cart via POST /api/cart/merge, then clears
     * local storage.
     */
    async mergeIntoAccount() {
      const { Api, Toast } = window.BookStore;
      const items = readRaw();

      if (items.length === 0) return;

      try {
        const res = await Api.post('/cart/merge', { items });
        this.clear();
        if (res.data && res.data.itemCount > 0) {
          Toast.info(`${items.length} item(s) from your guest cart were added to your account cart`);
        }
      } catch (err) {
        console.error('Guest cart merge failed:', err);
      }
    }
  };

  window.GuestCart = GuestCart;
})(window, jQuery);