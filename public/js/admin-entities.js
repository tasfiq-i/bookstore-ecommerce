/* ═══════════════════════════════════════════════════════
   BookStore — Generic Admin Entity Table/Modal Engine
   Drives Categories, Authors, Publishers (Step 5 APIs).
   Config-driven: each page passes an options object to
   window.AdminEntities.init() — no per-entity JS files needed.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, extractErrorMessage, renderFieldErrors } = window.BookStore;
  const { esc } = window.AdminCore;

  const AdminEntities = {
    config: null,
    modal: null,
    state: { search: '', page: 1, limit: 25 },
    items: [],
    selectedImageFile: null,

    init(config) {
      this.config = config;
      this.modal = new bootstrap.Modal(document.getElementById('entityModal'));

      $('#entityModalTitle').text(`Add ${config.entityLabel}`);
      $('#saveEntityBtn').text(`Save ${config.entityLabel}`);

      this.fetchList();
      this.bindEvents();
    },

    // ── Fetch & Render Table ──
    fetchList() {
      const params = {
        page: this.state.page,
        limit: this.state.limit,
        includeInactive: 'true'
      };
      if (this.state.search) params.search = this.state.search;

      $('#entityTableBody').html(
        `<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`
      );

      Api.get(this.config.apiBase, params)
        .done((res) => {
          this.items = res.data[this.pluralDataKey()] || [];
          this.renderTable();
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#entityTableBody').html(`<tr><td colspan="6" class="text-center text-danger py-4">Failed to load data</td></tr>`);
        });
    },

    pluralDataKey() {
      // categories / authors / publishers — matches Step 5 controller response keys
      return this.config.apiBase.replace('/', '');
    },

    renderTable() {
      const cfg = this.config;

      if (this.items.length === 0) {
        $('#entityTableBody').html(
          `<tr><td colspan="6" class="text-center text-muted py-4">No ${cfg.entityLabelPlural.toLowerCase()} found</td></tr>`
        );
        return;
      }

      const html = this.items
        .map((item) => {
          const imgUrl = item[cfg.imageField] && item[cfg.imageField].url ? item[cfg.imageField].url : this.placeholderImg();
          const bookCount = item.bookCount || 0;

          let extraCol = '';
          if (cfg.columns.includes('slug')) extraCol = `<td class="text-muted small">${esc(item.slug)}</td>`;
          if (cfg.columns.includes('nationality')) extraCol = `<td>${esc(item.nationality || '—')}</td>`;
          if (cfg.columns.includes('establishedYear')) extraCol = `<td>${item.establishedYear || '—'}</td>`;

          return `
          <tr data-id="${item._id}">
            <td><img src="${imgUrl}" alt="${esc(item.name)}" class="table-thumb ${cfg.imageRound ? 'table-thumb-round' : ''}" /></td>
            <td class="fw-semibold">${esc(item.name)}</td>
            ${extraCol}
            <td><span class="badge bg-light text-dark border">${bookCount}</span></td>
            <td>
              <span class="badge ${item.isActive ? 'bg-success' : 'bg-secondary'}">${item.isActive ? 'Active' : 'Inactive'}</span>
            </td>
            <td class="text-end">
              <button class="action-icon-btn edit-entity-btn" data-id="${item._id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="action-icon-btn text-danger delete-entity-btn" data-id="${item._id}" title="Delete"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`;
        })
        .join('');

      $('#entityTableBody').html(html);
    },

    placeholderImg() {
      return this.config.imageRound ? '/images/placeholder-avatar.png' : '/images/placeholder-square.png';
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1, totalResults = 0 } = meta || {};
      $('#entityResultsInfo').text(`${totalResults} ${this.config.entityLabelPlural.toLowerCase()} found`);

      const $pagination = $('#entityPagination');
      if (totalPages <= 1) return $pagination.empty();

      let html = '';
      for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }
      $pagination.html(html);
    },

    // ── Modal Open (Add / Edit) ──
    openModal(item) {
      const cfg = this.config;
      $('#entityForm')[0].reset();
      this.selectedImageFile = null;
      $('#entityImagePreview').attr('src', this.placeholderImg());
      $('#entityIsActive').prop('checked', true);

      if (item) {
        $('#entityModalTitle').text(`Edit ${cfg.entityLabel}`);
        $('#entityEditId').val(item._id);
        $('#entityName').val(item.name);
        $('#entityIsActive').prop('checked', item.isActive);

        if (item.description !== undefined) $('#entityDescription').val(item.description || '');
        if (item.bio !== undefined) $('#entityBio').val(item.bio || '');
        if (item.nationality !== undefined) $('#entityNationality').val(item.nationality || '');
        if (item.birthDate) $('#entityBirthDate').val(item.birthDate.split('T')[0]);
        if (item.website !== undefined) $('#entityWebsite').val(item.website || '');
        if (item.establishedYear) $('#entityEstablishedYear').val(item.establishedYear);

        if (cfg.hasImage && item[cfg.imageField] && item[cfg.imageField].url) {
          $('#entityImagePreview').attr('src', item[cfg.imageField].url);
        }
      } else {
        $('#entityModalTitle').text(`Add ${cfg.entityLabel}`);
        $('#entityEditId').val('');
      }

      this.modal.show();
    },

    // ── Save (Create/Update) ──
    saveEntity() {
      const cfg = this.config;
      const editId = $('#entityEditId').val();
      const name = $('#entityName').val().trim();

      if (!name || name.length < 2) {
        Toast.warning('Name must be at least 2 characters');
        return;
      }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('isActive', $('#entityIsActive').is(':checked'));

      if ($('#entityDescription').length) formData.append('description', $('#entityDescription').val().trim());
      if ($('#entityBio').length) formData.append('bio', $('#entityBio').val().trim());
      if ($('#entityNationality').length) formData.append('nationality', $('#entityNationality').val().trim());
      if ($('#entityBirthDate').length && $('#entityBirthDate').val()) formData.append('birthDate', $('#entityBirthDate').val());
      if ($('#entityWebsite').length) formData.append('website', $('#entityWebsite').val().trim());
      if ($('#entityEstablishedYear').length && $('#entityEstablishedYear').val()) {
        formData.append('establishedYear', $('#entityEstablishedYear').val());
      }

      if (this.selectedImageFile) {
        formData.append(cfg.imageFormKey, this.selectedImageFile);
      }

      const $btn = $('#saveEntityBtn');
      $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

      const request = editId
        ? Api.upload(`${cfg.apiBase}/${editId}`, formData, 'PUT')
        : Api.upload(cfg.apiBase, formData, 'POST');

      request
        .done(() => {
          Toast.success(`${cfg.entityLabel} ${editId ? 'updated' : 'created'} successfully`);
          this.modal.hide();
          this.fetchList();
        })
        .fail((jqXHR) => {
          renderFieldErrors($('#entityForm'), jqXHR);
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => {
          $btn.prop('disabled', false).text(`Save ${cfg.entityLabel}`);
        });
    },

    deleteEntity(id) {
      const cfg = this.config;
      if (!confirm(`Delete this ${cfg.entityLabel.toLowerCase()}? This cannot be undone.`)) return;

      Api.delete(`${cfg.apiBase}/${id}`)
        .done(() => {
          Toast.success(`${cfg.entityLabel} deleted successfully`);
          this.fetchList();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    bindEvents() {
      const self = this;

      $('#addEntityBtn').on('click', () => self.openModal(null));
      $('#saveEntityBtn').on('click', () => self.saveEntity());

      $(document).on('click', '.edit-entity-btn', function () {
        const id = $(this).data('id');
        const item = self.items.find((i) => i._id === id);
        self.openModal(item);
      });

      $(document).on('click', '.delete-entity-btn', function () {
        self.deleteEntity($(this).data('id'));
      });

      $('#entityImageInput').on('change', function () {
        const file = this.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) {
          Toast.error('Image must be smaller than 3MB');
          return;
        }
        self.selectedImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => $('#entityImagePreview').attr('src', e.target.result);
        reader.readAsDataURL(file);
      });

      let searchTimer;
      $('#entitySearchInput').on('input', function () {
        clearTimeout(searchTimer);
        const val = $(this).val();
        searchTimer = setTimeout(() => {
          self.state.search = val;
          self.state.page = 1;
          self.fetchList();
        }, 400);
      });

      $('#entityLimitSelect').on('change', function () {
        self.state.limit = parseInt($(this).val(), 10);
        self.state.page = 1;
        self.fetchList();
      });

      $(document).on('click', '#entityPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchList();
      });
    }
  };

  window.AdminEntities = AdminEntities;
})(window, jQuery);