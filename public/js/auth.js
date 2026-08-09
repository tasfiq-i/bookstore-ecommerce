/* ═══════════════════════════════════════════════════════
   BookStore — Shared Authentication Logic
   Handles login and register form submission, and triggers
   GuestCart.mergeIntoAccount() immediately after a token is
   received, so any items added while browsing as a guest
   land in the user's real account cart right away.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, ButtonState, TokenStore, extractErrorMessage, renderFieldErrors, updateAuthUI } = window.BookStore;

  /**
   * Shared post-auth-success handler. Called after both login and register.
   * @param {Object} user
   * @param {String} token
   */
  async function handleAuthSuccess(user, token) {
    TokenStore.setToken(token);
    TokenStore.setUser(user);
    updateAuthUI();

    // Merge any items added to the cart while browsing as a guest
    if (window.GuestCart) {
      try {
        await window.GuestCart.mergeIntoAccount();
      } catch (e) {
        console.error('Guest cart merge failed:', e);
      }
    }

    if (window.BookStore.refreshCartBadge) {
      window.BookStore.refreshCartBadge();
    }
  }

  function getRedirectTarget(user) {
    const params = new URLSearchParams(window.location.search);
    const redirectTo = params.get('redirect');

    if (redirectTo) return redirectTo;
    if (user.role === 'admin') return '/admin';
    return '/';
  }

  // ─────────────────────────────────────────────────────
  // Login Page
  // ─────────────────────────────────────────────────────
  function initLoginForm() {
    const $form = $('#loginForm');
    if (!$form.length) return;

    if (TokenStore.isLoggedIn()) {
      window.location.href = '/';
      return;
    }

    $('.toggle-password').on('click', function () {
      const $input = $('#password');
      const $icon = $(this).find('i');
      const isPassword = $input.attr('type') === 'password';
      $input.attr('type', isPassword ? 'text' : 'password');
      $icon.toggleClass('bi-eye bi-eye-slash');
    });

    $form.on('submit', function (e) {
      e.preventDefault();

      const $btn = $('#loginSubmitBtn');
      const payload = {
        email: $('#email').val().trim(),
        password: $('#password').val()
      };

      ButtonState.loading($btn, ' Logging in...');

      Api.post('/auth/login', payload)
        .done(async (res) => {
          const { user, token } = res.data;
          await handleAuthSuccess(user, token);

          Toast.success(`Welcome back, ${user.name}!`);

          setTimeout(() => {
            window.location.href = getRedirectTarget(user);
          }, 600);
        })
        .fail((jqXHR) => {
          renderFieldErrors($form, jqXHR);
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => {
          ButtonState.reset($btn);
        });
    });
  }

  // ─────────────────────────────────────────────────────
  // Register Page
  // ─────────────────────────────────────────────────────
  function initRegisterForm() {
    const $form = $('#registerForm');
    if (!$form.length) return;

    if (TokenStore.isLoggedIn()) {
      window.location.href = '/';
      return;
    }

    $('.toggle-password').on('click', function () {
      const $input = $('#password');
      const $icon = $(this).find('i');
      const isPassword = $input.attr('type') === 'password';
      $input.attr('type', isPassword ? 'text' : 'password');
      $icon.toggleClass('bi-eye bi-eye-slash');
    });

    $('#password').on('input', function () {
      const val = $(this).val();
      let score = 0;
      if (val.length >= 6) score += 25;
      if (val.length >= 10) score += 25;
      if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score += 25;
      if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) score += 25;

      const $bar = $('#passwordStrengthBar');
      $bar.css('width', score + '%');
      $bar.removeClass('bg-danger bg-warning bg-success');
      if (score <= 25) $bar.addClass('bg-danger');
      else if (score <= 75) $bar.addClass('bg-warning');
      else $bar.addClass('bg-success');
    });

    $form.on('submit', function (e) {
      e.preventDefault();

      const $btn = $('#registerSubmitBtn');
      const password = $('#password').val();
      const confirmPassword = $('#confirmPassword').val();

      if (password !== confirmPassword) {
        $('#confirmPassword').addClass('is-invalid');
        $('#confirmPassword').after(
          '<div class="invalid-feedback d-block" data-dynamic="true">Passwords do not match</div>'
        );
        Toast.error('Passwords do not match');
        return;
      }

      if (!$('#agreeTerms').is(':checked')) {
        Toast.warning('Please agree to the Terms of Service to continue');
        return;
      }

      const payload = {
        name: $('#name').val().trim(),
        email: $('#email').val().trim(),
        password: password
      };

      const phone = $('#phone').val().trim();
      if (phone) payload.phone = phone;

      ButtonState.loading($btn, ' Creating account...');

      Api.post('/auth/register', payload)
        .done(async (res) => {
          const { user, token } = res.data;
          await handleAuthSuccess(user, token);

          Toast.success(`Welcome to BookStore, ${user.name}! Your account has been created.`);

          setTimeout(() => {
            window.location.href = getRedirectTarget(user);
          }, 800);
        })
        .fail((jqXHR) => {
          renderFieldErrors($form, jqXHR);
          Toast.error(extractErrorMessage(jqXHR));
        })
        .always(() => {
          ButtonState.reset($btn);
        });
    });
  }

  window.BookStoreAuth = { handleAuthSuccess };

  $(function () {
    initLoginForm();
    initRegisterForm();
  });
})(window, jQuery);