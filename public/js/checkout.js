/* ═══════════════════════════════════════════════════════
   BookStore — Checkout Page Logic
   Saved-address vs new-address toggle, live order summary,
   final order placement against /api/orders (Step 8).
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, ButtonState, TokenStore, extractErrorMessage, formatCurrency, renderFieldErrors } = window.BookStore;

  if (!$('#checkoutForm').length) return; // not on the checkout page

  if (!TokenStore.isLoggedIn()) {
    window.location.href = '/login?redirect=/checkout';
  }

  const CheckoutPage = {
    cartData: null,
    userAddresses: [],
    selectedAddressId: null,

    init() {
      this.loadData();
      this.bindEvents();
    },

    loadData() {
      // Fetch cart validity + user profile (for saved addresses) in parallel
      $.when(Api.get('/cart/validate'), Api.get('/auth/me'))
        .done((cartRes, userRes) => {
          const cartData = cartRes[0].data;
          const userData = userRes[0].data.user;

          this.cartData = cartData;
          this.userAddresses = userData.addresses || [];

          if (!cartData.items || cartData.items.length === 0) {
            this.showState('empty');
            return;
          }

          if (cartData.hasStockIssues) {
            this.showState('stockIssue');
            return;
          }

          this.showState('form');
          this.renderOrderSummary(cartData);
          this.renderSavedAddresses();
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR[0] || jqXHR));
          this.showState('empty');
        });
    },

    showState(state) {
      $('#checkoutLoadingState, #checkoutEmptyState, #checkoutStockIssueState, #checkoutForm').addClass('d-none');
      if (state === 'empty') $('#checkoutEmptyState').removeClass('d-none');
      else if (state === 'stockIssue') $('#checkoutStockIssueState').removeClass('d-none');
      else if (state === 'form') $('#checkoutForm').removeClass('d-none');
    },

    renderOrderSummary(data) {
      const itemsHtml = data.items
        .map(
          (item) => `
        <div class="order-item-mini">
          <img src="${item.book.image || '/images/book-placeholder.png'}" alt="${this.esc(item.book.title)}" />
          <div class="flex-grow-1">
            <div class="small fw-semibold">${this.esc(item.book.title)}</div>
            <div class="small text-muted">Qty: ${item.quantity} × ${formatCurrency(item.book.effectivePrice)}</div>
          </div>
          <div class="small fw-semibold">${formatCurrency(item.lineTotal)}</div>
        </div>`
        )
        .join('');

      $('#checkoutItemsList').html(itemsHtml);

      const shipping = 60; // matches SHIPPING_FLAT_RATE in orderController.js (Step 8)
      const subtotal = data.subtotal;
      const discount = data.discountAmount || 0;
      const total = Math.max(0, subtotal - discount + shipping);

      $('#checkoutSubtotal').text(formatCurrency(subtotal));
      $('#checkoutShipping').text(formatCurrency(shipping));
      $('#checkoutTotal').text(formatCurrency(total));

      if (discount > 0 && data.coupon) {
        $('#checkoutDiscountRow').removeClass('d-none');
        $('#checkoutDiscount').text('-' + formatCurrency(discount));
        $('#checkoutCouponLabel').text(`(${data.coupon.code})`);
      } else {
        $('#checkoutDiscountRow').addClass('d-none');
      }
    },

    renderSavedAddresses() {
      if (this.userAddresses.length === 0) {
        $('#savedAddressList').empty();
        $('#noSavedAddressMsg').removeClass('d-none');
        // No saved addresses — force the "new address" mode
        $('#modeNew').prop('checked', true).trigger('change');
        $('#modeSaved').prop('disabled', true);
        return;
      }

      const defaultAddr = this.userAddresses.find((a) => a.isDefault) || this.userAddresses[0];
      this.selectedAddressId = defaultAddr._id;

      const html = this.userAddresses
        .map(
          (addr) => `
        <div class="col-md-6">
          <div class="address-option-card ${addr._id === this.selectedAddressId ? 'selected' : ''}" data-address-id="${addr._id}">
            <div class="d-flex justify-content-between">
              <strong class="small">${this.esc(addr.fullName)}</strong>
              ${addr.isDefault ? '<span class="badge bg-primary bg-opacity-10 text-primary small">Default</span>' : ''}
            </div>
            <div class="small text-muted mt-1">
              ${this.esc(addr.addressLine1)}${addr.addressLine2 ? ', ' + this.esc(addr.addressLine2) : ''}<br/>
              ${this.esc(addr.city)}, ${this.esc(addr.state)} ${this.esc(addr.postalCode)}<br/>
              ${this.esc(addr.country)}<br/>
              <i class="bi bi-telephone me-1"></i>${this.esc(addr.phone)}
            </div>
          </div>
        </div>`
        )
        .join('');

      $('#savedAddressList').html(html);
    },

    esc(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    },

    bindEvents() {
      const self = this;

      // Address mode toggle
      $('input[name="addressMode"]').on('change', function () {
        const mode = $(this).val();
        if (mode === 'saved') {
          $('#savedAddressSection').removeClass('d-none');
          $('#newAddressSection').addClass('d-none');
        } else {
          $('#savedAddressSection').addClass('d-none');
          $('#newAddressSection').removeClass('d-none');
        }
      });

      // Select a saved address card
      $(document).on('click', '.address-option-card', function () {
        $('.address-option-card').removeClass('selected');
        $(this).addClass('selected');
        self.selectedAddressId = $(this).data('address-id');
      });

      // Form submit — place order
      $('#checkoutForm').on('submit', function (e) {
        e.preventDefault();
        self.placeOrder();
      });
    },

    validateNewAddress() {
      const required = {
        fullName: 'Full name',
        phone: 'Phone number',
        addressLine1: 'Address line 1',
        city: 'City',
        state: 'State/Division',
        postalCode: 'Postal code'
      };

      let isValid = true;
      const $form = $('#checkoutForm');
      $form.find('.is-invalid').removeClass('is-invalid');
      $form.find('.invalid-feedback[data-dynamic]').remove();

      Object.keys(required).forEach((field) => {
        const $input = $(`#new${field.charAt(0).toUpperCase() + field.slice(1)}`);
        if (!$input.val() || !$input.val().trim()) {
          $input.addClass('is-invalid');
          $input.after(`<div class="invalid-feedback d-block" data-dynamic="true">${required[field]} is required</div>`);
          isValid = false;
        }
      });

      return isValid;
    },

    placeOrder() {
      const mode = $('input[name="addressMode"]:checked').val();
      const payload = { paymentMethod: 'COD' };

      if (mode === 'saved') {
        if (!this.selectedAddressId) {
          Toast.warning('Please select a shipping address');
          return;
        }
        payload.useSavedAddress = true;
        payload.addressId = this.selectedAddressId;
      } else {
        if (!this.validateNewAddress()) {
          Toast.warning('Please fill in all required address fields');
          return;
        }
        payload.useSavedAddress = false;
        payload.shippingAddress = {
          fullName: $('#newFullName').val().trim(),
          phone: $('#newPhone').val().trim(),
          addressLine1: $('#newAddressLine1').val().trim(),
          addressLine2: $('#newAddressLine2').val().trim(),
          city: $('#newCity').val().trim(),
          state: $('#newState').val().trim(),
          postalCode: $('#newPostalCode').val().trim(),
          country: $('#newCountry').val().trim() || 'Bangladesh'
        };
        payload.saveAddress = $('#saveAddressCheck').is(':checked');
      }

      const notes = $('#orderNotes').val().trim();
      if (notes) payload.notes = notes;

      const $btn = $('#placeOrderBtn');
      ButtonState.loading($btn, ' Placing your order...');

      Api.post('/orders', payload)
        .done((res) => {
          const order = res.data.order;
          Toast.success(`Order ${order.orderNumber} placed successfully!`);
          window.BookStore.refreshCartBadge();

          setTimeout(() => {
            window.location.href = `/orders?highlight=${order._id}`;
          }, 1200);
        })
        .fail((jqXHR) => {
          renderFieldErrors($('#checkoutForm'), jqXHR);
          Toast.error(extractErrorMessage(jqXHR));

          // If it was a stock conflict (409), best to refresh the page state entirely
          if (jqXHR.status === 409) {
            setTimeout(() => this.loadData(), 1500);
          }
        })
        .always(() => {
          ButtonState.reset($btn);
        });
    }
  };

  $(function () {
    CheckoutPage.init();
  });
})(window, jQuery);