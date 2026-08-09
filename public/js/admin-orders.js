/* ═══════════════════════════════════════════════════════
   BookStore — Admin Orders Management
   Server-side pagination/filter, inline quick status-change
   dropdown in the table, full detail modal with status+notes
   update, live Socket.io new-order listener.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, extractErrorMessage, formatCurrency, formatDate } = window.BookStore;
  const { esc } = window.AdminCore;

  if (!$('#ordersTableBody').length) return;

  const STATUS_FLOW = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

  const OrdersPage = {
    state: { status: '', search: '', paymentStatus: '', startDate: '', endDate: '', page: 1, limit: 20 },
    orders: [],
    modal: null,
    socket: null,

    init() {
      if (!window.AdminCore.guardAdminAccess()) return;
      window.AdminCore.initSidebarToggle();
      this.socket = window.AdminCore.initAdminSocket();

      this.modal = new bootstrap.Modal(document.getElementById('orderDetailAdminModal'));

      // Highlight a specific order if navigated here from Dashboard's activity feed
      const params = new URLSearchParams(window.location.search);
      this.highlightId = params.get('highlight');

      this.fetchOrders();
      this.bindEvents();
      this.bindSocketEvents();
    },

    fetchOrders() {
      const params = {
        page: this.state.page,
        limit: this.state.limit
      };
      if (this.state.status) params.status = this.state.status;
      if (this.state.search) params.search = this.state.search;
      if (this.state.paymentStatus) params.paymentStatus = this.state.paymentStatus;
      if (this.state.startDate) params.startDate = this.state.startDate;
      if (this.state.endDate) params.endDate = this.state.endDate;

      $('#ordersTableBody').html(
        `<tr><td colspan="8" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`
      );

      Api.get('/orders', params)
        .done((res) => {
          this.orders = res.data.orders || [];
          this.renderTable();
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#ordersTableBody').html(`<tr><td colspan="8" class="text-center text-danger py-4">Failed to load orders</td></tr>`);
        });
    },

    statusOptionsHtml(currentStatus) {
      // Cancelled and delivered are terminal states — no forward options once reached,
      // matching orderController.js's updateOrderStatus guard logic exactly.
      if (currentStatus === 'cancelled') {
        return `<option value="cancelled" selected>Cancelled</option>`;
      }
      if (currentStatus === 'delivered') {
        return `<option value="delivered" selected>Delivered</option>`;
      }
      return STATUS_FLOW.map(
        (s) => `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
      ).join('');
    },

    renderTable() {
      if (this.orders.length === 0) {
        $('#ordersTableBody').html(`<tr><td colspan="8" class="text-center text-muted py-4">No orders found</td></tr>`);
        return;
      }

      const html = this.orders
        .map((order) => {
          const isLocked = order.status === 'cancelled' || order.status === 'delivered';
          const paymentBadgeClass =
            order.paymentStatus === 'paid' ? 'bg-success' : order.paymentStatus === 'failed' ? 'bg-danger' : 'bg-secondary';
          const highlightClass = this.highlightId === order._id ? 'order-row-highlight' : '';

          return `
          <tr data-id="${order._id}" class="${highlightClass}">
            <td class="fw-semibold small">${esc(order.orderNumber)}</td>
            <td>
              <div class="small fw-semibold">${esc(order.user ? order.user.name : order.shippingAddress.fullName)}</div>
              <div class="small text-muted">${esc(order.shippingAddress.phone)}</div>
            </td>
            <td class="small text-center">${order.items.length}</td>
            <td class="small fw-semibold">${formatCurrency(order.totalPrice)}</td>
            <td>
              <span class="badge payment-badge-cod ${paymentBadgeClass}">${order.paymentStatus}</span>
            </td>
            <td>
              <select class="status-select-inline status-${order.status}" data-id="${order._id}" data-current="${order.status}" ${isLocked ? 'disabled' : ''}>
                ${this.statusOptionsHtml(order.status)}
              </select>
            </td>
            <td class="small text-muted">${formatDate(order.createdAt)}</td>
            <td class="text-end">
              <button class="action-icon-btn view-order-btn" data-id="${order._id}" title="View Details"><i class="bi bi-eye"></i></button>
              <a class="action-icon-btn" href="/orders/${order._id}" target="_blank" title="Open Print View"><i class="bi bi-printer"></i></a>
            </td>
          </tr>`;
        })
        .join('');

      $('#ordersTableBody').html(html);

      if (this.highlightId) {
        setTimeout(() => {
          $(`tr[data-id="${this.highlightId}"]`).removeClass('order-row-highlight');
        }, 2600);
        this.highlightId = null;
      }
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1, totalResults = 0 } = meta || {};
      $('#ordersResultsInfo').text(`${totalResults} order(s) found`);

      const $pagination = $('#ordersPagination');
      if (totalPages <= 1) return $pagination.empty();

      let html = '';
      const start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, currentPage + 2);
      if (start > 1) html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
      for (let i = start; i <= end; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }
      if (end < totalPages) html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
      $pagination.html(html);
    },

    // ── Inline quick status change (in-row dropdown) ──
    quickChangeStatus($select) {
      const orderId = $select.data('id');
      const currentStatus = $select.data('current');
      const newStatus = $select.val();

      if (newStatus === currentStatus) return;

      const confirmMsg =
        newStatus === 'cancelled'
          ? 'Cancel this order? Stock will be restored automatically.'
          : `Change order status to "${newStatus}"?`;

      if (!confirm(confirmMsg)) {
        $select.val(currentStatus);
        return;
      }

      $select.prop('disabled', true);

      Api.put(`/orders/${orderId}/status`, { status: newStatus })
        .done((res) => {
          Toast.success(`Order status updated to "${newStatus}"`);
          const order = this.orders.find((o) => o._id === orderId);
          if (order) {
            order.status = newStatus;
            order.paymentStatus = res.data.order.paymentStatus;
          }
          this.renderTable();
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $select.val(currentStatus).prop('disabled', false);
        });
    },

    // ── Full detail modal (status change + note) ──
    openDetailModal(orderId) {
      $('#orderDetailModalBody').html('<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>');
      this.modal.show();

      Api.get(`/orders/${orderId}`)
        .done((res) => {
          $('#orderDetailModalBody').html(this.renderDetailContent(res.data.order));
        })
        .fail((jqXHR) => {
          $('#orderDetailModalBody').html(`<div class="alert alert-danger">${extractErrorMessage(jqXHR)}</div>`);
        });
    },

    renderDetailContent(order) {
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

      const timelineHtml = (order.statusHistory || [])
        .slice()
        .reverse()
        .map(
          (h) => `
        <div class="order-timeline-item">
          <div class="fw-semibold small text-capitalize">${esc(h.status)}</div>
          <div class="small text-muted">${formatDate(h.changedAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          ${h.note ? `<div class="small text-secondary mt-1">${esc(h.note)}</div>` : ''}
        </div>`
        )
        .join('');

      const isLocked = order.status === 'cancelled' || order.status === 'delivered';

      return `
        <div class="row g-4">
          <div class="col-md-7">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h6 class="mb-0">${esc(order.orderNumber)}</h6>
              <span class="badge order-status-badge status-${order.status}">${order.status}</span>
            </div>
            <p class="small text-muted">Placed ${formatDate(order.createdAt)} by ${esc(order.user ? order.user.name : '')} (${esc(order.user ? order.user.email : '')})</p>

            <h6 class="small text-uppercase text-muted mt-3 mb-2">Items</h6>
            <div class="order-detail-modal-items">${itemsHtml}</div>

            <hr/>
            <div class="d-flex justify-content-between small mb-1"><span class="text-muted">Subtotal</span><span>${formatCurrency(order.itemsPrice)}</span></div>
            ${order.discountAmount > 0 ? `<div class="d-flex justify-content-between small mb-1 text-success"><span>Discount (${esc(order.couponCode || '')})</span><span>-${formatCurrency(order.discountAmount)}</span></div>` : ''}
            <div class="d-flex justify-content-between small mb-1"><span class="text-muted">Shipping</span><span>${formatCurrency(order.shippingPrice)}</span></div>
            <div class="d-flex justify-content-between fw-bold mt-2"><span>Total</span><span>${formatCurrency(order.totalPrice)}</span></div>

            <h6 class="small text-uppercase text-muted mt-4 mb-2">Shipping Address</h6>
            <div class="small">
              ${esc(order.shippingAddress.fullName)}<br/>
              ${esc(order.shippingAddress.addressLine1)}${order.shippingAddress.addressLine2 ? ', ' + esc(order.shippingAddress.addressLine2) : ''}<br/>
              ${esc(order.shippingAddress.city)}, ${esc(order.shippingAddress.state)} ${esc(order.shippingAddress.postalCode)}<br/>
              ${esc(order.shippingAddress.country)} • <i class="bi bi-telephone me-1"></i>${esc(order.shippingAddress.phone)}
            </div>
            ${order.notes ? `<h6 class="small text-uppercase text-muted mt-4 mb-2">Customer Notes</h6><p class="small">${esc(order.notes)}</p>` : ''}
          </div>

          <div class="col-md-5">
            <h6 class="small text-uppercase text-muted mb-2">Update Status</h6>
            <form id="modalStatusForm" data-order-id="${order._id}">
              <select class="form-select form-select-sm mb-2" id="modalStatusSelect" ${isLocked ? 'disabled' : ''}>
                ${this.statusOptionsHtml(order.status)}
              </select>
              <textarea class="form-control form-control-sm mb-2" id="modalStatusNote" rows="2" placeholder="Optional note (e.g. tracking number, reason)..." maxlength="500" ${isLocked ? 'disabled' : ''}></textarea>
              <button type="submit" class="btn btn-primary btn-sm w-100" id="modalUpdateStatusBtn" ${isLocked ? 'disabled' : ''}>
                <i class="bi bi-check-lg me-1"></i> Update Status
              </button>
            </form>

            <h6 class="small text-uppercase text-muted mt-4 mb-2">Payment</h6>
            <select class="form-select form-select-sm" id="modalPaymentSelect" data-order-id="${order._id}">
              <option value="pending" ${order.paymentStatus === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="paid" ${order.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="failed" ${order.paymentStatus === 'failed' ? 'selected' : ''}>Failed</option>
            </select>

            <h6 class="small text-uppercase text-muted mt-4 mb-2">Order Timeline</h6>
            <div class="order-timeline">${timelineHtml || '<p class="small text-muted">No history</p>'}</div>
          </div>
        </div>
      `;
    },

    bindEvents() {
      const self = this;

      $('#ordersStatusTabs').on('click', 'button', function () {
        $('#ordersStatusTabs button').removeClass('active');
        $(this).addClass('active');
        self.state.status = $(this).data('status');
        self.state.page = 1;
        self.fetchOrders();
      });

      let searchTimer;
      $('#ordersSearchInput').on('input', function () {
        clearTimeout(searchTimer);
        const val = $(this).val();
        searchTimer = setTimeout(() => {
          self.state.search = val;
          self.state.page = 1;
          self.fetchOrders();
        }, 400);
      });

      $('#ordersPaymentFilter').on('change', function () {
        self.state.paymentStatus = $(this).val();
        self.state.page = 1;
        self.fetchOrders();
      });

      $('#ordersStartDate, #ordersEndDate').on('change', function () {
        self.state.startDate = $('#ordersStartDate').val();
        self.state.endDate = $('#ordersEndDate').val();
        self.state.page = 1;
        self.fetchOrders();
      });

      $('#ordersClearFiltersBtn').on('click', function () {
        self.state = { status: '', search: '', paymentStatus: '', startDate: '', endDate: '', page: 1, limit: self.state.limit };
        $('#ordersSearchInput').val('');
        $('#ordersPaymentFilter').val('');
        $('#ordersStartDate, #ordersEndDate').val('');
        $('#ordersStatusTabs button').removeClass('active');
        $('#ordersStatusTabs button[data-status=""]').addClass('active');
        self.fetchOrders();
      });

      $('#ordersLimitSelect').on('change', function () {
        self.state.limit = parseInt($(this).val(), 10);
        self.state.page = 1;
        self.fetchOrders();
      });

      $(document).on('click', '#ordersPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchOrders();
      });

      // ── Inline status dropdown ──
      $(document).on('change', '.status-select-inline', function () {
        self.quickChangeStatus($(this));
      });

      // ── Open detail modal ──
      $(document).on('click', '.view-order-btn', function () {
        self.openDetailModal($(this).data('id'));
      });

      // ── Modal: status update with note ──
      $(document).on('submit', '#modalStatusForm', function (e) {
        e.preventDefault();
        const orderId = $(this).data('order-id');
        const status = $('#modalStatusSelect').val();
        const note = $('#modalStatusNote').val().trim();
        const $btn = $('#modalUpdateStatusBtn');

        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

        Api.put(`/orders/${orderId}/status`, { status, note })
          .done((res) => {
            Toast.success('Order status updated successfully');
            const order = self.orders.find((o) => o._id === orderId);
            if (order) {
              order.status = status;
              order.paymentStatus = res.data.order.paymentStatus;
            }
            self.renderTable();
            self.openDetailModal(orderId); // refresh modal content with new timeline entry
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
          .always(() => $btn.prop('disabled', false).html('<i class="bi bi-check-lg me-1"></i> Update Status'));
      });

      // ── Modal: payment status change ──
      $(document).on('change', '#modalPaymentSelect', function () {
        const orderId = $(this).data('order-id');
        const paymentStatus = $(this).val();

        Api.put(`/orders/${orderId}/payment-status`, { paymentStatus })
          .done(() => {
            Toast.success('Payment status updated');
            const order = self.orders.find((o) => o._id === orderId);
            if (order) order.paymentStatus = paymentStatus;
            self.renderTable();
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
      });
    },

    bindSocketEvents() {
      if (!this.socket) return;

      this.socket.on('new-order', () => {
        Toast.info('New order received — refreshing list');
        this.fetchOrders();
      });

      this.socket.on('stock-update', () => {
        // No direct table impact, but harmless to ignore here — dashboard owns stock alerts
      });
    }
  };

  $(function () {
    OrdersPage.init();
  });
})(window, jQuery);