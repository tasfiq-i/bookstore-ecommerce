const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');

const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ─── View Engine ─────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

// ─── Security Middleware ─────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false // relaxed for CDN-hosted Bootstrap/jQuery/Socket.io client
  })
);
app.use(mongoSanitize()); // strips $ and . from req.body/query/params to prevent NoSQL injection
app.use(xss()); // sanitizes user input from malicious HTML/JS

// CORS setup with fallback for local development
const allowedOrigin = process.env.CLIENT_URL || 'http://localhost:5000';
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true
  })
);

// ─── Rate Limiting ────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts. Please try again in 15 minutes.' }
});

const guestOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many guest orders from this device. Please try again later.' }
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/orders/guest', guestOrderLimiter);

// ─── Body Parsing & Compression ──────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression());
app.use(methodOverride('_method'));

// ─── Logging ──────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── API Routes ────────────────────────────────────────
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/books', require('./routes/bookRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/authors', require('./routes/authorRoutes'));
app.use('/api/publishers', require('./routes/publisherRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// ─── Health Check (for Render/deployment monitoring) ──
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is healthy', timestamp: new Date() });
});

// ─── View Routes (server-rendered pages) ──────────────
app.get('/', (req, res) => res.render('index', { title: 'Home' }));
app.get('/login', (req, res) => res.render('auth/login', { title: 'Login' }));
app.get('/register', (req, res) => res.render('auth/register', { title: 'Register' }));
app.get('/books', (req, res) => res.render('books/catalog', { title: 'Book Catalog' }));
app.get('/books/:slug', (req, res) => res.render('books/details', { title: 'Book Details', slug: req.params.slug }));
app.get('/cart', (req, res) => res.render('cart/cart', { title: 'Your Cart' }));
app.get('/checkout', (req, res) => res.render('checkout/checkout', { title: 'Checkout' }));
app.get('/order-confirmation', (req, res) => {
  const { orderNumber, email } = req.query;

  // Guard: if someone lands here without the required query params,
  // send them somewhere useful instead of rendering a broken page
  if (!orderNumber) {
    return res.redirect('/books');
  }

  res.render('checkout/order-confirmation', {
    title: 'Order Confirmed',
    orderNumber,
    email: email || null
  });
});

app.get('/profile', (req, res) => res.render('user/profile', { title: 'My Profile' }));
app.get('/orders', (req, res) => res.render('user/orders', { title: 'My Orders' }));
app.get('/orders/:id', (req, res) => res.render('user/order-detail', { title: 'Order Details', orderId: req.params.id }));
app.get('/admin', (req, res) => res.render('admin/dashboard', { title: 'Admin Dashboard' }));
app.get('/admin/books', (req, res) => res.render('admin/books', { title: 'Manage Books' }));
app.get('/admin/categories', (req, res) => res.render('admin/categories', { title: 'Manage Categories' }));
app.get('/admin/authors', (req, res) => res.render('admin/authors', { title: 'Manage Authors' }));
app.get('/admin/publishers', (req, res) => res.render('admin/publishers', { title: 'Manage Publishers' }));
app.get('/admin/orders', (req, res) => res.render('admin/orders', { title: 'Manage Orders' }));
app.get('/admin/coupons', (req, res) => res.render('admin/coupons', { title: 'Manage Coupons' }));
app.get('/admin/users', (req, res) => res.render('admin/users', { title: 'Manage Users' }));

// ─── 404 + Global Error Handler (must be last) ────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;