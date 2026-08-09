/* ═══════════════════════════════════════════════════════
   BookStore — Cart Page Logic
   Supports BOTH guest (localStorage-backed via GuestCart) and
   authenticated (DB-backed via /api/cart) users through one
   shared render() pipeline. Server/GuestCart.hydrate() responses
   are shaped identically so render() never needs to branch.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, TokenStore, extractErrorMessage, formatCurrency, refreshCartBadge } = window.BookStore;

  if (!$('#cartContent').length) return; // not on the cart page

  const CartPage = {
    lastData: null,
    isGuest: !TokenStore.isLoggedIn(),

    init() {
      this.fetchCart();
      this.bindEvents();

      $(document).on('guestcart:changed', () => {
        if (this.isGuest) this.fetchCart();
      });
    },

    fetchCart() {
      if (this.isGuest) {
        window.GuestCart.hydrate()
          .then((data) => {
            this.lastData = data;
            this.render(data);
          })
          .catch((err) => {
            console.error(err);
            $('#cartLoadingState').addClass('d-none');
            $('#cartEmptyState').removeClass('d-none');
          });
        return;
      }

      Api.get('/cart/validate')
        .done((res) => {
          this.lastData = res.data;
          this.render(res.data);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#cartLoadingState').addClass('d-none');
          $('#cartEmptyState').removeClass('d-none');
        });
    },

    render(data) {
      $('#cartLoadingState').addClass('d-none');

      if (!data.items || data.items.length === 0) {
        $('#cartContent').addClass('d-none');
        $('#cartEmptyState').removeClass('d-none');
        refreshCartBadge();
        return;
      }

      $('#cartEmptyState').addClass('d-none');
      $('#cartContent').removeClass('d-none');

      $('#cartItemCount').text(data.itemCount);
      $('#cartItemsList').html(data.items.map((item) => this.renderItem(item)).join(''));

      $('#summarySubtotal').text(formatCurrency(data.subtotal));
      $('#summaryTotal').text(formatCurrency(data.subtotal - (data.discountAmount || 0)));

      if (data.discountAmount > 0) {
        $('#summaryDiscountRow').removeClass('d-none');
        $('#summaryDiscount').text('-' + formatCurrency(data.discountAmount));
      } else {
        $('#summaryDiscountRow').addClass('d-none');
      }

      // Coupon UI: guests never see the input, they see a login prompt instead
      const $couponWrap = $('#couponInputArea').closest('.mb-3');
      if (this.isGuest) {
        $couponWrap.html(
          '<div class="alert alert-light border small mb-0"><i class="bi bi-info-circle me-1"></i>' +
          '<a href="/login?redirect=/cart">Log in</a> to apply a coupon code.</div>'
        );
      } else if (data.coupon) {
        $('#couponInputArea').addClass('d-none');
        $('#couponAppliedArea').removeClass('d-none');
        $('#appliedCouponCode').text(data.coupon.code);
      } else {
        $('#couponInputArea').removeClass('d-none');
        $('#couponAppliedArea').addClass('d-none');
        $('#couponCodeInput').val('');
        $('#couponFeedback').empty();
      }

      if (data.hasStockIssues) {
        $('#stockWarningBanner').removeClass('d-none');
        $('#proceedToCheckoutBtn').prop('disabled', true);
      } else {
        $('#stockWarningBanner').addClass('d-none');
        $('#proceedToCheckoutBtn').prop('disabled', false);
      }

      refreshCartBadge();
    },

    renderItem(item) {
      const book = item.book;
      const isIssue = item.isStockInsufficient;

      return `
        <div class="cart-item-row" data-book-id="${book._id}">
          <a href="/books/${book.slug}">
            <img src="${book.image || '/images/book-placeholder.png'}" alt="${this.esc(book.title)}" class="cart-item-img" />
          </a>
          <div class="flex-grow-1">
            <div class="d-flex justify-content-between">
              <div>
                <a href="/books/${book.slug}" class="text-decoration-none text-dark">
                  <h6 class="mb-1">${this.esc(book.title)}</h6>
                </a>
                <div class="small text-muted mb-1">${formatCurrency(book.effectivePrice)} each</div>
                ${
                  isIssue
                    ? `<div class="stock-warning-text"><i class="bi bi-exclamation-triangle me-1"></i>Only ${item.maxAvailable} available — please reduce quantity</div>`
                    : book.stockStatus === 'low-stock'
                    ? `<div class="small text-warning"><i class="bi bi-exclamation-circle me-1"></i>Only ${book.stock} left in stock</div>`
                    : ''
                }
              </div>
              <i class="bi bi-x-lg remove-item-btn" data-book-id="${book._id}" title="Remove item"></i>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-2">
              <div class="cart-item-qty">
                <button type="button" class="qty-decrease-btn" data-book-id="${book._id}">−</button>
                <input type="number" class="qty-input" data-book-id="${book._id}" value="${item.quantity}" min="1" max="${book.stock}" />
                <button type="button" class="qty-increase-btn" data-book-id="${book._id}">+</button>
              </div>
              <div class="fw-semibold">${formatCurrency(item.lineTotal)}</div>
            </div>
          </div>
        </div>
      `;
    },

    esc(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    },

    updateQuantity(bookId, quantity) {
      if (quantity < 1) return;

      if (this.isGuest) {
        window.GuestCart.updateQuantity(bookId, quantity);
        return; // re-render triggered by the guestcart:changed listener
      }

      const $row = $(`.cart-item-row[data-book-id="${bookId}"]`);
      $row.css('opacity', 0.5);

      Api.put(`/cart/items/${bookId}`, { quantity })
        .done((res) => {
          this.lastData = res.data;
          this.render(res.data);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          this.fetchCart();
        });
    },

    removeItem(bookId) {
      if (this.isGuest) {
        window.GuestCart.removeItem(bookId);
        Toast.success('Item removed from cart');
        return;
      }

      const $row = $(`.cart-item-row[data-book-id="${bookId}"]`);
      $row.css('opacity', 0.4);

      Api.delete(`/cart/items/${bookId}`)
        .done((res) => {
          Toast.success('Item removed from cart');
          this.lastData = res.data;
          this.render(res.data);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $row.css('opacity', 1);
        });
    },

    bindEvents() {
      const self = this;

      $(document).on('click', '.qty-increase-btn', function () {
        const bookId = $(this).data('book-id');
        const $input = $(`.qty-input[data-book-id="${bookId}"]`);
        const max = parseInt($input.attr('max'), 10) || 999;
        const newVal = Math.min(max, parseInt($input.val(), 10) + 1);
        $input.val(newVal);
        self.updateQuantity(bookId, newVal);
      });

      $(document).on('click', '.qty-decrease-btn', function () {
        const bookId = $(this).data('book-id');
        const $input = $(`.qty-input[data-book-id="${bookId}"]`);
        const newVal = Math.max(1, parseInt($input.val(), 10) - 1);
        $input.val(newVal);
        self.updateQuantity(bookId, newVal);
      });

      $(document).on('change', '.qty-input', function () {
        const bookId = $(this).data('book-id');
        const max = parseInt($(this).attr('max'), 10) || 999;
        let val = parseInt($(this).val(), 10) || 1;
        val = Math.max(1, Math.min(max, val));
        $(this).val(val);
        self.updateQuantity(bookId, val);
      });

      $(document).on('click', '.remove-item-btn', function () {
        const bookId = $(this).data('book-id');
        self.removeItem(bookId);
      });

      $('#clearCartBtn').on('click', function () {
        if (!confirm('Are you sure you want to clear your entire cart?')) return;

        if (self.isGuest) {
          window.GuestCart.clear();
          return;
        }

        Api.delete('/cart')
          .done((res) => {
            Toast.success('Cart cleared');
            self.lastData = res.data;
            self.render(res.data);
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
      });

      // Coupon apply/remove — no-ops for guests since the input is hidden
      $('#applyCouponBtn').on('click', function () {
        if (self.isGuest) return;
        const code = $('#couponCodeInput').val().trim();
        if (!code) {
          Toast.warning('Please enter a coupon code');
          return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

        Api.post('/cart/coupon', { code })
          .done((res) => {
            Toast.success(res.message);
            self.lastData = res.data;
            self.render(res.data);
          })
          .fail((jqXHR) => {
            $('#couponFeedback').html(`<span class="text-danger">${extractErrorMessage(jqXHR)}</span>`);
          })
          .always(() => {
            $btn.prop('disabled', false).text('Apply');
          });
      });

      $('#couponCodeInput').on('keypress', function (e) {
        if (e.which === 13) {
          e.preventDefault();
          $('#applyCouponBtn').click();
        }
      });

      $('#removeCouponBtn').on('click', function () {
        if (self.isGuest) return;
        Api.delete('/cart/coupon')
          .done((res) => {
            Toast.success('Coupon removed');
            self.lastData = res.data;
            self.render(res.data);
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
      });

      $('#proceedToCheckoutBtn').on('click', function () {
        if ($(this).prop('disabled')) return;
        window.location.href = '/checkout';
      });
    }
  };

  $(function () {
    CartPage.init();
  });
})(window, jQuery);