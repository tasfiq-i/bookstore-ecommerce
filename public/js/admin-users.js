/* ═══════════════════════════════════════════════════════
   BookStore — Admin Users Management
   Server-side pagination/search/filter, role promotion,
   activate/deactivate, delete (blocked if order history
   exists), and a details modal with lifetime spend stats.
   Wired to Step 9's /api/admin/users endpoints.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, TokenStore, extractErrorMessage, formatCurrency, formatDate } = window.BookStore;
  const { esc } = window.AdminCore;

  if (!$('#usersTableBody').length) return;

  const UsersPage = {
    state: { search: '', role: '', isActive: '', page: 1, limit: 20 },
    users: [],
    detailModal: null,
    roleModal: null,
    currentAdminId: null,

    init() {
      if (!window.AdminCore.guardAdminAccess()) return;
      window.AdminCore.initSidebarToggle();

      this.detailModal = new bootstrap.Modal(document.getElementById('userDetailModal'));
      this.roleModal = new bootstrap.Modal(document.getElementById('editRoleModal'));

      const me = TokenStore.getUser();
      this.currentAdminId = me ? me.id : null;

      this.fetchUsers();
      this.bindEvents();
    },

    fetchUsers() {
      const params = { page: this.state.page, limit: this.state.limit };
      if (this.state.search) params.search = this.state.search;
      if (this.state.role) params.role = this.state.role;
      if (this.state.isActive !== '') params.isActive = this.state.isActive;

      $('#usersTableBody').html(
        `<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`
      );

      Api.get('/admin/users', params)
        .done((res) => {
          this.users = res.data.users || [];
          this.renderTable();
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#usersTableBody').html(`<tr><td colspan="6" class="text-center text-danger py-4">Failed to load users</td></tr>`);
        });
    },

    renderTable() {
      if (this.users.length === 0) {
        $('#usersTableBody').html(`<tr><td colspan="6" class="text-center text-muted py-4">No users found</td></tr>`);
        return;
      }

      const html = this.users
        .map((user) => {
          const isSelf = user._id === this.currentAdminId;
          const avatarUrl = user.avatar && user.avatar.url ? user.avatar.url : '/images/default-avatar.png';
          const roleBadgeClass = user.role === 'admin' ? 'role-badge-admin' : 'role-badge-customer';
          const statusDotClass = user.isActive ? 'status-dot-active' : 'status-dot-inactive';

          return `
          <tr data-id="${user._id}">
            <td>
              <div class="d-flex align-items-center gap-2">
                <img src="${avatarUrl}" alt="${esc(user.name)}" class="user-avatar-cell" />
                <div>
                  <div class="fw-semibold small">${esc(user.name)}${isSelf ? ' <span class="self-account-note">(you)</span>' : ''}</div>
                  <div class="small text-muted">${user._id.slice(-8)}</div>
                </div>
              </div>
            </td>
            <td class="small">${esc(user.email)}</td>
            <td><span class="badge role-badge ${roleBadgeClass}">${user.role}</span></td>
            <td class="small">
              <span class="status-dot-cell ${statusDotClass}"></span>${user.isActive ? 'Active' : 'Inactive'}
            </td>
            <td class="small text-muted">${formatDate(user.createdAt)}</td>
            <td class="text-end">
              <button class="action-icon-btn view-user-btn" data-id="${user._id}" title="View Details"><i class="bi bi-eye"></i></button>
              <button class="action-icon-btn edit-role-btn" data-id="${user._id}" data-name="${esc(user.name)}" data-role="${user.role}" title="Edit Role" ${isSelf ? 'disabled' : ''}>
                <i class="bi bi-person-gear"></i>
              </button>
              <button class="action-icon-btn toggle-status-btn" data-id="${user._id}" data-active="${user.isActive}" title="${user.isActive ? 'Deactivate' : 'Activate'}" ${isSelf ? 'disabled' : ''}>
                <i class="bi bi-${user.isActive ? 'slash-circle' : 'check-circle'}"></i>
              </button>
              <button class="action-icon-btn text-danger delete-user-btn" data-id="${user._id}" data-name="${esc(user.name)}" title="Delete" ${isSelf ? 'disabled' : ''}>
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>`;
        })
        .join('');

      $('#usersTableBody').html(html);
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1, totalResults = 0 } = meta || {};
      $('#usersResultsInfo').text(`${totalResults} user(s) found`);

      const $pagination = $('#usersPagination');
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

    // ── View Details Modal ──
    openDetailModal(userId) {
      $('#userDetailModalBody').html('<div class="text-center py-5"><div class="spinner-border text-primary"></div></div>');
      this.detailModal.show();

      Api.get(`/admin/users/${userId}`)
        .done((res) => {
          $('#userDetailModalBody').html(this.renderDetailContent(res.data));
        })
        .fail((jqXHR) => {
          $('#userDetailModalBody').html(`<div class="alert alert-danger">${extractErrorMessage(jqXHR)}</div>`);
        });
    },

    renderDetailContent(data) {
      const { user, stats, recentOrders } = data;
      const avatarUrl = user.avatar && user.avatar.url ? user.avatar.url : '/images/default-avatar.png';
      const roleBadgeClass = user.role === 'admin' ? 'role-badge-admin' : 'role-badge-customer';

      const ordersHtml =
        recentOrders.length === 0
          ? '<p class="small text-muted text-center py-3">No orders yet</p>'
          : recentOrders
              .map(
                (o) => `
            <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
              <div>
                <div class="small fw-semibold">${esc(o.orderNumber)}</div>
                <div class="small text-muted">${formatDate(o.createdAt)}</div>
              </div>
              <div class="text-end">
                <div class="small fw-semibold">${formatCurrency(o.totalPrice)}</div>
                <span class="badge order-status-badge status-${o.status}">${o.status}</span>
              </div>
            </div>`
              )
              .join('');

      return `
        <div class="d-flex align-items-center gap-3 mb-4">
          <img src="${avatarUrl}" alt="${esc(user.name)}" class="rounded-circle" style="width:64px;height:64px;object-fit:cover;" />
          <div>
            <h6 class="mb-1">${esc(user.name)} <span class="badge role-badge ${roleBadgeClass}">${user.role}</span></h6>
            <div class="small text-muted">${esc(user.email)}</div>
            ${user.phone ? `<div class="small text-muted"><i class="bi bi-telephone me-1"></i>${esc(user.phone)}</div>` : ''}
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-4">
            <div class="user-detail-stat">
              <div class="value">${stats.totalOrders}</div>
              <div class="label">Total Orders</div>
            </div>
          </div>
          <div class="col-4">
            <div class="user-detail-stat">
              <div class="value">${formatCurrency(stats.totalSpent)}</div>
              <div class="label">Total Spent</div>
            </div>
          </div>
          <div class="col-4">
            <div class="user-detail-stat">
              <div class="value">${formatDate(user.createdAt)}</div>
              <div class="label">Member Since</div>
            </div>
          </div>
        </div>

        <h6 class="small text-uppercase text-muted mb-2">Recent Orders</h6>
        ${ordersHtml}

        <h6 class="small text-uppercase text-muted mt-4 mb-2">Saved Addresses</h6>
        ${
          (user.addresses || []).length === 0
            ? '<p class="small text-muted">No saved addresses</p>'
            : user.addresses
                .map(
                  (a) => `
              <div class="small mb-2 pb-2 border-bottom">
                ${esc(a.fullName)}${a.isDefault ? ' <span class="badge bg-primary bg-opacity-10 text-primary">Default</span>' : ''}<br/>
                <span class="text-muted">${esc(a.addressLine1)}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.postalCode)}</span>
              </div>`
                )
                .join('')
        }
      `;
    },

    // ── Edit Role ──
    openRoleModal(userId, name, currentRole) {
      $('#editRoleUserId').val(userId);
      $('#editRoleUserName').text(name);
      $('#editRoleSelect').val(currentRole);
      $('#editRoleWarning').toggleClass('d-none', currentRole === 'admin');
      this.roleModal.show();
    },

    saveRoleChange() {
      const userId = $('#editRoleUserId').val();
      const role = $('#editRoleSelect').val();
      const $btn = $('#confirmRoleChangeBtn');

      $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

      Api.put(`/admin/users/${userId}/role`, { role })
        .done((res) => {
          Toast.success(res.message);
          const user = this.users.find((u) => u._id === userId);
          if (user) user.role = role;
          this.renderTable();
          this.roleModal.hide();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
        .always(() => $btn.prop('disabled', false).text('Save Role'));
    },

    // ── Toggle Active/Inactive ──
    toggleStatus(userId, currentlyActive) {
      const action = currentlyActive ? 'deactivate' : 'activate';
      if (!confirm(`Are you sure you want to ${action} this user's account?`)) return;

      Api.put(`/admin/users/${userId}/status`, { isActive: !currentlyActive })
        .done((res) => {
          Toast.success(res.message);
          const user = this.users.find((u) => u._id === userId);
          if (user) user.isActive = !currentlyActive;
          this.renderTable();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    // ── Delete ──
    deleteUser(userId, name) {
      if (!confirm(`Permanently delete "${name}"? This cannot be undone. Users with order history cannot be deleted — deactivate instead.`)) return;

      Api.delete(`/admin/users/${userId}`)
        .done(() => {
          Toast.success('User deleted successfully');
          this.fetchUsers();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    bindEvents() {
      const self = this;

      let searchTimer;
      $('#usersSearchInput').on('input', function () {
        clearTimeout(searchTimer);
        const val = $(this).val();
        searchTimer = setTimeout(() => {
          self.state.search = val;
          self.state.page = 1;
          self.fetchUsers();
        }, 400);
      });

      $('#usersRoleFilter').on('change', function () {
        self.state.role = $(this).val();
        self.state.page = 1;
        self.fetchUsers();
      });

      $('#usersStatusFilter').on('change', function () {
        self.state.isActive = $(this).val();
        self.state.page = 1;
        self.fetchUsers();
      });

      $('#usersLimitSelect').on('change', function () {
        self.state.limit = parseInt($(this).val(), 10);
        self.state.page = 1;
        self.fetchUsers();
      });

      $(document).on('click', '#usersPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchUsers();
      });

      $(document).on('click', '.view-user-btn', function () {
        self.openDetailModal($(this).data('id'));
      });

      $(document).on('click', '.edit-role-btn:not(:disabled)', function () {
        self.openRoleModal($(this).data('id'), $(this).data('name'), $(this).data('role'));
      });

      $('#editRoleSelect').on('change', function () {
        $('#editRoleWarning').toggleClass('d-none', $(this).val() === 'customer');
      });

      $('#confirmRoleChangeBtn').on('click', () => self.saveRoleChange());

      $(document).on('click', '.toggle-status-btn:not(:disabled)', function () {
        self.toggleStatus($(this).data('id'), $(this).data('active') === true || $(this).data('active') === 'true');
      });

      $(document).on('click', '.delete-user-btn:not(:disabled)', function () {
        self.deleteUser($(this).data('id'), $(this).data('name'));
      });
    }
  };

  $(function () {
    UsersPage.init();
  });
})(window, jQuery);