/* ═══════════════════════════════════════════════════════
   BookStore — Admin Shared Layer
   AJAX helpers, Chart.js rendering, Socket.io admin room,
   sidebar toggle, and Dashboard page logic.
   This file is loaded on EVERY /admin/* page — future admin
   pages (Step 16+) reuse AdminCore below.
   ═══════════════════════════════════════════════════════ */

(function (window, $) {
  'use strict';

  const { Api, Toast, TokenStore, extractErrorMessage, formatCurrency, formatDate } = window.BookStore;

  // ─────────────────────────────────────────────────────
  // Admin Guard — runs on every admin page, before anything renders
  // ─────────────────────────────────────────────────────
  function guardAdminAccess() {
    if (!TokenStore.isLoggedIn() || !TokenStore.isAdmin()) {
      $('#adminGuard').hide();
      $('#adminAccessDenied').removeClass('d-none');

      if (!TokenStore.isLoggedIn()) {
        setTimeout(() => {
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        }, 1200);
      }
      return false;
    }

    $('#adminGuard').css('display', 'flex');
    return true;
  }

  // ─────────────────────────────────────────────────────
  // Sidebar toggle (mobile)
  // ─────────────────────────────────────────────────────
  function initSidebarToggle() {
    $('#openAdminSidebarBtn').on('click', function () {
      $('#adminSidebar').addClass('show');
      $('#adminSidebarOverlay').addClass('show');
    });
    $('#closeAdminSidebarBtn, #adminSidebarOverlay').on('click', function () {
      $('#adminSidebar').removeClass('show');
      $('#adminSidebarOverlay').removeClass('show');
    });
  }

  // ─────────────────────────────────────────────────────
  // Socket.io — admin room connection (shared across all admin pages)
  // ─────────────────────────────────────────────────────
  let adminSocket = null;

  function initAdminSocket() {
    if (typeof io === 'undefined') return null;

    adminSocket = io({ withCredentials: true });
    const user = TokenStore.getUser();

    adminSocket.on('connect', () => {
      if (user) adminSocket.emit('join-admin-room', user.id);
      $('#liveStatusDot').addClass('connected');
      $('#liveStatusText').text('Live updates active');
    });

    adminSocket.on('disconnect', () => {
      $('#liveStatusDot').removeClass('connected');
      $('#liveStatusText').text('Reconnecting...');
    });

    return adminSocket;
  }

  // ─────────────────────────────────────────────────────
  // Reusable Chart.js theme defaults
  // ─────────────────────────────────────────────────────
  const chartColors = {
    primary: '#2c3e50',
    accent: '#e67e22',
    success: '#27ae60',
    danger: '#e74c3c',
    warning: '#f39c12',
    info: '#3498db',
    purple: '#9b59b6',
    teal: '#16a085',
    gridLine: '#f0f0f0',
    palette: ['#2c3e50', '#e67e22', '#3498db', '#27ae60', '#9b59b6', '#16a085', '#f39c12', '#e74c3c']
  };

  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Poppins', sans-serif";
    Chart.defaults.color = '#666';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
  }

  const esc = (str) => {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  };

  // ═══════════════════════════════════════════════════════
  // DASHBOARD PAGE LOGIC
  // ═══════════════════════════════════════════════════════
  const DashboardPage = {
    charts: {},
    dateRangeDays: 30,

    init() {
      if (!guardAdminAccess()) return;

      initSidebarToggle();
      adminSocket = initAdminSocket();

      this.loadSummary();
      this.loadRevenueChart();
      this.loadOrderStatusChart();
      this.loadCategoryRevenueChart();
      this.loadTopBooks();
      this.loadRecentActivity();
      this.loadLowStock();
      this.bindEvents();
      this.bindSocketEvents();
    },

    bindEvents() {
      const self = this;
      $('#dateRangeSelect').on('change', function () {
        self.dateRangeDays = parseInt($(this).val(), 10);
        self.loadRevenueChart();
      });
    },

    // ── Summary Cards ──
    loadSummary() {
      Api.get('/admin/dashboard/summary')
        .done((res) => {
          const { revenue, orders, catalog, users } = res.data;

          $('#statTotalRevenue').removeClass('skeleton').text(formatCurrency(revenue.total));
          $('#statTotalOrders').text(orders.total.toLocaleString());
          $('#statPendingOrders').text(`${orders.pending} pending`);
          $('#statTotalBooks').text(catalog.totalBooks.toLocaleString());
          $('#statTotalUsers').text(users.totalCustomers.toLocaleString());

          const $trend = $('#statRevenueTrend');
          if (revenue.monthGrowthPercent !== 0) {
            const isUp = revenue.monthGrowthPercent > 0;
            $trend
              .removeClass('up down')
              .addClass(isUp ? 'up' : 'down')
              .html(
                `<i class="bi bi-arrow-${isUp ? 'up' : 'down'}-short"></i> ${Math.abs(revenue.monthGrowthPercent)}% this month`
              );
          } else {
            $trend.text('No change this month');
          }

          // Sidebar pending-orders badge
          if (orders.pending > 0) {
            $('#sidebarPendingOrdersBadge').removeClass('d-none').text(orders.pending);
          }

          // Stock alert banner
          const alertCount = catalog.lowStockCount + catalog.outOfStockCount;
          if (alertCount > 0) {
            $('#stockAlertBanner').removeClass('d-none');
            $('#stockAlertText').text(
              `${catalog.outOfStockCount} book(s) out of stock, ${catalog.lowStockCount} running low.`
            );
          }
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    // ── Revenue Line Chart ──
    loadRevenueChart() {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - this.dateRangeDays * 24 * 60 * 60 * 1000);

      Api.get('/admin/analytics/sales', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      })
        .done((res) => {
          const { dailyBreakdown, summary } = res.data;

          $('#chartSummaryText').text(
            `${formatCurrency(summary.totalSales)} total • ${summary.totalOrders} orders • ${formatCurrency(summary.averageOrderValue)} avg order`
          );

          const labels = dailyBreakdown.map((d) =>
            new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          );
          const salesData = dailyBreakdown.map((d) => d.totalSales);

          this.renderRevenueChart(labels, salesData);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    renderRevenueChart(labels, data) {
      const ctx = document.getElementById('revenueChart');
      if (!ctx) return;

      if (this.charts.revenue) {
        this.charts.revenue.data.labels = labels;
        this.charts.revenue.data.datasets[0].data = data;
        this.charts.revenue.update();
        return;
      }

      const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
      gradient.addColorStop(0, 'rgba(230, 126, 34, 0.25)');
      gradient.addColorStop(1, 'rgba(230, 126, 34, 0)');

      this.charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Revenue',
              data,
              borderColor: chartColors.accent,
              backgroundColor: gradient,
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: chartColors.accent
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => 'Revenue: ' + formatCurrency(ctx.parsed.y)
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              grid: { color: chartColors.gridLine },
              ticks: { callback: (val) => '৳' + val }
            }
          }
        }
      });
    },

    // ── Order Status Doughnut Chart ──
    loadOrderStatusChart() {
      Api.get('/admin/analytics/order-status-distribution')
        .done((res) => {
          const distribution = res.data.distribution || [];
          this.renderOrderStatusChart(distribution);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    renderOrderStatusChart(distribution) {
      const ctx = document.getElementById('orderStatusChart');
      if (!ctx) return;

      const statusColorMap = {
        pending: chartColors.warning,
        confirmed: chartColors.info,
        processing: chartColors.purple,
        shipped: chartColors.teal,
        delivered: chartColors.success,
        cancelled: chartColors.danger
      };

      const labels = distribution.map((d) => d.status.charAt(0).toUpperCase() + d.status.slice(1));
      const data = distribution.map((d) => d.count);
      const colors = distribution.map((d) => statusColorMap[d.status] || '#ccc');

      if (this.charts.orderStatus) {
        this.charts.orderStatus.data.labels = labels;
        this.charts.orderStatus.data.datasets[0].data = data;
        this.charts.orderStatus.data.datasets[0].backgroundColor = colors;
        this.charts.orderStatus.update();
        return;
      }

      this.charts.orderStatus = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } }
          }
        }
      });
    },

    // ── Revenue by Category Bar Chart ──
    loadCategoryRevenueChart() {
      Api.get('/admin/analytics/revenue-by-category')
        .done((res) => {
          const data = (res.data.revenueByCategory || []).slice(0, 8);
          this.renderCategoryRevenueChart(data);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    renderCategoryRevenueChart(data) {
      const ctx = document.getElementById('categoryRevenueChart');
      if (!ctx) return;

      const labels = data.map((d) => d.categoryName);
      const values = data.map((d) => d.revenue);

      if (this.charts.categoryRevenue) {
        this.charts.categoryRevenue.data.labels = labels;
        this.charts.categoryRevenue.data.datasets[0].data = values;
        this.charts.categoryRevenue.update();
        return;
      }

      this.charts.categoryRevenue = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Revenue',
              data: values,
              backgroundColor: chartColors.primary,
              borderRadius: 6,
              maxBarThickness: 36
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatCurrency(ctx.parsed.x) } }
          },
          scales: {
            x: { grid: { color: chartColors.gridLine }, ticks: { callback: (val) => '৳' + val } },
            y: { grid: { display: false } }
          }
        }
      });
    },

    // ── Top Selling Books List ──
    loadTopBooks() {
      Api.get('/admin/analytics/top-books', { limit: 5 })
        .done((res) => {
          const books = res.data.topBooks || [];

          if (books.length === 0) {
            $('#topBooksList').html('<p class="small text-muted text-center py-3 mb-0">No sales data yet</p>');
            return;
          }

          const html = books
            .map((book, i) => {
              const img = book.images && book.images.length ? book.images[0].url : '/images/book-placeholder.png';
              return `
              <div class="d-flex align-items-center gap-3 py-2 ${i < books.length - 1 ? 'border-bottom' : ''}">
                <span class="fw-bold text-muted" style="width: 20px;">${i + 1}</span>
                <img src="${img}" alt="${esc(book.title)}" style="width: 36px; height: 48px; object-fit: cover; border-radius: 4px;" />
                <div class="flex-grow-1 min-width-0">
                  <div class="small fw-semibold text-truncate">${esc(book.title)}</div>
                  <div class="small text-muted">${book.soldCount} sold • ${formatCurrency(book.discountPrice != null ? book.discountPrice : book.price)}</div>
                </div>
              </div>`;
            })
            .join('');

          $('#topBooksList').html(html);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    // ── Recent Orders Activity Feed ──
    loadRecentActivity() {
      Api.get('/admin/dashboard/recent-activity')
        .done((res) => {
          const orders = res.data.recentOrders || [];
          this.renderRecentOrders(orders);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    renderRecentOrders(orders) {
      if (orders.length === 0) {
        $('#recentOrdersFeed').html('<p class="small text-muted text-center py-3 mb-0">No orders yet</p>');
        return;
      }

      const statusIconMap = {
        pending: { icon: 'clock-history', bg: '#fef5e7', color: '#f39c12' },
        confirmed: { icon: 'check2-circle', bg: '#eaf4fc', color: '#3498db' },
        processing: { icon: 'gear', bg: '#f4ecf7', color: '#9b59b6' },
        shipped: { icon: 'truck', bg: '#e8f8f5', color: '#16a085' },
        delivered: { icon: 'check-circle-fill', bg: '#eafaf1', color: '#27ae60' },
        cancelled: { icon: 'x-circle-fill', bg: '#fdedec', color: '#e74c3c' }
      };

      const html = orders
        .map((order) => {
          const s = statusIconMap[order.status] || statusIconMap.pending;
          return `
          <div class="activity-feed-item" data-order-id="${order._id}">
            <div class="activity-feed-icon" style="background: ${s.bg}; color: ${s.color};">
              <i class="bi bi-${s.icon}"></i>
            </div>
            <div class="flex-grow-1 min-width-0">
              <div class="small">
                <strong>${esc(order.orderNumber)}</strong> by ${esc(order.user ? order.user.name : 'Guest')}
              </div>
              <div class="small text-muted">${formatCurrency(order.totalPrice)} • ${formatDate(order.createdAt)}</div>
            </div>
            <a href="/admin/orders?highlight=${order._id}" class="btn btn-sm btn-link p-0"><i class="bi bi-arrow-right"></i></a>
          </div>`;
        })
        .join('');

      $('#recentOrdersFeed').html(html);
    },

    // ── Low Stock List ──
    loadLowStock() {
      Api.get('/admin/inventory/low-stock')
        .done((res) => {
          const books = res.data.books || [];

          if (books.length === 0) {
            $('#lowStockList').html('<p class="small text-muted text-center py-3 mb-0">All books are well stocked 🎉</p>');
            return;
          }

          const html = books
            .slice(0, 6)
            .map((book) => {
              const img = book.images && book.images.length ? book.images[0].url : '/images/book-placeholder.png';
              return `
              <div class="stock-alert-row">
                <img src="${img}" alt="${esc(book.title)}" />
                <div class="flex-grow-1 min-width-0">
                  <div class="small fw-semibold text-truncate">${esc(book.title)}</div>
                  <div class="small text-muted">${book.category ? esc(book.category.name) : ''}</div>
                </div>
                <span class="badge bg-warning text-dark">${book.stock} left</span>
              </div>`;
            })
            .join('');

          $('#lowStockList').html(html);
        })
        .fail((jqXHR) => Toast.error(extractErrorMessage(jqXHR)));
    },

    // ── Real-time: new order notification ──
    bindSocketEvents() {
      if (!adminSocket) return;

      adminSocket.on('new-order', (data) => {
        // Toast notification
        Toast.success(`🎉 New order ${data.orderNumber} from ${data.customerName} — ${formatCurrency(data.totalPrice)}`, 6000);

        // Play a subtle notification sound (optional, silently ignored if blocked by browser autoplay policy)
        this.playNotificationSound();

        // Prepend to recent activity feed live
        const newItemHtml = `
          <div class="activity-feed-item new-order-flash" data-order-id="${data.orderId}">
            <div class="activity-feed-icon" style="background: #fef5e7; color: #f39c12;">
              <i class="bi bi-clock-history"></i>
            </div>
            <div class="flex-grow-1 min-width-0">
              <div class="small"><strong>${esc(data.orderNumber)}</strong> by ${esc(data.customerName)}</div>
              <div class="small text-muted">${formatCurrency(data.totalPrice)} • Just now</div>
            </div>
            <a href="/admin/orders?highlight=${data.orderId}" class="btn btn-sm btn-link p-0"><i class="bi bi-arrow-right"></i></a>
          </div>`;

        $('#recentOrdersFeed').prepend(newItemHtml);
        $('#recentOrdersFeed .activity-feed-item').slice(6).remove();

        // Refresh summary stat cards + sidebar pending badge to reflect the new order
        this.loadSummary();
        this.loadRevenueChart();
        this.loadOrderStatusChart();
      });

      // Stock updates also matter to admins (e.g., placed by another admin/order elsewhere)
      adminSocket.on('stock-update', () => {
        this.loadLowStock();
      });
    },

    playNotificationSound() {
      try {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.4;
        audio.play().catch(() => {
          /* Autoplay blocked — silently ignore, the toast is the primary signal */
        });
      } catch (e) {
        /* no-op */
      }
    }
  };

  // ─────────────────────────────────────────────────────
  // Expose AdminCore for future admin pages (Step 16+) to reuse
  // ─────────────────────────────────────────────────────
  window.AdminCore = {
    guardAdminAccess,
    initSidebarToggle,
    initAdminSocket,
    getAdminSocket: () => adminSocket,
    chartColors,
    esc
  };

  // ─────────────────────────────────────────────────────
  // Page router
  // ─────────────────────────────────────────────────────
  $(function () {
    if ($('#statCardsRow').length) {
      DashboardPage.init();
    } else if ($('#adminGuard').length) {
      // Any other admin page that just needs the guard + sidebar + socket
      if (guardAdminAccess()) {
        initSidebarToggle();
        adminSocket = initAdminSocket();
      }
    }
  });
})(window, jQuery);