/* ═══════════════════════════════════════════════════════
   BookStore — Order History List + Order Detail (Modal & Page)
   Handles: orders.ejs (list, filters, quick-view modal,
            cancel/reorder) and order-detail.ejs (dedicated
            printable/shareable page). Both share Socket.io
            order-status-changed listener.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, TokenStore, extractErrorMessage, formatCurrency, formatDate, refreshCartBadge } = window.BookStore;

  if (!TokenStore.isLoggedIn() && ($('#ordersList').length || $('#orderDetailPage').length)) {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
  }

  // ─────────────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────────────
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function statusBadgeHtml(status) {
    return `<span class="badge order-status-badge status-${status}">${status}</span>`;
  }

  function renderOrderTimeline(statusHistory) {
    if (!statusHistory || statusHistory.length === 0) return '<p class="small text-muted">No history available</p>';

    return statusHistory
      .slice()
      .reverse()
      .map(
        (entry) => `
      <div class="order-timeline-item">
        <div class="fw-semibold small text-capitalize">${esc(entry.status)}</div>
        <div class="small text-muted">${formatDate(entry.changedAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        ${entry.note ? `<div class="small text-secondary mt-1">${esc(entry.note)}</div>` : ''}
      </div>`
      )
      .join('');
  }

  function initSocket() {
    if (typeof io === 'undefined') return null;
    const socket = io({ withCredentials: true });

    const user = TokenStore.getUser();
    socket.on('connect', () => {
      if (user) socket.emit('join-user-room', user.id);
      $('#liveStatusDot').addClass('connected');
      $('#liveStatusText').text('Live updates active');
    });

    socket.on('disconnect', () => {
      $('#liveStatusDot').removeClass('connected');
      $('#liveStatusText').text('Reconnecting...');
    });

    return socket;
  }

  function cancelOrder(orderId, onSuccess) {
    const reason = prompt('Please tell us why you\'re cancelling this order (optional):') || '';

    Api.put(`/orders/${orderId}/cancel`, { reason })
      .done((res) => {
        Toast.success('Order cancelled successfully');
        if (onSuccess) onSuccess(res.data.order);
      })
      .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
  }

  function reorder(orderId) {
    Api.post(`/orders/${orderId}/reorder`)
      .done((res) => {
        Toast.success(res.message);
        refreshCartBadge();
        setTimeout(() => {
          window.location.href = '/cart';
        }, 900);
      })
      .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
  }

  // ═══════════════════════════════════════════════════════
  // ORDER LIST PAGE (orders.ejs)
  // ═══════════════════════════════════════════════════════
  const OrdersListPage = {
    socket: null,
    state: { status: '', page: 1 },
    modal: null,

    init() {
      this.modal = new bootstrap.Modal(document.getElementById('orderDetailModal'));
      this.fetchOrders();
      this.bindEvents();
      this.socket = initSocket();
      this.bindSocketEvents();
    },

    fetchOrders() {
      $('#ordersLoadingState').removeClass('d-none');
      $('#ordersList, #ordersEmptyState').addClass('d-none');

      const params = { page: this.state.page, limit: 10 };
      if (this.state.status) params.status = this.state.status;

      Api.get('/orders/my-orders', params)
        .done((res) => {
          $('#ordersLoadingState').addClass('d-none');
          const orders = res.data.orders || [];

          if (orders.length === 0) {
            $('#ordersEmptyState').removeClass('d-none');
            $('#ordersPagination').empty();
            return;
          }

          $('#ordersList').removeClass('d-none').html(orders.map((o) => this.renderOrderCard(o)).join(''));
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          $('#ordersLoadingState').addClass('d-none');
          Toast.error(extractErrorMessage(jqXHR));
        });
    },

    renderOrderCard(order) {
      const thumbs = order.items
        .slice(0, 4)
        .map((item) => `<img src="${item.image || '/images/book-placeholder.png'}" alt="${esc(item.title)}" />`)
        .join('');

      const canCancel = ['pending', 'confirmed'].includes(order.status);

      return `
        <div class="order-list-card" data-order-id="${order._id}">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div>
              <div class="d-flex align-items-center gap-2 mb-1">
                <strong>${esc(order.orderNumber)}</strong>
                ${statusBadgeHtml(order.status)}
              </div>
              <div class="small text-muted">
                Placed on ${formatDate(order.createdAt)} • ${order.items.length} item(s)
              </div>
            </div>
            <div class="text-end">
              <div class="fw-bold">${formatCurrency(order.totalPrice)}</div>
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-3">
            <div class="order-thumb-stack">${thumbs}</div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-sm btn-outline-primary quick-view-btn" data-order-id="${order._id}">
                <i class="bi bi-eye me-1"></i> View
              </button>
              ${
                order.status === 'delivered'
                  ? `<button class="btn btn-sm btn-outline-secondary reorder-btn" data-order-id="${order._id}"><i class="bi bi-arrow-repeat me-1"></i> Reorder</button>`
                  : ''
              }
              ${
                canCancel
                  ? `<button class="btn btn-sm btn-outline-danger cancel-order-btn" data-order-id="${order._id}"><i class="bi bi-x-circle me-1"></i> Cancel</button>`
                  : ''
              }
            </div>
          </div>
        </div>`;
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1 } = meta || {};
      const $pagination = $('#ordersPagination');
      if (totalPages <= 1) return $pagination.empty();

      let html = '';
      for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }
      $pagination.html(html);
    },

    openQuickView(orderId) {
      $('#orderModalBody').html('<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>');
      $('#viewFullOrderBtn').attr('href', `/orders/${orderId}`);
      this.modal.show();

      Api.get(`/orders/${orderId}`)
        .done((res) => {
          $('#orderModalBody').html(this.renderModalContent(res.data.order));
        })
        .fail((jqXHR) => {
          $('#orderModalBody').html(`<div class="alert alert-danger">${extractErrorMessage(jqXHR)}</div>`);
        });
    },

    renderModalContent(order) {
      const itemsHtml = order.items
        .map(
          (item) => `
        <div class="order-item-mini">
          <img src="${item.image || '/images/book-placeholder.png'}" alt="${esc(item.title)}" />
          <div class="flex-grow-1">
            <div class="small fw-semibold">${esc(item.title)}</div>
            <div class="small text-muted">Qty: ${item.quantity} × ${formatCurrency(item.price)}</div>
          </div>
          <div class="small fw-semibold">${formatCurrency(item.price * item.quantity)}</div>
        </div>`
        )
        .join('');

      return `
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h6 class="mb-0">${esc(order.orderNumber)}</h6>
          ${statusBadgeHtml(order.status)}
        </div>
        <p class="small text-muted">Placed on ${formatDate(order.createdAt)}</p>

        <h6 class="small text-uppercase text-muted mt-4 mb-2">Items</h6>
        ${itemsHtml}

        <hr/>
        <div class="d-flex justify-content-between small mb-1"><span class="text-muted">Subtotal</span><span>${formatCurrency(order.itemsPrice)}</span></div>
        ${order.discountAmount > 0 ? `<div class="d-flex justify-content-between small mb-1 text-success"><span>Discount</span><span>-${formatCurrency(order.discountAmount)}</span></div>` : ''}
        <div class="d-flex justify-content-between small mb-1"><span class="text-muted">Shipping</span><span>${formatCurrency(order.shippingPrice)}</span></div>
        <div class="d-flex justify-content-between fw-bold mt-2"><span>Total</span><span>${formatCurrency(order.totalPrice)}</span></div>

        <h6 class="small text-uppercase text-muted mt-4 mb-2">Shipping Address</h6>
        <div class="small">
          ${esc(order.shippingAddress.fullName)}<br/>
          ${esc(order.shippingAddress.addressLine1)}${order.shippingAddress.addressLine2 ? ', ' + esc(order.shippingAddress.addressLine2) : ''}<br/>
          ${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.state)} ${esc(order.shippingAddress.postalCode)}<br/>
          ${esc(order.shippingAddress.country)} • <i class="bi bi-telephone me-1"></i>${esc(order.shippingAddress.phone)}
        </div>
      `;
    },

    bindEvents() {
      const self = this;

      $('#orderStatusTabs').on('click', 'button', function () {
        $('#orderStatusTabs button').removeClass('active');
        $(this).addClass('active');
        self.state.status = $(this).data('status');
        self.state.page = 1;
        self.fetchOrders();
      });

      $(document).on('click', '#ordersPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchOrders();
        $('html, body').animate({ scrollTop: 0 }, 300);
      });

      $(document).on('click', '.quick-view-btn', function () {
        self.openQuickView($(this).data('order-id'));
      });

      $(document).on('click', '.cancel-order-btn', function () {
        const orderId = $(this).data('order-id');
        cancelOrder(orderId, () => self.fetchOrders());
      });

      $(document).on('click', '.reorder-btn', function () {
        reorder($(this).data('order-id'));
      });
    },

    bindSocketEvents() {
      if (!this.socket) return;

      this.socket.on('order-status-changed', (data) => {
        Toast.info(`Order ${data.orderNumber} status updated to "${data.status}"`);

        const $card = $(`.order-list-card[data-order-id="${data.orderId}"]`);
        if ($card.length) {
          $card.find('.order-status-badge').attr('class', `badge order-status-badge status-${data.status}`).text(data.status);
          $card.addClass('order-status-live-updated');
          setTimeout(() => $card.removeClass('order-status-live-updated'), 1400);

          // Cancel button should disappear if status moved past cancellable states
          if (!['pending', 'confirmed'].includes(data.status)) {
            $card.find('.cancel-order-btn').remove();
          }
          if (data.status === 'delivered' && $card.find('.reorder-btn').length === 0) {
            $card.find('.quick-view-btn').after(
              `<button class="btn btn-sm btn-outline-secondary reorder-btn" data-order-id="${data.orderId}"><i class="bi bi-arrow-repeat me-1"></i> Reorder</button>`
            );
          }
        }
      });
    }
  };

  // ═══════════════════════════════════════════════════════
  // ORDER DETAIL PAGE (order-detail.ejs) — /orders/:id
  // ═══════════════════════════════════════════════════════
  const OrderDetailPage = {
    orderId: null,
    socket: null,
    currentOrder: null,

    init() {
      this.orderId = $('#orderDetailPage').data('order-id');
      if (!this.orderId) return;

      this.fetchOrder();
      this.socket = initSocket();
      this.bindSocketEvents();
    },

    fetchOrder() {
      Api.get(`/orders/${this.orderId}`)
        .done((res) => {
          this.currentOrder = res.data.order;
          this.render(res.data.order);
        })
        .fail(() => {
          $('#orderPageLoading').addClass('d-none');
          $('#orderPageNotFound').removeClass('d-none');
        });
    },

    render(order) {
      $('#orderPageLoading').addClass('d-none');
      $('#orderPageContent').removeClass('d-none');

      document.title = `Order ${order.orderNumber} | BookStore`;

      $('#pageOrderNumber').text(order.orderNumber);
      $('#pageOrderDate').text(formatDate(order.createdAt, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      $('#pageStatusBadge').attr('class', `badge order-status-badge status-${order.status}`).text(order.status);
      $('#pagePaymentStatus').text(order.paymentStatus).addClass('text-capitalize');

      $('#pageOrderItems').html(
        order.items
          .map(
            (item) => `
        <div class="order-item-mini">
          <img src="${item.image || '/images/book-placeholder.png'}" alt="${esc(item.title)}" />
          <div class="flex-grow-1">
            <div class="small fw-semibold">${esc(item.title)}</div>
            <div class="small text-muted">Qty: ${item.quantity} × ${formatCurrency(item.price)}</div>
          </div>
          <div class="small fw-semibold">${formatCurrency(item.price * item.quantity)}</div>
        </div>`
          )
          .join('')
      );

      $('#pageItemsPrice').text(formatCurrency(order.itemsPrice));
      $('#pageShippingPrice').text(formatCurrency(order.shippingPrice));
      $('#pageTotalPrice').text(formatCurrency(order.totalPrice));

      if (order.discountAmount > 0) {
        $('#pageDiscountRow').removeClass('d-none');
        $('#pageDiscountAmount').text('-' + formatCurrency(order.discountAmount));
        $('#pageCouponCode').text(order.couponCode ? `(${order.couponCode})` : '');
      }

      $('#pageShippingAddress').html(`
        ${esc(order.shippingAddress.fullName)}<br/>
        ${esc(order.shippingAddress.addressLine1)}${order.shippingAddress.addressLine2 ? ', ' + esc(order.shippingAddress.addressLine2) : ''}<br/>
        ${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.state)} ${esc(order.shippingAddress.postalCode)}<br/>
        ${esc(order.shippingAddress.country)}<br/>
        <i class="bi bi-telephone me-1"></i>${esc(order.shippingAddress.phone)}
      `);

      $('#pageOrderTimeline').html(renderOrderTimeline(order.statusHistory));

      this.renderActions(order);
    },

    renderActions(order) {
      const canCancel = ['pending', 'confirmed'].includes(order.status);
      let html = '';

      if (canCancel) {
        html += `<button class="btn btn-outline-danger" id="pageCancelOrderBtn"><i class="bi bi-x-circle me-1"></i> Cancel Order</button>`;
      }
      if (order.status === 'delivered') {
        html += `<button class="btn btn-outline-primary" id="pageReorderBtn"><i class="bi bi-arrow-repeat me-1"></i> Reorder</button>`;
      }
      html += `<a href="/orders" class="btn btn-outline-secondary"><i class="bi bi-arrow-left me-1"></i> Back to My Orders</a>`;

      $('#pageOrderActions').html(html);

      $('#pageCancelOrderBtn').on('click', () => {
        cancelOrder(order._id, (updatedOrder) => {
          this.currentOrder = updatedOrder;
          this.render(updatedOrder);
        });
      });

      $('#pageReorderBtn').on('click', () => reorder(order._id));
    },

    bindSocketEvents() {
      if (!this.socket) return;

      this.socket.on('order-status-changed', (data) => {
        if (data.orderId !== this.orderId) return;
        Toast.info(`Order status updated to "${data.status}"`);
        this.fetchOrder(); // refetch full order to get updated statusHistory
      });
    }
  };

  // ─────────────────────────────────────────────────────
  // Page router
  // ─────────────────────────────────────────────────────
  $(function () {
    if ($('#ordersList').length) {
      OrdersListPage.init();
    }
    if ($('#orderDetailPage').length) {
      OrderDetailPage.init();
    }
  });
})(window, jQuery);