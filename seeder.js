/* ═══════════════════════════════════════════════════════
   BookStore — Database Seeder
   Creates the initial admin account and sample catalog data.
   Safe to re-run: checks for existing records before inserting.

   Usage:
     node seeder.js          → seed data
     node seeder.js -d       → destroy (wipe) seeded data
   ═══════════════════════════════════════════════════════ */

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');

const User = require('./models/User');
const Category = require('./models/Category');
const Author = require('./models/Author');
const Publisher = require('./models/Publisher');
const Book = require('./models/Book');

// ─────────────────────────────────────────────────────
// Guard: required env vars
// ─────────────────────────────────────────────────────
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI is not defined in your .env file. Aborting.');
  process.exit(1);
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bookstore.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

// ─────────────────────────────────────────────────────
// Sample data definitions
// ─────────────────────────────────────────────────────
const sampleCategories = [
  { name: 'Fiction', description: 'Novels, short stories, and imaginative literature.' },
  { name: 'Non-Fiction', description: 'Real-world knowledge, biographies, and essays.' },
  { name: 'Science & Technology', description: 'Books on science, computing, and innovation.' },
  { name: 'Self-Help', description: 'Personal growth, productivity, and motivation.' }
];

const sampleAuthors = [
  { name: 'George Orwell', bio: 'English novelist and essayist, known for dystopian fiction.', nationality: 'British' },
  { name: 'Isaac Asimov', bio: 'Prolific science fiction writer and biochemist.', nationality: 'American' },
  { name: 'James Clear', bio: 'Author and speaker focused on habits and self-improvement.', nationality: 'American' }
];

const samplePublishers = [
  { name: 'Penguin Books', description: 'A leading publisher of literary fiction and non-fiction.', establishedYear: 1935 },
  { name: 'HarperCollins', description: 'One of the largest publishing companies in the world.', establishedYear: 1817 }
];

// Books reference authors/categories/publishers by name — resolved to real
// ObjectIds after those documents are created below.
const sampleBooks = [
  {
    title: '1984',
    isbn: '9780451524935',
    description:
      'A dystopian social science fiction novel that follows the life of Winston Smith in a totalitarian society ruled by Big Brother.',
    categoryName: 'Fiction',
    authorName: 'George Orwell',
    publisherName: 'Penguin Books',
    price: 450,
    discountPrice: 380,
    stock: 25,
    lowStockThreshold: 5,
    language: 'English',
    pages: 328,
    format: 'Paperback',
    tags: ['dystopian', 'classic', 'political fiction'],
    isFeatured: true,
    images: [{ url: 'https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg', publicId: 'seed/1984' }]
  },
  {
    title: 'Animal Farm',
    isbn: '9780451526342',
    description:
      'An allegorical novella reflecting events leading up to the Russian Revolution and the Stalinist era of the Soviet Union.',
    categoryName: 'Fiction',
    authorName: 'George Orwell',
    publisherName: 'Penguin Books',
    price: 350,
    stock: 18,
    lowStockThreshold: 5,
    language: 'English',
    pages: 112,
    format: 'Paperback',
    tags: ['allegory', 'classic', 'political satire'],
    isFeatured: false,
    images: [{ url: 'https://covers.openlibrary.org/b/isbn/9780451526342-L.jpg', publicId: 'seed/animal-farm' }]
  },
  {
    title: 'Foundation',
    isbn: '9780553293357',
    description:
      'The first novel in the Foundation series, chronicling the fall and rebirth of a galactic empire through the science of psychohistory.',
    categoryName: 'Science & Technology',
    authorName: 'Isaac Asimov',
    publisherName: 'HarperCollins',
    price: 520,
    stock: 4,
    lowStockThreshold: 5,
    language: 'English',
    pages: 255,
    format: 'Hardcover',
    tags: ['science fiction', 'space opera', 'classic'],
    isFeatured: true,
    images: [{ url: 'https://covers.openlibrary.org/b/isbn/9780553293357-L.jpg', publicId: 'seed/foundation' }]
  },
  {
    title: 'Atomic Habits',
    isbn: '9780735211292',
    description:
      'A comprehensive guide to building good habits and breaking bad ones, using proven strategies grounded in behavioral science.',
    categoryName: 'Self-Help',
    authorName: 'James Clear',
    publisherName: 'Penguin Books',
    price: 650,
    discountPrice: 549,
    stock: 0,
    lowStockThreshold: 5,
    language: 'English',
    pages: 320,
    format: 'Paperback',
    tags: ['habits', 'productivity', 'self-improvement'],
    isFeatured: true,
    images: [{ url: 'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg', publicId: 'seed/atomic-habits' }]
  }
];

// ─────────────────────────────────────────────────────
// Connect
// ─────────────────────────────────────────────────────
const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB: ${mongoose.connection.host}`);
};

// ─────────────────────────────────────────────────────
// Seed: Admin User
// ─────────────────────────────────────────────────────
const seedAdmin = async () => {
  const existingAdmin = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });

  if (existingAdmin) {
    console.log(`ℹ️  Admin user already exists (${ADMIN_EMAIL}) — skipping creation.`);
    return existingAdmin;
  }

  // Plain password passed here — User model's pre('save') hook (Step 2)
  // handles bcrypt hashing automatically. Never hash manually here, or
  // the password will be double-hashed and login will fail.
  const admin = await User.create({
    name: 'Store Administrator',
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: 'admin',
    isActive: true
  });

  console.log(`✅ Admin user created successfully`);
  console.log(`   📧 Email:    ${ADMIN_EMAIL}`);
  console.log(`   🔑 Password: ${ADMIN_PASSWORD}`);
  console.log(`   ⚠️  Please log in and change this password immediately in production.`);

  return admin;
};

// ─────────────────────────────────────────────────────
// Seed: Categories / Authors / Publishers (idempotent upserts)
// ─────────────────────────────────────────────────────
const seedTaxonomy = async () => {
  const categoryMap = {};
  const authorMap = {};
  const publisherMap = {};

  for (const cat of sampleCategories) {
    let doc = await Category.findOne({ name: cat.name });
    if (!doc) {
      doc = await Category.create(cat);
      console.log(`✅ Category created: ${cat.name}`);
    } else {
      console.log(`ℹ️  Category already exists: ${cat.name} — skipping.`);
    }
    categoryMap[cat.name] = doc._id;
  }

  for (const author of sampleAuthors) {
    let doc = await Author.findOne({ name: author.name });
    if (!doc) {
      doc = await Author.create(author);
      console.log(`✅ Author created: ${author.name}`);
    } else {
      console.log(`ℹ️  Author already exists: ${author.name} — skipping.`);
    }
    authorMap[author.name] = doc._id;
  }

  for (const publisher of samplePublishers) {
    let doc = await Publisher.findOne({ name: publisher.name });
    if (!doc) {
      doc = await Publisher.create(publisher);
      console.log(`✅ Publisher created: ${publisher.name}`);
    } else {
      console.log(`ℹ️  Publisher already exists: ${publisher.name} — skipping.`);
    }
    publisherMap[publisher.name] = doc._id;
  }

  return { categoryMap, authorMap, publisherMap };
};

// ─────────────────────────────────────────────────────
// Seed: Sample Books
// ─────────────────────────────────────────────────────
const seedBooks = async ({ categoryMap, authorMap, publisherMap }) => {
  for (const bookData of sampleBooks) {
    const existing = await Book.findOne({ isbn: bookData.isbn });

    if (existing) {
      console.log(`ℹ️  Book already exists: "${bookData.title}" — skipping.`);
      continue;
    }

    const { categoryName, authorName, publisherName, ...rest } = bookData;

    await Book.create({
      ...rest,
      category: categoryMap[categoryName],
      author: authorMap[authorName],
      publisher: publisherMap[publisherName]
    });

    console.log(`✅ Book created: "${bookData.title}" (stock: ${bookData.stock})`);
  }
};

// ─────────────────────────────────────────────────────
// Destroy: wipe seeded data (run with `node seeder.js -d`)
// ─────────────────────────────────────────────────────
const destroyData = async () => {
  await Promise.all([
    Book.deleteMany({}),
    Category.deleteMany({}),
    Author.deleteMany({}),
    Publisher.deleteMany({}),
    User.deleteMany({ role: 'admin' })
  ]);

  console.log('🗑️  All seeded data destroyed successfully.');
};

// ─────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────
const run = async () => {
  try {
    await connectDB();

    if (process.argv.includes('-d')) {
      await destroyData();
      await mongoose.disconnect();
      console.log('🔌 Disconnected from MongoDB.');
      process.exit(0);
    }

    console.log('🌱 Starting database seed...\n');

    await seedAdmin();
    const maps = await seedTaxonomy();
    await seedBooks(maps);

    console.log('\n🎉 Seeding completed successfully!');

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    console.error(error.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

run();
