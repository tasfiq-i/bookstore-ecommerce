/* ═══════════════════════════════════════════════════════
   BookStore — Shared Frontend Utilities
   Loaded on every page via footer.ejs
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const API_BASE = '/api';

  // ─────────────────────────────────────────────────────
  // Token Storage Helpers
  // ─────────────────────────────────────────────────────
  const TokenStore = {
    KEY: 'bookstore_token',
    USER_KEY: 'bookstore_user',

    getToken() {
      return localStorage.getItem(this.KEY);
    },
    setToken(token) {
      if (token) localStorage.setItem(this.KEY, token);
    },
    clearToken() {
      localStorage.removeItem(this.KEY);
      localStorage.removeItem(this.USER_KEY);
    },
    getUser() {
      const raw = localStorage.getItem(this.USER_KEY);
      try {
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    setUser(user) {
      if (user) localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    },
    isLoggedIn() {
      return !!this.getToken();
    },
    isAdmin() {
      const user = this.getUser();
      return user && user.role === 'admin';
    }
  };

  // ─────────────────────────────────────────────────────
  // JWT-Aware AJAX Wrapper
  // ─────────────────────────────────────────────────────
  const Api = {
    request(options) {
      const token = TokenStore.getToken();

      const defaults = {
        url: API_BASE + options.url,
        method: options.method || 'GET',
        contentType: options.contentType !== undefined ? options.contentType : 'application/json',
        dataType: 'json',
        xhrFields: { withCredentials: true },
        headers: {}
      };

      if (token) {
        defaults.headers['Authorization'] = `Bearer ${token}`;
      }

      if (options.headers) {
        defaults.headers = Object.assign(defaults.headers, options.headers);
      }

      if (options.data !== undefined) {
        if (options.data instanceof FormData) {
          defaults.data = options.data;
          defaults.processData = false;
          defaults.contentType = false;
        } else if (defaults.contentType === 'application/json') {
          defaults.data = JSON.stringify(options.data);
        } else {
          defaults.data = options.data;
        }
      }

      const finalOptions = Object.assign({}, defaults, options, {
        url: defaults.url,
        headers: defaults.headers,
        data: defaults.data
      });

      return $.ajax(finalOptions)
        .fail((jqXHR) => {
          if (jqXHR.status === 401) {
            TokenStore.clearToken();
            BookStore.updateAuthUI();
          }
        });
    },

    get(url, params) {
      let finalUrl = url;
      if (params) {
        const qs = $.param(params);
        finalUrl += (url.includes('?') ? '&' : '?') + qs;
      }
      return this.request({ url: finalUrl, method: 'GET' });
    },
    post(url, data) {
      return this.request({ url, method: 'POST', data });
    },
    put(url, data) {
      return this.request({ url, method: 'PUT', data });
    },
    patch(url, data) {
      return this.request({ url, method: 'PATCH', data });
    },
    delete(url, data) {
      return this.request({ url, method: 'DELETE', data });
    },
    upload(url, formData, method) {
      return this.request({ url, method: method || 'POST', data: formData, contentType: false });
    }
  };

  // ─────────────────────────────────────────────────────
  // Bootstrap 5 Toast Notification Wrapper
  // ─────────────────────────────────────────────────────
  const Toast = {
    icons: {
      success: 'bi-check-circle-fill',
      error: 'bi-x-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
      info: 'bi-info-circle-fill'
    },
    colors: {
      success: 'text-bg-success',
      error: 'text-bg-danger',
      warning: 'text-bg-warning',
      info: 'text-bg-primary'
    },

    show(message, type = 'info', delay = 4000) {
      const type_ = this.icons[type] ? type : 'info';
      const toastId = 'toast-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

      const $toast = $(`
        <div id="${toastId}" class="toast align-items-center ${this.colors[type_]} border-0" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="${delay}">
          <div class="d-flex">
            <div class="toast-body">
              <i class="bi ${this.icons[type_]} me-2"></i>${this.escapeHtml(message)}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
        </div>
      `);

      $('#toastContainer').append($toast);
      const toastEl = new bootstrap.Toast($toast[0]);
      toastEl.show();

      $toast[0].addEventListener('hidden.bs.toast', () => $toast.remove());
    },

    success(message, delay) { this.show(message, 'success', delay); },
    error(message, delay) { this.show(message, 'error', delay); },
    warning(message, delay) { this.show(message, 'warning', delay); },
    info(message, delay) { this.show(message, 'info', delay); },

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  };

  // ─────────────────────────────────────────────────────
  // Global Loader Helper
  // ─────────────────────────────────────────────────────
  const Loader = {
    show() { $('#globalLoader').removeClass('d-none'); },
    hide() { $('#globalLoader').addClass('d-none'); }
  };

  // ─────────────────────────────────────────────────────
  // Button Loading State Helper
  // ─────────────────────────────────────────────────────
  const ButtonState = {
    loading($btn, loadingText) {
      $btn.data('original-html', $btn.html());
      $btn.prop('disabled', true);
      $btn.html(
        `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>${loadingText || 'Please wait...'}`
      );
    },
    reset($btn) {
      const original = $btn.data('original-html');
      if (original) $btn.html(original);
      $btn.prop('disabled', false);
    }
  };

  // ─────────────────────────────────────────────────────
  // Error Extraction Helper
  // ─────────────────────────────────────────────────────
  function extractErrorMessage(jqXHR) {
    if (jqXHR.responseJSON) {
      const res = jqXHR.responseJSON;
      if (res.errors && Array.isArray(res.errors) && res.errors.length > 0) {
        return res.errors.map((e) => e.message).join(' ');
      }
      if (res.message) return res.message;
    }
    if (jqXHR.status === 0) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
  }

  // ─────────────────────────────────────────────────────
  // Field-level validation error rendering
  // ─────────────────────────────────────────────────────
  function renderFieldErrors($form, jqXHR) {
    $form.find('.is-invalid').removeClass('is-invalid');
    $form.find('.invalid-feedback[data-dynamic]').remove();

    if (jqXHR.responseJSON && Array.isArray(jqXHR.responseJSON.errors)) {
      jqXHR.responseJSON.errors.forEach((err) => {
        const $field = $form.find(`[name="${err.field}"]`);
        if ($field.length) {
          $field.addClass('is-invalid');
          $field.after(`<div class="invalid-feedback d-block" data-dynamic="true">${Toast.escapeHtml(err.message)}</div>`);
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────
  // Currency / Date Formatters
  // ─────────────────────────────────────────────────────
  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return '৳' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(dateString, options) {
    const date = new Date(dateString);
    return date.toLocaleDateString(
      'en-US',
      options || { year: 'numeric', month: 'short', day: 'numeric' }
    );
  }

  // ─────────────────────────────────────────────────────
  // Debounce Helper
  // ─────────────────────────────────────────────────────
  function debounce(fn, delay = 350) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ─────────────────────────────────────────────────────
  // Auth-aware Navbar UI Sync
  // ─────────────────────────────────────────────────────
  function updateAuthUI() {
    const user = TokenStore.getUser();

    if (user) {
      $('.guest-only').addClass('d-none');
      $('.auth-only').removeClass('d-none');
      $('#navUserName, #dropdownUserName').text(user.name);
      if (user.avatar && user.avatar.url) {
        $('#navUserAvatar').attr('src', user.avatar.url);
      }
      if (user.role === 'admin') {
        $('.admin-only').removeClass('d-none');
      } else {
        $('.admin-only').addClass('d-none');
      }
    } else {
      $('.guest-only').removeClass('d-none');
      $('.auth-only').addClass('d-none');
      $('.admin-only').addClass('d-none');
    }
  }

  // ─────────────────────────────────────────────────────
  // Cart Count Badge Sync — checks GuestCart when logged out,
  // hits the API when logged in
  // ─────────────────────────────────────────────────────
  function refreshCartBadge() {
    if (!TokenStore.isLoggedIn()) {
      const count = window.GuestCart ? window.GuestCart.getCount() : 0;
      const $badge = $('#cartCountBadge');
      if (count > 0) {
        $badge.text(count > 99 ? '99+' : count).removeClass('d-none');
      } else {
        $badge.addClass('d-none').text('0');
      }
      return;
    }

    Api.get('/cart/count')
      .done((res) => {
        const count = res.data && res.data.itemCount ? res.data.itemCount : 0;
        const $badge = $('#cartCountBadge');
        if (count > 0) {
          $badge.text(count > 99 ? '99+' : count).removeClass('d-none');
        } else {
          $badge.addClass('d-none').text('0');
        }
      })
      .fail(() => {});
  }

  // ─────────────────────────────────────────────────────
  // Logout Handler
  // ─────────────────────────────────────────────────────
  function handleLogout(e) {
    e.preventDefault();

    Api.post('/auth/logout')
      .always(() => {
        TokenStore.clearToken();
        updateAuthUI();
        Toast.success('You have been logged out successfully');
        setTimeout(() => {
          window.location.href = '/login';
        }, 800);
      });
  }

  // ─────────────────────────────────────────────────────
  // Navbar Live Search
  // ─────────────────────────────────────────────────────
  function initNavSearch() {
    const $input = $('#navSearchInput');
    const $results = $('#navSearchResults');
    const $form = $('#navSearchForm');

    if (!$input.length) return;

    const doSearch = debounce(function () {
      const query = $input.val().trim();

      if (query.length < 2) {
        $results.addClass('d-none').empty();
        return;
      }

      Api.get('/books', { search: query, limit: 6 })
        .done((res) => {
          const books = (res.data && res.data.books) || [];

          if (books.length === 0) {
            $results.html('<div class="p-3 text-center text-muted small">No books found</div>').removeClass('d-none');
            return;
          }

          const html = books
            .map((book) => {
              const img = book.images && book.images.length > 0 ? book.images[0].url : '/images/book-placeholder.png';
              const price = book.discountPrice != null ? book.discountPrice : book.price;
              return `
                <a href="/books/${book.slug}" class="nav-search-item text-decoration-none">
                  <img src="${img}" alt="${Toast.escapeHtml(book.title)}" />
                  <div class="search-item-info">
                    <div class="search-item-title">${Toast.escapeHtml(book.title)}</div>
                    <div class="search-item-price">${formatCurrency(price)}</div>
                  </div>
                </a>
              `;
            })
            .join('');

          $results.html(html).removeClass('d-none');
        })
        .fail(() => {
          $results.addClass('d-none').empty();
        });
    }, 350);

    $input.on('input', doSearch);
    $input.on('focus', function () {
      if ($input.val().trim().length >= 2) $results.removeClass('d-none');
    });

    $(document).on('click', function (e) {
      if (!$(e.target).closest('#navSearchForm').length) {
        $results.addClass('d-none');
      }
    });

    $form.on('submit', function (e) {
      e.preventDefault();
      const query = $input.val().trim();
      if (query) {
        window.location.href = `/books?search=${encodeURIComponent(query)}`;
      }
    });
  }

  // ─────────────────────────────────────────────────────
  // Global initialization on every page load
  // ─────────────────────────────────────────────────────
  $(function () {
    updateAuthUI();
    refreshCartBadge();
    initNavSearch();

    $(document).on('click', '#logoutBtn', handleLogout);
    $(document).on('guestcart:changed', refreshCartBadge);

    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].forEach((el) => new bootstrap.Tooltip(el));
  });

  // ─────────────────────────────────────────────────────
  // Expose shared utilities globally as window.BookStore
  // ─────────────────────────────────────────────────────
  window.BookStore = {
    Api,
    Toast,
    Loader,
    ButtonState,
    TokenStore,
    extractErrorMessage,
    renderFieldErrors,
    formatCurrency,
    formatDate,
    debounce,
    updateAuthUI,
    refreshCartBadge
  };
})(window, jQuery);