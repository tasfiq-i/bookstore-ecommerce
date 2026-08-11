/* ═══════════════════════════════════════════════════════
   BookStore — Homepage Logic
   Fetches featured/new/popular books, categories, and stats
   entirely via AJAX against existing Step 5/6 endpoints.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, TokenStore, extractErrorMessage, formatCurrency, refreshCartBadge } = window.BookStore;

  if (!$('#featuredBooksGrid').length) return; // not on the homepage

  const categoryIconMap = [
    'bi-book', 'bi-mortarboard', 'bi-lightbulb', 'bi-emoji-smile',
    'bi-rocket-takeoff', 'bi-heart', 'bi-globe', 'bi-brush', 'bi-music-note'
  ];

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Reuses the same book-card markup pattern as catalog.js (Step 12) ──
 // ── REPLACE the existing renderBookCard() function in home.js ──
  function renderBookCard(book) {
    const img = book.images && book.images.length > 0 ? book.images[0].url : '/images/book-placeholder.png';
    const hasDiscount = book.discountPrice != null && book.discountPrice < book.price;
    const effectivePrice = hasDiscount ? book.discountPrice : book.price;
    const discountPercent = hasDiscount ? Math.round(((book.price - book.discountPrice) / book.price) * 100) : 0;

    const stock = book.stock != null ? book.stock : 0;
    const isOutOfStock = stock <= 0;
    const isLowStock = stock > 0 && stock <= 10;

    let coverBadge = '';
    if (isOutOfStock) {
      coverBadge = '<span class="badge badge-stock bg-danger">Out of Stock</span>';
    } else if (isLowStock) {
      coverBadge = `<span class="badge badge-stock bg-warning text-dark">Only ${stock} left</span>`;
    }

    const authorName = book.author && book.author.name ? book.author.name : '';
    
    let stockClass, stockText;
    if (isOutOfStock) {
      stockClass = 'stock-out';
      stockText = 'Out of Stock';
    } else if (isLowStock) {
      stockClass = 'stock-low';
      stockText = `Only ${stock} left`;
    } else {
      stockClass = 'stock-in';
      stockText = `In Stock (${stock} pieces)`;
    }

    return `
      <div class="card book-card" data-book-id="${book._id}">
        <a href="/books/${book.slug}" class="text-decoration-none">
          <div class="book-cover-wrap">
            <img src="${img}" alt="${esc(book.title)}" loading="lazy" />
            ${coverBadge}
            ${hasDiscount ? `<span class="badge badge-discount">-${discountPercent}%</span>` : ''}
          </div>
        </a>
        <div class="card-body">
          <a href="/books/${book.slug}" class="text-decoration-none text-dark">
            <h6 class="card-title mb-1">${esc(book.title)}</h6>
          </a>
          ${authorName ? `<div class="book-author mb-2">by ${esc(authorName)}</div>` : ''}

          <div class="d-flex align-items-center mb-1">
            ${book.ratings ? renderStarsHome(book.ratings.average) : ''}
            <span class="small text-muted ms-1">(${book.ratings ? book.ratings.count : 0})</span>
          </div>

          <div class="stock-status-line ${stockClass}" data-book-stock-id="${book._id}">
            <span class="stock-status-text">${stockText}</span>
          </div>

          <div class="price-row d-flex justify-content-between align-items-center">
            <div>
              <span class="price-current">${formatCurrency(effectivePrice)}</span>
              ${hasDiscount ? `<span class="price-original">${formatCurrency(book.price)}</span>` : ''}
            </div>
          </div>

          <button
            class="btn btn-primary btn-sm w-100 mt-3 btn-add-cart"
            data-book-id="${book._id}"
            ${isOutOfStock ? 'disabled' : ''}
          >
            <i class="bi bi-cart-plus me-1"></i> ${isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;
  }

  // ── ADD this small star-rendering helper if home.js doesn't already have one ──
  // (catalog.js has renderStars(); home.js's original version may not have exposed
  // a matching helper — add this if you get a "renderStarsHome is not defined" error)
  function renderStarsHome(average) {
    const avg = Number(average) || 0;
    let html = '<span class="star-rating-display small">';
    for (let i = 1; i <= 5; i++) {
      if (avg >= i) html += '<i class="bi bi-star-fill"></i>';
      else if (avg >= i - 0.5) html += '<i class="bi bi-star-half"></i>';
      else html += '<i class="bi bi-star"></i>';
    }
    html += '</span>';
    return html;
  }

  function renderSkeletonError($grid, message) {
    $grid.html(`<p class="text-muted small col-12">${message}</p>`);
  }

  const HomePage = {
    init() {
      this.loadHeroStats();
      this.loadCategories();
      this.loadFeaturedBooks();
      this.loadNewArrivals();
      this.loadBestSellers();
      this.bindEvents();
    },

    loadHeroStats() {
      Api.get('/books/filters/meta')
        .done((res) => {
          $('#heroStatCategories').text((res.data.categories || []).length);
        })
        .fail(() => {});

      Api.get('/books', { limit: 1 })
        .done((res) => {
          $('#heroStatBooks').text((res.meta && res.meta.totalResults ? res.meta.totalResults : 0) + '+');
        })
        .fail(() => {
          $('#heroStatBooks').text('—');
        });
    },

    loadCategories() {
      Api.get('/categories')
        .done((res) => {
          const categories = (res.data.categories || []).slice(0, 8);

          if (categories.length === 0) {
            $('#categoryPillContainer').html('<p class="text-muted small">No categories yet</p>');
            return;
          }

          const html = categories
            .map((cat, i) => {
              const icon = categoryIconMap[i % categoryIconMap.length];
              return `
              <a href="/books?category=${cat._id}" class="category-pill-card">
                <div class="category-pill-icon"><i class="bi ${icon}"></i></div>
                <div class="cat-name">${esc(cat.name)}</div>
                <div class="cat-count">${cat.bookCount || 0} books</div>
              </a>`;
            })
            .join('');

          $('#categoryPillContainer').html(html);
        })
        .fail((jqXHR) => {
          renderSkeletonError($('#categoryPillContainer'), 'Failed to load categories');
        });
    },

    loadFeaturedBooks() {
      Api.get('/books', { isFeatured: 'true', limit: 8, sort: 'newest' })
        .done((res) => {
          const books = res.data.books || [];
          if (books.length === 0) {
            $('#featuredBooksGrid').addClass('d-none');
            $('#featuredBooksEmpty').removeClass('d-none');
            return;
          }
          $('#featuredBooksGrid').html(books.map(renderBookCard).join(''));
        })
        .fail(() => {
          renderSkeletonError($('#featuredBooksGrid'), 'Failed to load featured books');
        });
    },

    loadNewArrivals() {
      Api.get('/books', { limit: 8, sort: 'newest' })
        .done((res) => {
          const books = res.data.books || [];
          if (books.length === 0) {
            $('#newArrivalsGrid').closest('section').addClass('d-none');
            return;
          }
          $('#newArrivalsGrid').html(books.map(renderBookCard).join(''));
        })
        .fail(() => {
          renderSkeletonError($('#newArrivalsGrid'), 'Failed to load new arrivals');
        });
    },

    loadBestSellers() {
      Api.get('/books', { limit: 8, sort: 'popular' })
        .done((res) => {
          const books = res.data.books || [];
          if (books.length === 0) {
            $('#bestSellersGrid').closest('section').addClass('d-none');
            return;
          }
          $('#bestSellersGrid').html(books.map(renderBookCard).join(''));
        })
        .fail(() => {
          renderSkeletonError($('#bestSellersGrid'), 'Failed to load best sellers');
        });
    },

    bindEvents() {
      // Hero search redirects to the full catalog with the query pre-filled
      $('#heroSearchForm').on('submit', function (e) {
        e.preventDefault();
        const query = $('#heroSearchInput').val().trim();
        window.location.href = query ? `/books?search=${encodeURIComponent(query)}` : '/books';
      });

      // Add-to-cart delegated handler (same contract as catalog.js's global one,
      // safe to duplicate since this file only loads on the homepage)
      $(document).on('click', '.btn-add-cart:not(:disabled)', function (e) {
        e.preventDefault();
        const $btn = $(this);
        const bookId = $btn.data('book-id');

        if (!TokenStore.isLoggedIn()) {
          Toast.warning('Please login to add items to your cart');
          setTimeout(() => (window.location.href = '/login?redirect=/'), 900);
          return;
        }

        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span>');

        Api.post('/cart/items', { bookId, quantity: 1 })
          .done((res) => {
            Toast.success(res.message || 'Added to cart');
            refreshCartBadge();
          })
          .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)))
          .always(() => $btn.prop('disabled', false).html(originalHtml));
      });

      // Newsletter — no backend endpoint yet, so this is a friendly placeholder
      $('#newsletterForm').on('submit', function (e) {
        e.preventDefault();
        const email = $('#newsletterEmail').val().trim();
        if (!email) return;
        Toast.success('Thanks for subscribing! We\'ll keep you posted.');
        $(this)[0].reset();
      });
    }
  };

  $(function () {
    HomePage.init();
  });
})(window, jQuery);
