/* ═══════════════════════════════════════════════════════
   BookStore — Admin Coupons Management
   Full CRUD, auto-generate code toggle, usage stats modal,
   server-side pagination/filter.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, extractErrorMessage, renderFieldErrors, formatCurrency, formatDate } = window.BookStore;
  const { esc } = window.AdminCore;

  if (!$('#couponsTableBody').length) return;

  const CouponsPage = {
    state: { search: '', status: '', page: 1, limit: 25 },
    coupons: [],
    modal: null,
    statsModal: null,

    init() {
      if (!window.AdminCore.guardAdminAccess()) return;
      window.AdminCore.initSidebarToggle();

      this.modal = new bootstrap.Modal(document.getElementById('couponModal'));
      this.statsModal = new bootstrap.Modal(document.getElementById('couponStatsModal'));

      this.fetchCoupons();
      this.bindEvents();
    },

    fetchCoupons() {
      const params = { page: this.state.page, limit: this.state.limit };
      if (this.state.search) params.search = this.state.search;
      if (this.state.status) params.status = this.state.status;

      $('#couponsTableBody').html(
        `<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`
      );

      Api.get('/coupons', params)
        .done((res) => {
          this.coupons = res.data.coupons || [];
          this.renderTable();
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#couponsTableBody').html(`<tr><td colspan="7" class="text-center text-danger py-4">Failed to load coupons</td></tr>`);
        });
    },

    renderTable() {
      if (this.coupons.length === 0) {
        $('#couponsTableBody').html(`<tr><td colspan="7" class="text-center text-muted py-4">No coupons found</td></tr>`);
        return;
      }

      const statusPillMap = {
        live: 'coupon-status-live',
        disabled: 'coupon-status-disabled',
        expired: 'coupon-status-expired',
        exhausted: 'coupon-status-exhausted'
      };

      const html = this.coupons
        .map((c) => {
          const discountText = c.discountType === 'percentage' ? `${c.discountValue}%` : formatCurrency(c.discountValue);
          const usageText = c.usageLimit ? `${c.usedCount} / ${c.usageLimit}` : `${c.usedCount} / ∞`;
          const statusClass = statusPillMap[c.computedStatus] || 'coupon-status-disabled';

          return `
          <tr data-id="${c._id}">
            <td><span class="coupon-code-display">${esc(c.code)}</span></td>
            <td class="small fw-semibold">${discountText} ${c.maxDiscountAmount ? `<span class="text-muted">(cap ${formatCurrency(c.maxDiscountAmount)})</span>` : ''}</td>
            <td class="small">${c.minPurchaseAmount > 0 ? formatCurrency(c.minPurchaseAmount) : '—'}</td>
            <td class="small">${usageText}</td>
            <td class="small">${formatDate(c.expiryDate)}</td>
            <td><span class="badge coupon-status-pill ${statusClass} text-capitalize">${c.computedStatus}</span></td>
            <td class="text-end">
              <button class="action-icon-btn stats-coupon-btn" data-id="${c._id}" title="Usage Stats"><i class="bi bi-graph-up"></i></button>
              <button class="action-icon-btn toggle-coupon-btn" data-id="${c._id}" title="${c.isActive ? 'Deactivate' : 'Activate'}">
                <i class="bi bi-${c.isActive ? 'toggle-on text-success' : 'toggle-off'}"></i>
              </button>
              <button class="action-icon-btn edit-coupon-btn" data-id="${c._id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="action-icon-btn text-danger delete-coupon-btn" data-id="${c._id}" title="Delete"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`;
        })
        .join('');

      $('#couponsTableBody').html(html);
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1, totalResults = 0 } = meta || {};
      $('#couponsResultsInfo').text(`${totalResults} coupon(s) found`);

      const $pagination = $('#couponsPagination');
      if (totalPages <= 1) return $pagination.empty();

      let html = '';
      for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }
      $pagination.html(html);
    },

    toggleMaxDiscountVisibility() {
      const type = $('#couponDiscountType').val();
      $('#maxDiscountWrap').toggleClass('d-none', type !== 'percentage');
    },

    generateCode() {
      const prefix = $('#couponPrefix').val().trim();
      const $btn = $('#regenerateCodeBtn');
      $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

      Api.post('/coupons/generate-code', prefix ? { prefix } : {})
        .done((res) => {
          $('#couponCode').val(res.data.code);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
        .always(() => $btn.prop('disabled', false).html('<i class="bi bi-shuffle me-1"></i> Generate'));
    },

    openModal(coupon) {
      $('#couponForm')[0].reset();
      $('#couponMinPurchase').val(0);
      $('#couponDiscountType').val('percentage');
      this.toggleMaxDiscountVisibility();

      if (coupon) {
        $('#couponModalTitle').text('Edit Coupon');
        $('#couponEditId').val(coupon._id);
        $('#autoGenerateRow').addClass('d-none'); // can't re-auto-generate on edit
        $('#couponCode').val(coupon.code).prop('disabled', coupon.usedCount > 0);
        $('#couponPrefix').closest('div').addClass('d-none');
        $('#couponDescription').val(coupon.description || '');
        $('#couponDiscountType').val(coupon.discountType);
        $('#couponDiscountValue').val(coupon.discountValue);
        $('#couponMinPurchase').val(coupon.minPurchaseAmount || 0);
        $('#couponMaxDiscount').val(coupon.maxDiscountAmount || '');
        $('#couponUsageLimit').val(coupon.usageLimit || '');
        $('#couponExpiryDate').val(coupon.expiryDate.split('T')[0]);
        $('#couponIsActive').prop('checked', coupon.isActive);
        $('#couponActiveRow').removeClass('d-none');
        this.toggleMaxDiscountVisibility();

        if (coupon.usedCount > 0) {
          $('#couponCode').after(
            `<div class="form-text text-warning" id="usedCouponNotice"><i class="bi bi-info-circle me-1"></i>Code locked — this coupon has been used ${coupon.usedCount} time(s).</div>`
          );
        }
      } else {
        $('#couponModalTitle').text('Create Coupon');
        $('#couponEditId').val('');
        $('#autoGenerateRow').removeClass('d-none');
        $('#couponPrefix').closest('div').removeClass('d-none');
        $('#couponCode').val('').prop('disabled', true);
        $('#couponAutoGenerate').prop('checked', true);
        $('#couponActiveRow').addClass('d-none'); // new coupons are active by default, no need to show toggle
      }

      $('#usedCouponNotice').remove();
      this.modal.show();
    },

    saveCoupon() {
      const editId = $('#couponEditId').val();
      const autoGenerate = !editId && $('#couponAutoGenerate').is(':checked');

      const payload = {
        description: $('#couponDescription').val().trim(),
        discountType: $('#couponDiscountType').val(),
        discountValue: parseFloat($('#couponDiscountValue').val()),
        minPurchaseAmount: parseFloat($('#couponMinPurchase').val()) || 0,
        expiryDate: $('#couponExpiryDate').val()
      };

      if (!payload.discountValue || payload.discountValue <= 0) {
        Toast.warning('Please enter a valid discount value');
        return;
      }
      if (!payload.expiryDate) {
        Toast.warning('Please select an expiry date');
        return;
      }

      if ($('#couponMaxDiscount').val()) payload.maxDiscountAmount = parseFloat($('#couponMaxDiscount').val());
      if ($('#couponUsageLimit').val()) payload.usageLimit = parseInt($('#couponUsageLimit').val(), 10);

      if (editId) {
        payload.isActive = $('#couponIsActive').is(':checked');
        const codeVal = $('#couponCode').val().trim();
        if (!$('#couponCode').prop('disabled') && codeVal) {
          payload.code = codeVal;
        }
      } else if (autoGenerate) {
        payload.autoGenerate = true;
        const prefix = $('#couponPrefix').val().trim();
        if (prefix) payload.prefix = prefix;
      } else {
        const codeVal = $('#couponCode').val().trim();
        if (!codeVal) {
          Toast.warning('Please enter a coupon code or enable auto-generate');
          return;
        }
        payload.code = codeVal;
      }

      const $btn = $('#saveCouponBtn');
      $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

      const request = editId ? Api.put(`/coupons/${editId}`, payload) : Api.post('/coupons', payload);

      request
        .done((res) => {
          Toast.success(`Coupon "${res.data.coupon.code}" ${editId ? 'updated' : 'created'} successfully`);
          this.modal.hide();
          this.fetchCoupons();
        })
        .fail((jqXHR) => {
          renderFieldErrors($('#couponForm'), jqXHR);
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => $btn.prop('disabled', false).text('Save Coupon'));
    },

    toggleStatus(id) {
      Api.patch(`/coupons/${id}/toggle`)
        .done((res) => {
          Toast.success(res.message);
          this.fetchCoupons();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    deleteCoupon(id) {
      if (!confirm('Delete this coupon? This cannot be undone.')) return;

      Api.delete(`/coupons/${id}`)
        .done(() => {
          Toast.success('Coupon deleted successfully');
          this.fetchCoupons();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    openStatsModal(id) {
      $('#couponStatsModalBody').html('<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>');
      this.statsModal.show();

      Api.get(`/coupons/${id}/stats`)
        .done((res) => {
          const { coupon, usageCount, totalDiscountGiven, orders } = res.data;

          const ordersHtml =
            orders.length === 0
              ? '<p class="small text-muted text-center py-3">No orders have used this coupon yet</p>'
              : orders
                  .map(
                    (o) => `
              <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                  <div class="small fw-semibold">${esc(o.orderNumber)}</div>
                  <div class="small text-muted">${esc(o.user ? o.user.name : '')} • ${formatDate(o.createdAt)}</div>
                </div>
                <div class="text-end">
                  <div class="small fw-semibold">${formatCurrency(o.totalPrice)}</div>
                  <div class="small text-success">-${formatCurrency(o.discountAmount)}</div>
                </div>
              </div>`
                  )
                  .join('');

          $('#couponStatsModalBody').html(`
            <div class="d-flex justify-content-between align-items-center mb-3">
              <span class="coupon-code-display">${esc(coupon.code)}</span>
              <div class="text-end">
                <div class="fw-bold">${usageCount} uses</div>
                <div class="small text-success">${formatCurrency(totalDiscountGiven)} total discount given</div>
              </div>
            </div>
            <hr/>
            ${ordersHtml}
          `);
        })
        .fail((jqXHR) => {
          $('#couponStatsModalBody').html(`<div class="alert alert-danger">${extractErrorMessage(jqXHR)}</div>`);
        });
    },

    bindEvents() {
      const self = this;

      $('#addCouponBtn').on('click', () => self.openModal(null));
      $('#saveCouponBtn').on('click', () => self.saveCoupon());
      $('#regenerateCodeBtn').on('click', () => self.generateCode());
      $('#couponDiscountType').on('change', () => self.toggleMaxDiscountVisibility());

      $('#couponAutoGenerate').on('change', function () {
        const isAuto = $(this).is(':checked');
        $('#couponCode').prop('disabled', isAuto).val(isAuto ? '' : $('#couponCode').val());
        if (isAuto) self.generateCode();
      });

      $(document).on('click', '.edit-coupon-btn', function () {
        const coupon = self.coupons.find((c) => c._id === $(this).data('id'));
        if (coupon) self.openModal(coupon);
      });

      $(document).on('click', '.delete-coupon-btn', function () {
        self.deleteCoupon($(this).data('id'));
      });

      $(document).on('click', '.toggle-coupon-btn', function () {
        self.toggleStatus($(this).data('id'));
      });

      $(document).on('click', '.stats-coupon-btn', function () {
        self.openStatsModal($(this).data('id'));
      });

      let searchTimer;
      $('#couponsSearchInput').on('input', function () {
        clearTimeout(searchTimer);
        const val = $(this).val();
        searchTimer = setTimeout(() => {
          self.state.search = val;
          self.state.page = 1;
          self.fetchCoupons();
        }, 400);
      });

      $('#couponsStatusFilter').on('change', function () {
        self.state.status = $(this).val();
        self.state.page = 1;
        self.fetchCoupons();
      });

      $('#couponsLimitSelect').on('change', function () {
        self.state.limit = parseInt($(this).val(), 10);
        self.state.page = 1;
        self.fetchCoupons();
      });

      $(document).on('click', '#couponsPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchCoupons();
      });
    }
  };

  $(function () {
    CouponsPage.init();
  });
})(window, jQuery);