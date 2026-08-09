/* ═══════════════════════════════════════════════════════
   BookStore — Admin Books Management
   Multi-image upload, referenced-entity dropdowns, inline
   stock quick-edit, server-side pagination/filter/search.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, extractErrorMessage, renderFieldErrors, formatCurrency } = window.BookStore;
  const { esc } = window.AdminCore;

  if (!$('#booksTableBody').length) return;

  const BooksPage = {
    state: { search: '', category: '', stockFilter: '', page: 1, limit: 25 },
    books: [],
    categories: [],
    authors: [],
    publishers: [],
    existingImages: [], // { url, publicId } — images already saved on the book being edited
    removedImageIds: [], // publicIds marked for removal on save
    newImageFiles: [], // File objects queued for upload
    modal: null,

    init() {
      if (!window.AdminCore.guardAdminAccess()) return;
      window.AdminCore.initSidebarToggle();

      this.modal = new bootstrap.Modal(document.getElementById('bookModal'));

      this.loadFilterMeta();
      this.fetchBooks();
      this.bindEvents();
    },

    loadFilterMeta() {
      Api.get('/books/filters/meta')
        .done((res) => {
          this.categories = res.data.categories || [];
          this.authors = res.data.authors || [];
          this.publishers = res.data.publishers || [];

          $('#booksCategoryFilter').append(
            this.categories.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')
          );
          $('#bookCategorySelect').html(
            this.categories.map((c) => `<option value="${c._id}">${esc(c.name)}</option>`).join('')
          );
          $('#bookAuthorSelect').html(
            this.authors.map((a) => `<option value="${a._id}">${esc(a.name)}</option>`).join('')
          );
          $('#bookPublisherSelect').html(
            this.publishers.map((p) => `<option value="${p._id}">${esc(p.name)}</option>`).join('')
          );
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    fetchBooks() {
      const params = {
        page: this.state.page,
        limit: this.state.limit,
        sort: 'newest'
      };
      if (this.state.search) params.search = this.state.search;
      if (this.state.category) params.category = this.state.category;
      if (this.state.stockFilter === 'in-stock') params.inStock = 'true';

      $('#booksTableBody').html(
        `<tr><td colspan="8" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>`
      );

      Api.get('/books', params)
        .done((res) => {
          let books = res.data.books || [];

          // Low/out-of-stock filters applied client-side on the current page
          // since /api/books doesn't have a dedicated "low-stock" query param —
          // for a dedicated cross-catalog low-stock view, admins use the Dashboard's
          // low-stock panel (Step 15) which queries the true /admin/inventory/low-stock endpoint.
          if (this.state.stockFilter === 'low-stock') {
            books = books.filter((b) => b.stock > 0 && b.stock <= (b.lowStockThreshold || 5));
          } else if (this.state.stockFilter === 'out-of-stock') {
            books = books.filter((b) => b.stock <= 0);
          }

          this.books = books;
          this.renderTable();
          this.renderPagination(res.meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          $('#booksTableBody').html(`<tr><td colspan="8" class="text-center text-danger py-4">Failed to load books</td></tr>`);
        });
    },

    renderTable() {
      if (this.books.length === 0) {
        $('#booksTableBody').html(`<tr><td colspan="8" class="text-center text-muted py-4">No books found</td></tr>`);
        return;
      }

      const html = this.books
        .map((book) => {
          const img = book.images && book.images.length ? book.images[0].url : '/images/book-placeholder.png';
          const effectivePrice = book.discountPrice != null ? book.discountPrice : book.price;

          let stockBadgeClass = 'bg-success';
          if (book.stock <= 0) stockBadgeClass = 'bg-danger';
          else if (book.stock <= (book.lowStockThreshold || 5)) stockBadgeClass = 'bg-warning text-dark';

          return `
          <tr data-id="${book._id}">
            <td>
              <div class="d-flex align-items-center gap-2">
                <img src="${img}" alt="${esc(book.title)}" class="table-thumb" />
                <div>
                  <div class="fw-semibold text-truncate" style="max-width: 200px;">${esc(book.title)}</div>
                  <div class="small text-muted">${esc(book.isbn)}</div>
                </div>
              </div>
            </td>
            <td class="small">${book.category ? esc(book.category.name) : '—'}</td>
            <td class="small">${book.author ? esc(book.author.name) : '—'}</td>
            <td class="small">
              ${formatCurrency(effectivePrice)}
              ${book.discountPrice != null ? `<br/><span class="text-muted text-decoration-line-through" style="font-size: 0.75rem;">${formatCurrency(book.price)}</span>` : ''}
            </td>
            <td>
              <div class="stock-quick-edit">
                <span class="badge ${stockBadgeClass}">${book.stock}</span>
                <input type="number" min="0" class="stock-edit-input d-none" data-id="${book._id}" value="${book.stock}" />
                <button class="btn btn-sm btn-link p-0 edit-stock-btn" data-id="${book._id}" title="Quick edit stock"><i class="bi bi-pencil-square"></i></button>
              </div>
            </td>
            <td class="small"><i class="bi bi-star-fill text-warning"></i> ${book.ratings ? book.ratings.average.toFixed(1) : '0.0'} <span class="text-muted">(${book.ratings ? book.ratings.count : 0})</span></td>
            <td><span class="badge ${book.isActive ? 'bg-success' : 'bg-secondary'}">${book.isActive ? 'Active' : 'Inactive'}</span></td>
            <td class="text-end">
              <button class="action-icon-btn edit-book-btn" data-id="${book._id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="action-icon-btn text-danger delete-book-btn" data-id="${book._id}" title="Delete"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`;
        })
        .join('');

      $('#booksTableBody').html(html);
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1, totalResults = 0 } = meta || {};
      $('#booksResultsInfo').text(`${totalResults} book(s) found`);

      const $pagination = $('#booksPagination');
      if (totalPages <= 1) return $pagination.empty();

      let html = '';
      for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }
      $pagination.html(html);
    },

    // ── Inline Stock Quick-Edit ──
    saveStockQuickEdit(bookId, newStock) {
      Api.patch(`/books/${bookId}/stock`, { stock: newStock, operation: 'set' })
        .done((res) => {
          Toast.success('Stock updated successfully');
          const book = this.books.find((b) => b._id === bookId);
          if (book) book.stock = res.data.stock;
          this.renderTable();
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
          this.renderTable(); // revert visual state
        });
    },

    // ── Modal: Open Add/Edit ──
    openModal(book) {
      $('#bookForm')[0].reset();
      this.existingImages = [];
      this.removedImageIds = [];
      this.newImageFiles = [];
      $('#existingImagesGrid, #newImagesPreviewGrid').empty();
      $('#bookIsActive').prop('checked', true);
      $('#bookLowStockThreshold').val(5);
      $('#bookLanguage').val('English');

      if (book) {
        $('#bookModalTitle').text('Edit Book');
        $('#bookEditId').val(book._id);
        $('#bookTitle').val(book.title);
        $('#bookIsbn').val(book.isbn);
        $('#bookCategorySelect').val(book.category._id || book.category);
        $('#bookAuthorSelect').val(book.author._id || book.author);
        $('#bookPublisherSelect').val(book.publisher._id || book.publisher);
        $('#bookPrice').val(book.price);
        $('#bookDiscountPrice').val(book.discountPrice != null ? book.discountPrice : '');
        $('#bookStock').val(book.stock);
        $('#bookLowStockThreshold').val(book.lowStockThreshold || 5);
        $('#bookFormat').val(book.format);
        $('#bookLanguage').val(book.language);
        $('#bookPages').val(book.pages || '');
        $('#bookDescription').val(book.description);
        $('#bookTags').val((book.tags || []).join(', '));
        $('#bookIsFeatured').prop('checked', book.isFeatured);
        $('#bookIsActive').prop('checked', book.isActive);

        this.existingImages = book.images || [];
        this.renderExistingImages();
      } else {
        $('#bookModalTitle').text('Add Book');
        $('#bookEditId').val('');
      }

      this.renderNewImagePreviews();
      this.modal.show();
    },

    renderExistingImages() {
      const html = this.existingImages
        .map(
          (img) => `
        <div class="image-upload-preview-item" data-public-id="${img.publicId}">
          <img src="${img.url}" alt="Book image" />
          <span class="remove-preview-btn remove-existing-img" data-public-id="${img.publicId}"><i class="bi bi-x"></i></span>
        </div>`
        )
        .join('');
      $('#existingImagesGrid').html(html);
    },

    renderNewImagePreviews() {
      const html = this.newImageFiles
        .map(
          (file, index) => `
        <div class="image-upload-preview-item" data-index="${index}">
          <img src="${URL.createObjectURL(file)}" alt="New image" />
          <span class="remove-preview-btn remove-new-img" data-index="${index}"><i class="bi bi-x"></i></span>
        </div>`
        )
        .join('');
      $('#newImagesPreviewGrid').html(html);
    },

    handleNewFiles(fileList) {
      const totalCount = this.existingImages.length - this.removedImageIds.length + this.newImageFiles.length + fileList.length;
      if (totalCount > 5) {
        Toast.warning('Maximum 5 images allowed per book');
        return;
      }

      Array.from(fileList).forEach((file) => {
        if (file.size > 5 * 1024 * 1024) {
          Toast.warning(`"${file.name}" exceeds 5MB and was skipped`);
          return;
        }
        this.newImageFiles.push(file);
      });

      this.renderNewImagePreviews();
    },

    // ── Save Book (Create/Update) ──
    saveBook() {
      const editId = $('#bookEditId').val();

      const title = $('#bookTitle').val().trim();
      const isbn = $('#bookIsbn').val().trim();
      const description = $('#bookDescription').val().trim();

      if (!title || !isbn || !description) {
        Toast.warning('Please fill in all required fields');
        return;
      }

      const totalImagesAfterSave = this.existingImages.length - this.removedImageIds.length + this.newImageFiles.length;
      if (totalImagesAfterSave === 0) {
        Toast.warning('At least one book image is required');
        return;
      }

      const formData = new FormData();
      formData.append('title', title);
      formData.append('isbn', isbn);
      formData.append('description', description);
      formData.append('category', $('#bookCategorySelect').val());
      formData.append('author', $('#bookAuthorSelect').val());
      formData.append('publisher', $('#bookPublisherSelect').val());
      formData.append('price', $('#bookPrice').val());
      if ($('#bookDiscountPrice').val()) formData.append('discountPrice', $('#bookDiscountPrice').val());
      formData.append('stock', $('#bookStock').val());
      formData.append('lowStockThreshold', $('#bookLowStockThreshold').val() || 5);
      formData.append('format', $('#bookFormat').val());
      formData.append('language', $('#bookLanguage').val().trim() || 'English');
      if ($('#bookPages').val()) formData.append('pages', $('#bookPages').val());
      formData.append('tags', $('#bookTags').val().trim());
      formData.append('isFeatured', $('#bookIsFeatured').is(':checked'));
      formData.append('isActive', $('#bookIsActive').is(':checked'));

      if (editId && this.removedImageIds.length > 0) {
        formData.append('removeImageIds', this.removedImageIds.join(','));
      }

      this.newImageFiles.forEach((file) => formData.append('images', file));

      const $btn = $('#saveBookBtn');
      $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

      const request = editId
        ? Api.upload(`/books/${editId}`, formData, 'PUT')
        : Api.upload('/books', formData, 'POST');

      request
        .done(() => {
          Toast.success(`Book ${editId ? 'updated' : 'created'} successfully`);
          this.modal.hide();
          this.fetchBooks();
        })
        .fail((jqXHR) => {
          renderFieldErrors($('#bookForm'), jqXHR);
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => {
          $btn.prop('disabled', false).text('Save Book');
        });
    },

    deleteBook(id) {
      if (!confirm('Delete this book permanently? This cannot be undone.')) return;

      Api.delete(`/books/${id}`)
        .done(() => {
          Toast.success('Book deleted successfully');
          this.fetchBooks();
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    bindEvents() {
      const self = this;

      $('#addBookBtn').on('click', () => self.openModal(null));
      $('#saveBookBtn').on('click', () => self.saveBook());

      $(document).on('click', '.edit-book-btn', function () {
        const book = self.books.find((b) => b._id === $(this).data('id'));
        if (book) self.openModal(book);
      });

      $(document).on('click', '.delete-book-btn', function () {
        self.deleteBook($(this).data('id'));
      });

      // ── Inline stock quick-edit ──
      $(document).on('click', '.edit-stock-btn', function () {
        const $row = $(this).closest('tr');
        $row.find('.stock-quick-edit .badge').addClass('d-none');
        $row.find('.stock-edit-input').removeClass('d-none').focus().select();
      });

      $(document).on('keypress', '.stock-edit-input', function (e) {
        if (e.which === 13) {
          e.preventDefault();
          $(this).trigger('blur');
        }
      });

      $(document).on('blur', '.stock-edit-input', function () {
        const bookId = $(this).data('id');
        const newStock = parseInt($(this).val(), 10);
        const book = self.books.find((b) => b._id === bookId);

        if (!isNaN(newStock) && newStock >= 0 && book && newStock !== book.stock) {
          self.saveStockQuickEdit(bookId, newStock);
        } else {
          self.renderTable(); // no change or invalid — just revert display
        }
      });

      // ── Image dropzone ──
      $('#imageDropzone').on('click', () => $('#bookImagesInput').click());
      $('#bookImagesInput').on('change', function () {
        self.handleNewFiles(this.files);
        $(this).val('');
      });

      $('#imageDropzone').on('dragover', function (e) {
        e.preventDefault();
        $(this).addClass('dragover');
      });
      $('#imageDropzone').on('dragleave', function () {
        $(this).removeClass('dragover');
      });
      $('#imageDropzone').on('drop', function (e) {
        e.preventDefault();
        $(this).removeClass('dragover');
        if (e.originalEvent.dataTransfer.files.length) {
          self.handleNewFiles(e.originalEvent.dataTransfer.files);
        }
      });

      $(document).on('click', '.remove-existing-img', function () {
        const publicId = $(this).data('public-id');
        self.removedImageIds.push(publicId);
        self.existingImages = self.existingImages.filter((img) => img.publicId !== publicId);
        self.renderExistingImages();
      });

      $(document).on('click', '.remove-new-img', function () {
        const index = parseInt($(this).data('index'), 10);
        self.newImageFiles.splice(index, 1);
        self.renderNewImagePreviews();
      });

      // ── Filters ──
      let searchTimer;
      $('#booksSearchInput').on('input', function () {
        clearTimeout(searchTimer);
        const val = $(this).val();
        searchTimer = setTimeout(() => {
          self.state.search = val;
          self.state.page = 1;
          self.fetchBooks();
        }, 400);
      });

      $('#booksCategoryFilter').on('change', function () {
        self.state.category = $(this).val();
        self.state.page = 1;
        self.fetchBooks();
      });

      $('#booksStockFilter').on('change', function () {
        self.state.stockFilter = $(this).val();
        self.state.page = 1;
        self.fetchBooks();
      });

      $('#booksLimitSelect').on('change', function () {
        self.state.limit = parseInt($(this).val(), 10);
        self.state.page = 1;
        self.fetchBooks();
      });

      $(document).on('click', '#booksPagination .page-link', function (e) {
        e.preventDefault();
        self.state.page = parseInt($(this).data('page'), 10);
        self.fetchBooks();
      });

      // Pre-fill category filter from URL (e.g., linked from Dashboard's stock alert banner)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('filter') === 'low-stock') {
        $('#booksStockFilter').val('low-stock');
        self.state.stockFilter = 'low-stock';
      }
    }
  };

  $(function () {
    BooksPage.init();
  });
})(window, jQuery);