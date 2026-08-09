/* ═══════════════════════════════════════════════════════
   BookStore — Profile Page Logic
   Profile info, avatar upload, full address book CRUD,
   password change.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, ButtonState, TokenStore, extractErrorMessage, renderFieldErrors, formatDate, updateAuthUI } = window.BookStore;

  if (!$('#profileInfoForm').length) return; // not on the profile page

  if (!TokenStore.isLoggedIn()) {
    window.location.href = '/login?redirect=/profile';
  }

  let addressModal;

  const ProfilePage = {
    currentUser: null,

    init() {
      addressModal = new bootstrap.Modal(document.getElementById('addressModal'));
      this.fetchProfile();
      this.bindEvents();
    },

    fetchProfile() {
      Api.get('/auth/me')
        .done((res) => {
          this.currentUser = res.data.user;
          this.render(res.data.user);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    render(user) {
      // Sidebar
      $('#sidebarUserName').text(user.name);
      $('#sidebarUserEmail').text(user.email);
      if (user.avatar && user.avatar.url) {
        $('#profileAvatarImg').attr('src', user.avatar.url);
      }

      // Info form
      $('#infoName').val(user.name);
      $('#infoEmail').val(user.email);
      $('#infoPhone').val(user.phone || '');
      $('#infoJoined').val(formatDate(user.createdAt, { year: 'numeric', month: 'long', day: 'numeric' }));

      // Sync localStorage cache + navbar
      TokenStore.setUser({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      });
      updateAuthUI();

      // Addresses
      this.renderAddresses(user.addresses || []);
    },

    renderAddresses(addresses) {
      if (addresses.length === 0) {
        $('#addressBookList').empty();
        $('#noAddressesMsg').removeClass('d-none');
        return;
      }

      $('#noAddressesMsg').addClass('d-none');

      const html = addresses
        .map(
          (addr) => `
        <div class="col-md-6">
          <div class="address-book-card ${addr.isDefault ? 'is-default' : ''}">
            <div class="address-book-actions dropdown">
              <button class="btn btn-sm btn-link text-muted p-0" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item edit-address-btn" href="#" data-address-id="${addr._id}">Edit</a></li>
                ${!addr.isDefault ? `<li><a class="dropdown-item set-default-address-btn" href="#" data-address-id="${addr._id}">Set as Default</a></li>` : ''}
                <li><a class="dropdown-item text-danger delete-address-btn" href="#" data-address-id="${addr._id}">Delete</a></li>
              </ul>
            </div>
            ${addr.isDefault ? '<span class="badge bg-primary mb-2">Default</span>' : ''}
            <div class="fw-semibold small">${this.esc(addr.fullName)}</div>
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

      $('#addressBookList').html(html);
    },

    esc(str) {
      const div = document.createElement('div');
      div.textContent = str || '';
      return div.innerHTML;
    },

    findAddress(id) {
      return (this.currentUser.addresses || []).find((a) => a._id === id);
    },

    openAddressModal(address) {
      $('#addressForm')[0].reset();
      $('#addrCountry').val('Bangladesh');

      if (address) {
        $('#addressModalTitle').text('Edit Address');
        $('#addressEditId').val(address._id);
        $('#addrFullName').val(address.fullName);
        $('#addrPhone').val(address.phone);
        $('#addrLine1').val(address.addressLine1);
        $('#addrLine2').val(address.addressLine2 || '');
        $('#addrCity').val(address.city);
        $('#addrState').val(address.state);
        $('#addrPostalCode').val(address.postalCode);
        $('#addrCountry').val(address.country);
        $('#addrIsDefault').prop('checked', address.isDefault);
      } else {
        $('#addressModalTitle').text('Add Address');
        $('#addressEditId').val('');
      }

      addressModal.show();
    },

    bindEvents() {
      const self = this;

      // ── Profile Info Save ──
      $('#profileInfoForm').on('submit', function (e) {
        e.preventDefault();
        const $btn = $('#saveProfileBtn');
        const $form = $(this);

        ButtonState.loading($btn, ' Saving...');

        Api.put('/auth/profile', {
          name: $('#infoName').val().trim(),
          phone: $('#infoPhone').val().trim()
        })
          .done((res) => {
            Toast.success('Profile updated successfully');
            self.currentUser = res.data.user;
            self.render(res.data.user);
          })
          .fail((jqXHR) => {
            renderFieldErrors($form, jqXHR);
            Toast.error(extractErrorMessage(jqXHR));
          })
          .always(() => ButtonState.reset($btn));
      });

      // ── Avatar Upload ──
      $('#avatarUploadInput').on('change', function () {
        const file = this.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
          Toast.error('Image must be smaller than 2MB');
          return;
        }

        const formData = new FormData();
        formData.append('avatar', file);

        $('#profileAvatarImg').css('opacity', 0.5);

        Api.upload('/auth/profile', formData, 'PUT')
          .done((res) => {
            Toast.success('Profile photo updated');
            self.currentUser = res.data.user;
            self.render(res.data.user);
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
          .always(() => $('#profileAvatarImg').css('opacity', 1));
      });

      // ── Change Password ──
      $('#changePasswordForm').on('submit', function (e) {
        e.preventDefault();

        const newPassword = $('#newPassword').val();
        const confirmNewPassword = $('#confirmNewPassword').val();

        if (newPassword !== confirmNewPassword) {
          Toast.error('New passwords do not match');
          return;
        }

        const $btn = $('#changePasswordBtn');
        const $form = $(this);
        ButtonState.loading($btn, ' Updating...');

        Api.put('/auth/change-password', {
          currentPassword: $('#currentPassword').val(),
          newPassword
        })
          .done((res) => {
            Toast.success('Password updated successfully');
            TokenStore.setToken(res.data.token);
            $form[0].reset();
          })
          .fail((jqXHR) => {
            renderFieldErrors($form, jqXHR);
            Toast.error(extractErrorMessage(jqXHR));
          })
          .always(() => ButtonState.reset($btn));
      });

      // ── Address Book: Add ──
      $('#addNewAddressBtn').on('click', function () {
        self.openAddressModal(null);
      });

      // ── Address Book: Edit ──
      $(document).on('click', '.edit-address-btn', function (e) {
        e.preventDefault();
        const id = $(this).data('address-id');
        self.openAddressModal(self.findAddress(id));
      });

      // ── Address Book: Save (create or update) ──
      $('#saveAddressModalBtn').on('click', function () {
        const editId = $('#addressEditId').val();

        const payload = {
          fullName: $('#addrFullName').val().trim(),
          phone: $('#addrPhone').val().trim(),
          addressLine1: $('#addrLine1').val().trim(),
          addressLine2: $('#addrLine2').val().trim(),
          city: $('#addrCity').val().trim(),
          state: $('#addrState').val().trim(),
          postalCode: $('#addrPostalCode').val().trim(),
          country: $('#addrCountry').val().trim(),
          isDefault: $('#addrIsDefault').is(':checked')
        };

        if (!payload.fullName || !payload.phone || !payload.addressLine1 || !payload.city || !payload.state || !payload.postalCode) {
          Toast.warning('Please fill in all required fields');
          return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

        const request = editId
          ? Api.put(`/auth/address/${editId}`, payload)
          : Api.post('/auth/address', payload);

        request
          .done((res) => {
            Toast.success(editId ? 'Address updated successfully' : 'Address added successfully');
            self.currentUser.addresses = res.data.addresses;
            self.renderAddresses(res.data.addresses);
            addressModal.hide();
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
          .always(() => $btn.prop('disabled', false).text('Save Address'));
      });

      // ── Address Book: Set Default ──
      $(document).on('click', '.set-default-address-btn', function (e) {
        e.preventDefault();
        const id = $(this).data('address-id');
        const addr = self.findAddress(id);
        if (!addr) return;

        Api.put(`/auth/address/${id}`, { ...addr, isDefault: true })
          .done((res) => {
            Toast.success('Default address updated');
            self.currentUser.addresses = res.data.addresses;
            self.renderAddresses(res.data.addresses);
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
      });

      // ── Address Book: Delete ──
      $(document).on('click', '.delete-address-btn', function (e) {
        e.preventDefault();
        if (!confirm('Delete this address?')) return;

        const id = $(this).data('address-id');

        Api.delete(`/auth/address/${id}`)
          .done((res) => {
            Toast.success('Address deleted');
            self.currentUser.addresses = res.data.addresses;
            self.renderAddresses(res.data.addresses);
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
      });
    }
  };

  $(function () {
    ProfilePage.init();
  });
})(window, jQuery);