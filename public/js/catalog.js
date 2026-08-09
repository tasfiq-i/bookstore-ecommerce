/* ═══════════════════════════════════════════════════════
   BookStore — Catalog & Book Details Logic
   Handles: catalog.ejs (grid/filters/sort/pagination/socket)
            details.ejs (single book view/cart/reviews/socket)
   Add-to-cart now supports guests via window.GuestCart —
   no login redirect for anonymous users.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, ButtonState, TokenStore, extractErrorMessage, formatCurrency, formatDate, debounce, refreshCartBadge } =
    window.BookStore;

  // ─────────────────────────────────────────────────────
  // Shared: render a single book card
  // ─────────────────────────────────────────────────────
  function renderBookCard(book) {
    const img = book.images && book.images.length > 0 ? book.images[0].url : '/images/book-placeholder.png';
    const hasDiscount = book.discountPrice != null && book.discountPrice < book.price;
    const effectivePrice = hasDiscount ? book.discountPrice : book.price;
    const discountPercent = hasDiscount ? Math.round(((book.price - book.discountPrice) / book.price) * 100) : 0;

    const stock = book.stock !== undefined ? book.stock : (book.stockStatus === 'out-of-stock' ? 0 : 1);
    const isOutOfStock = stock <= 0;

    let stockBadge = '';
    if (isOutOfStock) {
      stockBadge = '<span class="badge badge-stock bg-danger">Out of Stock</span>';
    } else if (book.stockStatus === 'low-stock' || (book.lowStockThreshold && stock <= book.lowStockThreshold)) {
      stockBadge = `<span class="badge badge-stock bg-warning text-dark">Only ${stock} left</span>`;
    }

    const categoryName = book.category && book.category.name ? book.category.name : '';
    const authorName = book.author && book.author.name ? book.author.name : '';

    return `
      <div class="card book-card" data-book-id="${book._id}">
        <a href="/books/${book.slug}" class="text-decoration-none">
          <div class="book-cover-wrap">
            <img src="${img}" alt="${escapeHtml(book.title)}" loading="lazy" />
            ${stockBadge}
            ${hasDiscount ? `<span class="badge badge-discount">-${discountPercent}%</span>` : ''}
          </div>
        </a>
        <div class="card-body d-flex flex-column">
          ${categoryName ? `<div class="small text-muted mb-1">${escapeHtml(categoryName)}</div>` : ''}
          <a href="/books/${book.slug}" class="text-decoration-none text-dark">
            <h6 class="card-title mb-1">${escapeHtml(book.title)}</h6>
          </a>
          ${authorName ? `<div class="book-author mb-2">by ${escapeHtml(authorName)}</div>` : ''}
          <div class="d-flex align-items-center mb-2">
            ${renderStars(book.ratings ? book.ratings.average : 0, 'small')}
            <span class="small text-muted ms-1">(${book.ratings ? book.ratings.count : 0})</span>
          </div>
          <div class="mt-auto d-flex justify-content-between align-items-center">
            <div>
              <span class="price-current">${formatCurrency(effectivePrice)}</span>
              ${hasDiscount ? `<span class="price-original">${formatCurrency(book.price)}</span>` : ''}
            </div>
          </div>
          <button
            class="btn btn-primary btn-sm w-100 mt-3 btn-add-cart"
            data-book-id="${book._id}"
            data-book-title="${escapeHtml(book.title)}"
            ${isOutOfStock ? 'disabled' : ''}
          >
            <i class="bi bi-cart-plus me-1"></i> ${isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;
  }

  function renderStars(average, sizeClass) {
    const avg = Number(average) || 0;
    let html = `<span class="star-rating-display ${sizeClass || ''}">`;
    for (let i = 1; i <= 5; i++) {
      if (avg >= i) {
        html += '<i class="bi bi-star-fill"></i>';
      } else if (avg >= i - 0.5) {
        html += '<i class="bi bi-star-half"></i>';
      } else {
        html += '<i class="bi bi-star"></i>';
      }
    }
    html += '</span>';
    return html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─────────────────────────────────────────────────────
  // Shared: Add-to-Cart handler — guests use GuestCart (localStorage),
  // no login redirect. Authenticated users hit the API as before.
  // ─────────────────────────────────────────────────────
  function addToCart(bookId, quantity, $btn) {
    const originalHtml = $btn.html();
    $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

    if (!TokenStore.isLoggedIn()) {
      window.GuestCart.addItem(bookId, quantity || 1);
      Toast.success('Added to cart');
      refreshCartBadge();
      $btn.prop('disabled', false).html(originalHtml);
      return;
    }

    Api.post('/cart/items', { bookId, quantity: quantity || 1 })
      .done((res) => {
        Toast.success(res.message || 'Added to cart');
        refreshCartBadge();
      })
      .fail((jqXHR) => {
        Toast.error(extractErrorMessage(jqXHR));
      })
      .always(() => {
        $btn.prop('disabled', false).html(originalHtml);
      });
  }

  $(document).on('click', '.btn-add-cart:not(:disabled)', function (e) {
    e.preventDefault();
    const $btn = $(this);
    addToCart($btn.data('book-id'), 1, $btn);
  });

  // ─────────────────────────────────────────────────────
  // Socket.io connection
  // ─────────────────────────────────────────────────────
  let socket = null;

  function initSocket() {
    if (window.BookStoreSocket) {
      socket = window.BookStoreSocket.connect();
      if (socket) {
        socket.on('connect', () => {
          $('#liveStatusDot').addClass('connected');
          $('#liveStatusText').text('Live updates active');
        });
        socket.on('disconnect', () => {
          $('#liveStatusDot').removeClass('connected');
          $('#liveStatusText').text('Reconnecting...');
        });
      }
      return socket;
    }

    if (typeof io === 'undefined') return null;

    socket = io({ withCredentials: true });

    socket.on('connect', () => {
      socket.emit('join-catalog-room');
      $('#liveStatusDot').addClass('connected');
      $('#liveStatusText').text('Live updates active');
    });

    socket.on('disconnect', () => {
      $('#liveStatusDot').removeClass('connected');
      $('#liveStatusText').text('Reconnecting...');
    });

    return socket;
  }

  // ═══════════════════════════════════════════════════════
  // CATALOG PAGE LOGIC
  // ═══════════════════════════════════════════════════════
  const CatalogPage = {
    state: {
      search: '',
      category: [],
      author: [],
      publisher: [],
      format: [],
      minPrice: null,
      maxPrice: null,
      minRating: null,
      inStock: false,
      sort: 'newest',
      page: 1,
      limit: 12
    },

    init() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('search')) this.state.search = params.get('search');
      if (params.get('category')) this.state.category = params.get('category').split(',');
      if (params.get('sort')) this.state.sort = params.get('sort');
      if (params.get('minPrice')) this.state.minPrice = params.get('minPrice');
      if (params.get('maxPrice')) this.state.maxPrice = params.get('maxPrice');

      $('#sortSelect').val(this.state.sort);
      if (this.state.minPrice) $('#minPriceInput').val(this.state.minPrice);
      if (this.state.maxPrice) $('#maxPriceInput').val(this.state.maxPrice);

      this.loadFilterMeta();
      this.fetchBooks();
      this.bindEvents();
      initSocket();
      this.bindSocketEvents();
    },

    bindEvents() {
      const self = this;

      $('#sortSelect').on('change', function () {
        self.state.sort = $(this).val();
        self.state.page = 1;
        self.fetchBooks();
      });

      $('#applyPriceBtn').on('click', function () {
        self.state.minPrice = $('#minPriceInput').val() || null;
        self.state.maxPrice = $('#maxPriceInput').val() || null;
        self.state.page = 1;
        self.fetchBooks();
      });

      $('#inStockOnlyCheck').on('change', function () {
        self.state.inStock = $(this).is(':checked');
        self.state.page = 1;
        self.fetchBooks();
      });

      $(document).on('click', '.rating-star-filter', function () {
        const rating = parseInt($(this).data('rating'), 10);
        self.state.minRating = self.state.minRating === rating ? null : rating;
        self.updateRatingStars();
        self.state.page = 1;
        self.fetchBooks();
      });

      $(document).on('change', '.category-filter-checkbox', function () {
        self.syncCheckboxGroup('category', '.category-filter-checkbox');
      });
      $(document).on('change', '.author-filter-checkbox', function () {
        self.syncCheckboxGroup('author', '.author-filter-checkbox');
      });
      $(document).on('change', '.publisher-filter-checkbox', function () {
        self.syncCheckboxGroup('publisher', '.publisher-filter-checkbox');
      });
      $(document).on('change', '.format-filter-checkbox', function () {
        self.syncCheckboxGroup('format', '.format-filter-checkbox');
      });

      $('#clearFiltersBtn, #emptyStateClearBtn').on('click', function () {
        self.clearAllFilters();
      });

      $(document).on('click', '.pagination .page-link[data-page]', function (e) {
        e.preventDefault();
        const page = parseInt($(this).data('page'), 10);
        if (page && page !== self.state.page) {
          self.state.page = page;
          self.fetchBooks();
          $('html, body').animate({ scrollTop: $('.catalog-toolbar').offset().top - 100 }, 300);
        }
      });

      $(document).on('click', '.remove-filter-chip', function () {
        const type = $(this).data('type');
        const value = $(this).data('value');
        self.removeFilter(type, value);
      });
    },

    syncCheckboxGroup(stateKey, selector) {
      this.state[stateKey] = $(selector + ':checked')
        .map(function () { return $(this).val(); })
        .get();
      this.state.page = 1;
      this.fetchBooks();
    },

    updateRatingStars() {
      $('.rating-star-filter').each(function () {
        const rating = parseInt($(this).data('rating'), 10);
        $(this).toggleClass('active', CatalogPage.state.minRating && rating <= CatalogPage.state.minRating);
      });
      $('#ratingFilterLabel').text(
        CatalogPage.state.minRating ? `${CatalogPage.state.minRating}+ stars` : '& up'
      );
    },

    clearAllFilters() {
      this.state = {
        search: this.state.search,
        category: [],
        author: [],
        publisher: [],
        format: [],
        minPrice: null,
        maxPrice: null,
        minRating: null,
        inStock: false,
        sort: 'newest',
        page: 1,
        limit: 12
      };
      $('.category-filter-checkbox, .author-filter-checkbox, .publisher-filter-checkbox, .format-filter-checkbox, #inStockOnlyCheck').prop('checked', false);
      $('#minPriceInput, #maxPriceInput').val('');
      $('#sortSelect').val('newest');
      this.updateRatingStars();
      this.fetchBooks();
    },

    removeFilter(type, value) {
      if (type === 'search') {
        this.state.search = '';
      } else if (type === 'minRating') {
        this.state.minRating = null;
      } else if (type === 'priceRange') {
        this.state.minPrice = null;
        this.state.maxPrice = null;
        $('#minPriceInput, #maxPriceInput').val('');
      } else if (Array.isArray(this.state[type])) {
        this.state[type] = this.state[type].filter((v) => v !== value);
        $(`.${type}-filter-checkbox[value="${value}"]`).prop('checked', false);
      }
      this.state.page = 1;
      this.fetchBooks();
    },

    renderActiveChips() {
      const chips = [];

      if (this.state.search) {
        chips.push({ label: `Search: "${this.state.search}"`, type: 'search', value: '' });
      }
      if (this.state.minRating) {
        chips.push({ label: `${this.state.minRating}+ stars`, type: 'minRating', value: '' });
      }
      if (this.state.minPrice || this.state.maxPrice) {
        chips.push({
          label: `Price: ${this.state.minPrice || 0} - ${this.state.maxPrice || '∞'}`,
          type: 'priceRange',
          value: ''
        });
      }

      ['category', 'author', 'publisher', 'format'].forEach((key) => {
        this.state[key].forEach((val) => {
          const $checkbox = $(`.${key}-filter-checkbox[value="${val}"]`);
          const label = $checkbox.data('label') || val;
          chips.push({ label, type: key, value: val });
        });
      });

      if (chips.length === 0) {
        $('#activeFilterChips').empty();
        return;
      }

      const html = chips
        .map(
          (chip) => `
        <span class="active-filter-chip">
          ${escapeHtml(chip.label)}
          <i class="bi bi-x-circle-fill remove-filter-chip" data-type="${chip.type}" data-value="${chip.value}"></i>
        </span>`
        )
        .join('');

      $('#activeFilterChips').html(html);
    },

    loadFilterMeta() {
      Api.get('/books/filters/meta')
        .done((res) => {
          const { priceRange, formats, categories, authors, publishers } = res.data;

          $('#priceRangeHint').text(
            `Range: ${formatCurrency(priceRange.minPrice || 0)} - ${formatCurrency(priceRange.maxPrice || 0)}`
          );

          $('#categoryFilterList').html(
            categories.length
              ? categories.map((c) => this.checkboxRow('category', c._id, c.name)).join('')
              : '<div class="small text-muted">No categories available</div>'
          );

          $('#authorFilterList').html(
            authors.length
              ? authors.map((a) => this.checkboxRow('author', a._id, a.name)).join('')
              : '<div class="small text-muted">No authors available</div>'
          );

          $('#publisherFilterList').html(
            publishers.length
              ? publishers.map((p) => this.checkboxRow('publisher', p._id, p.name)).join('')
              : '<div class="small text-muted">No publishers available</div>'
          );

          $('#formatFilterList').html(
            formats.length
              ? formats.map((f) => this.checkboxRow('format', f, f)).join('')
              : '<div class="small text-muted">No formats available</div>'
          );
        })
        .fail(() => {
          Toast.error('Failed to load filter options');
        });
    },

    checkboxRow(group, value, label) {
      return `
        <div class="form-check">
          <input class="form-check-input ${group}-filter-checkbox" type="checkbox" value="${value}" data-label="${escapeHtml(label)}" id="${group}-${value}" />
          <label class="form-check-label" for="${group}-${value}">
            <span>${escapeHtml(label)}</span>
          </label>
        </div>`;
    },

    buildQueryParams() {
      const params = {
        page: this.state.page,
        limit: this.state.limit,
        sort: this.state.sort
      };
      if (this.state.search) params.search = this.state.search;
      if (this.state.category.length) params.category = this.state.category.join(',');
      if (this.state.author.length) params.author = this.state.author.join(',');
      if (this.state.publisher.length) params.publisher = this.state.publisher.join(',');
      if (this.state.format.length) params.format = this.state.format.join(',');
      if (this.state.minPrice) params.minPrice = this.state.minPrice;
      if (this.state.maxPrice) params.maxPrice = this.state.maxPrice;
      if (this.state.minRating) params.minRating = this.state.minRating;
      if (this.state.inStock) params.inStock = 'true';
      return params;
    },

    fetchBooks() {
      $('#bookGrid').css('opacity', 0.5);
      this.renderActiveChips();

      const params = this.buildQueryParams();
      const newUrl = window.location.pathname + '?' + $.param(params);
      window.history.replaceState({}, '', newUrl);

      Api.get('/books', params)
        .done((res) => {
          const books = res.data.books || [];
          const meta = res.meta || {};

          $('#resultsCountLabel').text(`${meta.totalResults || 0} book${meta.totalResults === 1 ? '' : 's'} found`);

          if (books.length === 0) {
            $('#bookGrid').addClass('d-none');
            $('#catalogEmptyState').removeClass('d-none');
          } else {
            $('#bookGrid').removeClass('d-none').html(books.map(renderBookCard).join(''));
            $('#catalogEmptyState').addClass('d-none');
          }

          this.renderPagination(meta);
        })
        .fail((jqXHR) => {
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => {
          $('#bookGrid').css('opacity', 1);
        });
    },

    renderPagination(meta) {
      const { currentPage = 1, totalPages = 1 } = meta;
      const $pagination = $('#catalogPagination');

      if (totalPages <= 1) {
        $pagination.empty();
        return;
      }

      let html = '';
      html += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage - 1}"><i class="bi bi-chevron-left"></i></a></li>`;

      const startPage = Math.max(1, currentPage - 2);
      const endPage = Math.min(totalPages, currentPage + 2);

      if (startPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
        if (startPage > 2) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
      }

      for (let i = startPage; i <= endPage; i++) {
        html += `<li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
      }

      html += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage + 1}"><i class="bi bi-chevron-right"></i></a></li>`;

      $pagination.html(html);
    },

    bindSocketEvents() {
      if (!socket) return;

      socket.on('stock-update', (data) => {
        const $card = $(`.book-card[data-book-id="${data.bookId}"]`);
        if ($card.length === 0) return;

        const $btn = $card.find('.btn-add-cart');
        const $badge = $card.find('.badge-stock');

        if (data.stock <= 0) {
          $btn.prop('disabled', true).html('<i class="bi bi-cart-plus me-1"></i> Out of Stock');
          if ($badge.length) {
            $badge.removeClass('bg-warning text-dark').addClass('bg-danger').text('Out of Stock');
          } else {
            $card.find('.book-cover-wrap').append('<span class="badge badge-stock bg-danger">Out of Stock</span>');
          }
        } else {
          $btn.prop('disabled', false).html('<i class="bi bi-cart-plus me-1"></i> Add to Cart');
          if (data.stockStatus === 'low-stock') {
            if ($badge.length) {
              $badge.removeClass('bg-danger').addClass('bg-warning text-dark').text(`Only ${data.stock} left`);
            } else {
              $card.find('.book-cover-wrap').append(`<span class="badge badge-stock bg-warning text-dark">Only ${data.stock} left</span>`);
            }
          } else {
            $badge.remove();
          }
        }

        $card.addClass('stock-live-updated');
        setTimeout(() => $card.removeClass('stock-live-updated'), 1200);
      });

      socket.on('catalog-update', () => {
        if (CatalogPage.state.page === 1) {
          CatalogPage.fetchBooks();
        }
      });
    }
  };

  // ═══════════════════════════════════════════════════════
  // BOOK DETAILS PAGE LOGIC
  // ═══════════════════════════════════════════════════════
  const DetailsPage = {
    currentBook: null,

    init() {
      const slug = $('#bookDetailsPage').data('slug');
      if (!slug) return;

      this.fetchBook(slug);
      this.bindEvents();
      initSocket();
    },

    fetchBook(slug) {
      Api.get(`/books/${slug}`)
        .done((res) => {
          this.currentBook = res.data.book;
          this.render(res.data.book, res.data.relatedBooks);
          this.joinBookRoom();
        })
        .fail(() => {
          $('#detailsSkeleton').addClass('d-none');
          $('#bookNotFoundState').removeClass('d-none');
        });
    },

    joinBookRoom() {
      if (!socket) return;
      socket.emit('join-catalog-room');
      socket.on('stock-update', (data) => {
        if (!this.currentBook || data.bookId !== this.currentBook._id) return;
        this.currentBook.stock = data.stock;
        this.updateStockUI(data.stock, data.stockStatus);
      });
    },

    render(book, relatedBooks) {
      $('#detailsSkeleton').addClass('d-none');
      $('#bookDetailsContent').removeClass('d-none');

      document.title = `${book.title} | BookStore`;
      $('#breadcrumbNav').html(`
        <li class="breadcrumb-item"><a href="/">Home</a></li>
        <li class="breadcrumb-item"><a href="/books">Catalog</a></li>
        <li class="breadcrumb-item active" aria-current="page">${escapeHtml(book.title)}</li>
      `);

      const images = book.images && book.images.length ? book.images : [{ url: '/images/book-placeholder.png' }];
      $('#mainBookImage').attr('src', images[0].url).attr('alt', book.title);
      $('#thumbnailsContainer').html(
        images
          .map(
            (img, i) =>
              `<img src="${img.url}" alt="thumbnail" class="${i === 0 ? 'active' : ''}" data-src="${img.url}" />`
          )
          .join('')
      );

      $('#bookTitle').text(book.title);
      $('#bookRatingStars').html(renderStars(book.ratings.average));
      $('#bookRatingCount').text(`${book.ratings.average.toFixed(1)} (${book.ratings.count} review${book.ratings.count === 1 ? '' : 's'})`);
      $('#bookAuthorLink').text(book.author.name).attr('href', `/books?author=${book.author._id}`);

      const hasDiscount = book.discountPrice != null && book.discountPrice < book.price;
      const effectivePrice = hasDiscount ? book.discountPrice : book.price;
      $('#bookCurrentPrice').text(formatCurrency(effectivePrice));
      if (hasDiscount) {
        const percent = Math.round(((book.price - book.discountPrice) / book.price) * 100);
        $('#bookOriginalPrice').text(formatCurrency(book.price)).removeClass('d-none');
        $('#bookDiscountPercent').text(`-${percent}%`).removeClass('d-none');
        $('#detailDiscountBadge').text(`-${percent}%`).removeClass('d-none');
      } else {
        $('#bookOriginalPrice').addClass('d-none');
        $('#bookDiscountPercent').addClass('d-none');
        $('#detailDiscountBadge').addClass('d-none');
      }

      $('#bookDescription').text(book.description);
      $('#bookIsbn').text(book.isbn);
      $('#bookPublisher').text(book.publisher.name);
      $('#bookCategory').text(book.category.name);
      $('#bookFormat').text(book.format);
      $('#bookLanguage').text(book.language);
      $('#bookPages').text(book.pages || '—');

      this.updateStockUI(book.stock, book.stockStatus);
      this.renderReviews(book.reviews || []);

      $('#relatedBooksContainer').html(
        (relatedBooks || []).map(renderBookCard).join('') ||
          '<p class="text-muted small">No related books found.</p>'
      );

      window.BookStore.updateAuthUI();
    },

    updateStockUI(stock, stockStatus) {
      const $badge = $('#detailStockBadge');
      const $addBtn = $('#addToCartBtn');
      const $buyBtn = $('#buyNowBtn');
      const $qtyInput = $('#qtyInput');
      const $liveMsg = $('#liveStockMessage');

      if (stock <= 0) {
        $badge.text('Out of Stock').removeClass('bg-warning text-dark').addClass('bg-danger').removeClass('d-none');
        $addBtn.prop('disabled', true).html('<i class="bi bi-cart-plus me-1"></i> Out of Stock');
        $buyBtn.prop('disabled', true);
        $qtyInput.prop('disabled', true);
        $liveMsg.html('<div class="alert alert-danger py-2 small mb-0"><i class="bi bi-exclamation-circle me-1"></i>This book is currently out of stock.</div>');
      } else if (stockStatus === 'low-stock') {
        $badge.text(`Only ${stock} left`).removeClass('bg-danger').addClass('bg-warning text-dark').removeClass('d-none');
        $addBtn.prop('disabled', false).html('<i class="bi bi-cart-plus me-1"></i> Add to Cart');
        $buyBtn.prop('disabled', false);
        $qtyInput.prop('disabled', false).attr('max', stock);
        $liveMsg.html(`<div class="alert alert-warning py-2 small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>Hurry! Only ${stock} left in stock.</div>`);
      } else {
        $badge.addClass('d-none');
        $addBtn.prop('disabled', false).html('<i class="bi bi-cart-plus me-1"></i> Add to Cart');
        $buyBtn.prop('disabled', false);
        $qtyInput.prop('disabled', false).removeAttr('max');
        $liveMsg.empty();
      }
    },

    renderReviews(reviews) {
      if (reviews.length === 0) {
        $('#reviewsList').empty();
        $('#noReviewsMessage').removeClass('d-none');
        return;
      }

      $('#noReviewsMessage').addClass('d-none');
      const currentUser = TokenStore.getUser();

      const html = reviews
        .slice()
        .reverse()
        .map((review) => {
          const isOwner = currentUser && review.user && (review.user._id === currentUser.id || review.user === currentUser.id);

          return `
          <div class="review-item" data-review-id="${review._id}">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="fw-semibold">${escapeHtml(review.name)}</div>
                <div class="review-stars-display">${renderStars(review.rating)}</div>
              </div>
              <div class="text-end">
                <span class="small text-muted d-block">${formatDate(review.createdAt)}</span>
                ${
                  isOwner
                    ? `<div class="mt-1">
                        <button class="btn btn-link btn-sm p-0 me-2 edit-review-btn" data-review-id="${review._id}" data-rating="${review.rating}" data-comment="${escapeHtml(review.comment || '')}">Edit</button>
                        <button class="btn btn-link btn-sm p-0 text-danger delete-review-btn" data-review-id="${review._id}">Delete</button>
                      </div>`
                    : ''
                }
              </div>
            </div>
            <p class="mt-2 mb-0 small text-secondary review-comment-text">${escapeHtml(review.comment || '')}</p>
          </div>`;
        })
        .join('');

      $('#reviewsList').html(html);
    },

    bindEvents() {
      const self = this;

      $('#qtyDecreaseBtn').on('click', function () {
        const $input = $('#qtyInput');
        const val = Math.max(1, parseInt($input.val(), 10) - 1);
        $input.val(val);
      });
      $('#qtyIncreaseBtn').on('click', function () {
        const $input = $('#qtyInput');
        const max = parseInt($input.attr('max'), 10) || 999;
        const val = Math.min(max, parseInt($input.val(), 10) + 1);
        $input.val(val);
      });

      $(document).on('click', '.book-detail-thumbs img', function () {
        $('.book-detail-thumbs img').removeClass('active');
        $(this).addClass('active');
        $('#mainBookImage').attr('src', $(this).data('src'));
      });

      $('#addToCartBtn').on('click', function () {
        if (!self.currentBook) return;
        const qty = parseInt($('#qtyInput').val(), 10) || 1;
        addToCart(self.currentBook._id, qty, $(this));
      });

      $('#buyNowBtn').on('click', function () {
        if (!self.currentBook) return;
        const qty = parseInt($('#qtyInput').val(), 10) || 1;

        if (!TokenStore.isLoggedIn()) {
          window.GuestCart.addItem(self.currentBook._id, qty);
          window.location.href = '/checkout';
          return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

        Api.post('/cart/items', { bookId: self.currentBook._id, quantity: qty })
          .done(() => {
            window.location.href = '/checkout';
          })
          .fail((jqXHR) => {
            Toast.error(extractErrorMessage(jqXHR));
            $btn.prop('disabled', false).html('<i class="bi bi-lightning-charge me-1"></i> Buy Now');
          });
      });

      $(document).on('click', '#reviewStarInput i', function () {
        const value = parseInt($(this).data('value'), 10);
        $('#reviewRatingValue').val(value);
        $('#reviewStarInput i').each(function () {
          $(this).toggleClass('active', parseInt($(this).data('value'), 10) <= value);
        });
      });

      $('#reviewForm').on('submit', function (e) {
        e.preventDefault();

        const rating = parseInt($('#reviewRatingValue').val(), 10);
        const comment = $('#reviewComment').val().trim();
        const editingReviewId = $(this).data('editing-review-id');

        if (!rating || rating < 1) {
          Toast.warning('Please select a star rating');
          return;
        }

        const $btn = $('#submitReviewBtn');
        ButtonState.loading($btn, editingReviewId ? ' Updating...' : ' Submitting...');

        const request = editingReviewId
          ? Api.put(`/books/${self.currentBook._id}/reviews/${editingReviewId}`, { rating, comment })
          : Api.post(`/books/${self.currentBook._id}/reviews`, { rating, comment });

        request
          .done(() => {
            Toast.success(editingReviewId ? 'Review updated successfully!' : 'Review submitted successfully!');
            $('#reviewComment').val('');
            $('#reviewRatingValue').val(0);
            $('#reviewStarInput i').removeClass('active');
            $('#reviewForm').removeData('editing-review-id');
            $('#submitReviewBtn').text('Submit Review');
            $('#cancelEditReviewBtn').remove();
            self.fetchBook($('#bookDetailsPage').data('slug'));
          })
          .fail((jqXHR) => {
            Toast.error(extractErrorMessage(jqXHR));
          })
          .always(() => {
            ButtonState.reset($btn);
          });
      });

      this.initReviewEditDelete(self);
    },

    initReviewEditDelete(self) {
      $(document).on('click', '.edit-review-btn', function () {
        const reviewId = $(this).data('review-id');
        const rating = parseInt($(this).data('rating'), 10);
        const comment = $(this).data('comment') || '';

        $('#reviewForm').data('editing-review-id', reviewId);
        $('#reviewRatingValue').val(rating);
        $('#reviewComment').val(comment);
        $('#reviewStarInput i').each(function () {
          $(this).toggleClass('active', parseInt($(this).data('value'), 10) <= rating);
        });
        $('#submitReviewBtn').text('Update Review');
        $('#addReviewCard').removeClass('d-none');
        $('html, body').animate({ scrollTop: $('#addReviewCard').offset().top - 100 }, 300);

        if ($('#cancelEditReviewBtn').length === 0) {
          $('#submitReviewBtn').after(
            '<button type="button" class="btn btn-outline-secondary btn-sm ms-2" id="cancelEditReviewBtn">Cancel</button>'
          );
        }
      });

      $(document).on('click', '#cancelEditReviewBtn', function () {
        $('#reviewForm').removeData('editing-review-id');
        $('#reviewComment').val('');
        $('#reviewRatingValue').val(0);
        $('#reviewStarInput i').removeClass('active');
        $('#submitReviewBtn').text('Submit Review');
        $(this).remove();
      });

      $(document).on('click', '.delete-review-btn', function () {
        const reviewId = $(this).data('review-id');
        if (!confirm('Are you sure you want to delete your review? This cannot be undone.')) return;

        Api.delete(`/books/${self.currentBook._id}/reviews/${reviewId}`)
          .done(() => {
            Toast.success('Review deleted successfully');
            self.fetchBook($('#bookDetailsPage').data('slug'));
          })
          .fail((jqXHR) => {
            Toast.error(extractErrorMessage(jqXHR));
          });
      });
    }
  };

  // ─────────────────────────────────────────────────────
  // Page router
  // ─────────────────────────────────────────────────────
  $(function () {
    if ($('#bookGrid').length) {
      CatalogPage.init();
    }
    if ($('#bookDetailsPage').length) {
      DetailsPage.init();
    }
  });
})(window, jQuery);