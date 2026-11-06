'use strict';
/**
 * Seed script — creates a realistic, fully-stocked demo restaurant.
 * Run: npm run seed  (forces a clean reseed)
 */
const bcrypt = require('bcryptjs');
const {
  db, all, get, run, exec, transaction, now, nextPurchaseNumber, setSetting
} = require('./db');
const { calculateTotals, round } = require('./lib/orders');

// Deterministic PRNG so demo data is stable between seeds
let seedState = 20261102;
function rand() {
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const p2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const dateFmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

const IMG = (name) => `/assets/images/${name}.jpg`;

function wipe() {
  const tables = [
    'order_items', 'invoices', 'orders', 'addresses', 'customers', 'inventory_transactions',
    'purchase_items', 'purchases', 'expenses', 'recipes', 'ingredients', 'suppliers',
    'product_addons', 'addons', 'products', 'categories', 'reservations', 'dining_tables',
    'testimonials', 'gallery', 'faqs', 'contact_messages', 'coupons'
  ];
  exec('PRAGMA foreign_keys = OFF;');
  for (const t of tables) exec(`DELETE FROM ${t};`);
  exec(`DELETE FROM users;`);
  exec(`DELETE FROM sqlite_sequence;`);
  exec('PRAGMA foreign_keys = ON;');
}

function seed() {
  console.log('  → Cleaning existing data…');
  wipe();

  // ─────────────────────────── CATEGORIES ───────────────────────────
  const categories = [
    ['Starters', 'starters', 'Small plates to begin the journey', 'samosa', 1],
    ['Main Course', 'main-course', 'Signature curries, grills and biryanis', 'curry', 2],
    ['Burgers', 'burgers', 'Hand-pressed patties on toasted brioche', 'burger-classic', 3],
    ['Pizza', 'pizza', 'Stone-baked with 48-hour fermented dough', 'pizza-margherita', 4],
    ['BBQ & Grill', 'bbq-grill', 'Live-fire charcoal specialities', 'bbq-platter', 5],
    ['Pasta', 'pasta', 'Fresh pasta, made in-house daily', 'pasta-alfredo', 6],
    ['Desserts', 'desserts', 'Sweet finishes from our pastry kitchen', 'dessert-lava', 7],
    ['Beverages', 'beverages', 'Barista coffee, coolers and lassi', 'coffee-latte', 8]
  ];
  const catId = {};
  categories.forEach(([name, slug, desc, image, sort], i) => {
    const r = run('INSERT INTO categories (name, slug, description, image, sort_order) VALUES (?,?,?,?,?)',
      name, slug, desc, IMG(image), sort);
    catId[slug] = r.lastInsertRowid;
  });

  // ─────────────────────────── PRODUCTS ───────────────────────────
  const products = [
    // Starters
    { cat: 'starters', name: 'Samosa Trio', price: 550, img: 'samosa', veg: 1, prep: 10, cal: 320,
      short: 'Crisp golden pastry with spiced potato, peas and mint chutney.',
      long: 'Three hand-folded samosas filled with Punjab potatoes, sweet peas and roasted cumin, served with tamarind chutney and cooling mint yogurt.' },
    { cat: 'starters', name: 'Loaded Masala Fries', price: 650, img: 'fries', veg: 1, prep: 12, cal: 540,
      short: 'Hand-cut fries, cheese sauce, jalapeños and chaat masala.',
      long: 'Twice-cooked hand-cut fries smothered in aged cheddar sauce, pickled jalapeños, spring onion and a dusting of our house chaat masala.' },
    { cat: 'starters', name: 'Charcoal Buffalo Wings', price: 850, img: 'wings', prep: 18, cal: 620,
      short: 'Six wings tossed in smoky buffalo glaze with blue cheese dip.',
      long: 'Marinated overnight, grilled over charcoal and tossed in a smoky buffalo butter glaze. Served with blue cheese dip and celery.' },
    { cat: 'starters', name: 'Roasted Tomato Soup', price: 480, img: 'soup-tomato', veg: 1, prep: 10, cal: 210,
      short: 'Slow-roasted tomatoes, basil cream and garlic croutons.',
      long: 'Vine-ripened tomatoes roasted with garlic and thyme, blended silky smooth with a touch of cream and finished with basil oil.' },
    { cat: 'starters', name: 'Caesar Salad', price: 750, img: 'salad-caesar', prep: 10, cal: 360,
      short: 'Cos lettuce, parmesan, herb croutons and house Caesar dressing.',
      long: 'Crisp cos leaves tossed in a classic anchovy-free Caesar dressing with shaved parmesan, herb croutons and grilled chicken on request.' },
    { cat: 'starters', name: 'Hummus & Warm Naan', price: 620, img: 'bowl', veg: 1, prep: 8, cal: 390,
      short: 'Silky chickpea hummus, olive oil and fresh tandoori naan.',
      long: 'Creamy chickpea hummus with tahini, lemon and roasted garlic, drizzled with olive oil and served with warm tandoori naan.' },
    // Main Course
    { cat: 'main-course', name: 'Prime Ribeye Steak', price: 3650, img: 'steak-ribeye', prep: 25, cal: 820, featured: 1, popular: 1,
      short: '280g grass-fed ribeye, garlic butter, truffle mash and jus.',
      long: 'A 280g prime ribeye, dry-aged for 21 days and char-grilled to your preference. Served with truffle potato mash, roasted vine tomatoes and red wine jus.' },
    { cat: 'main-course', name: 'Fillet Mignon', price: 3950, img: 'steak-fillet', prep: 25, cal: 690, featured: 1,
      short: '220g tenderloin, peppercorn sauce and pommes purée.',
      long: 'The most tender cut, seared in cast iron and finished with a green peppercorn cream. Accompanied by silky pommes purée and seasonal greens.' },
    { cat: 'main-course', name: 'Grilled Atlantic Salmon', price: 2850, img: 'salmon', prep: 20, cal: 540, recommended: 1,
      short: 'Lemon-herb salmon, asparagus and saffron beurre blanc.',
      long: 'Atlantic salmon fillet pan-seared skin-side down, served with grilled asparagus, baby potatoes and a delicate saffron beurre blanc.' },
    { cat: 'main-course', name: 'Chicken Karahi', price: 2250, img: 'curry', prep: 25, cal: 610, popular: 1,
      short: 'Tomato, ginger and green chilli karahi — a Lahore classic.',
      long: 'Free-range chicken cooked to order in a traditional black iron karahi with vine tomatoes, ginger juliennes, green chillies and our hand-ground masala.' },
    { cat: 'main-course', name: 'Saffron Chicken Biryani', price: 1950, img: 'biryani', prep: 25, cal: 720, featured: 1, popular: 1,
      short: 'Aged basmati, saffron, caramelised onion and raita.',
      long: 'Aged basmati rice layered with marinated chicken, saffron milk, fried onions and whole spices, then sealed and dum-cooked. Served with cucumber raita.' },
    { cat: 'main-course', name: 'Butter Chicken', price: 2150, img: 'chicken-grill', prep: 22, cal: 680, recommended: 1,
      short: 'Tandoori chicken in a velvety tomato-fenugreek makhani.',
      long: 'Charcoal-kissed tandoori chicken folded through a slow-simmered makhani sauce with butter, cream and dried fenugreek.' },
    { cat: 'main-course', name: 'Slow-Cooked Nihari', price: 2450, img: 'curry', prep: 30, cal: 750, recommended: 1,
      short: 'Eight-hour beef nihari with bone marrow and ginger.',
      long: 'Beef shank braised for eight hours with nihari masala, bone marrow and wheat flour until meltingly tender. Finished with ginger, green chilli and lemon.' },
    { cat: 'main-course', name: 'Charcoal Chicken Platter', price: 2350, img: 'chicken-grill', prep: 28, cal: 700,
      short: 'Half spring chicken, spiced rice, salad and mint chutney.',
      long: 'Half spring chicken marinated in yogurt and charred over live coals, served with aromatic spiced rice, kachumber salad and mint chutney.' },
    // Burgers
    { cat: 'burgers', name: 'Saffron Signature Burger', price: 1650, img: 'burger-classic', prep: 18, cal: 780, featured: 1, popular: 1, recommended: 1,
      short: '180g beef patty, aged cheddar, caramelised onion and house sauce.',
      long: 'Our flagship burger: a 180g hand-pressed beef patty, aged cheddar, caramelised onions, lettuce, tomato and secret saffron sauce in a toasted brioche bun.' },
    { cat: 'burgers', name: 'Smoky BBQ Bacon Burger', price: 1850, img: 'burger-smoky', prep: 20, cal: 860, popular: 1,
      short: 'Smoked beef bacon, BBQ glaze, crispy onions and cheddar.',
      long: 'A double-stacked beef patty with smoked beef bacon, aged cheddar, crispy onion rings and a molasses BBQ glaze.' },
    { cat: 'burgers', name: 'Crispy Chicken Burger', price: 1450, img: 'burger-chicken', prep: 16, cal: 710, popular: 1,
      short: 'Buttermilk chicken fillet, slaw and garlic mayo.',
      long: 'Buttermilk-marinated chicken thigh, double-dredged and fried until shatteringly crisp, with apple slaw and roasted garlic mayo.' },
    { cat: 'burgers', name: 'The Double Stack', price: 2150, img: 'burger-double', prep: 22, cal: 1050, recommended: 1,
      short: 'Two smashed patties, double cheese, pickles and mustard.',
      long: 'Two smashed beef patties with American cheese, house pickles, raw onion and yellow mustard on a potato bun. Simple. Serious.' },
    // Pizza
    { cat: 'pizza', name: 'Margherita Classica', price: 1550, img: 'pizza-margherita', veg: 1, prep: 18, cal: 890, popular: 1,
      short: 'San Marzano tomato, fior di latte and fresh basil.',
      long: 'Slow-proved 48-hour dough topped with San Marzano tomato, fior di latte mozzarella, fresh basil and extra virgin olive oil.' },
    { cat: 'pizza', name: 'Pepperoni Piccante', price: 1850, img: 'pizza-pepperoni', prep: 18, cal: 1020, featured: 1, popular: 1,
      short: 'Spicy pepperoni, mozzarella and chilli honey drizzle.',
      long: 'Generous rounds of spicy beef pepperoni over molten mozzarella, finished with a hot honey drizzle and oregano.' },
    { cat: 'pizza', name: 'Truffle Mushroom Pizza', price: 2250, img: 'pizza-truffle', veg: 1, prep: 20, cal: 940, recommended: 1,
      short: 'Wild mushrooms, truffle cream and parmesan.',
      long: 'Roasted wild mushrooms, caramelised onion and mozzarella on a truffle cream base, finished with shaved parmesan and chives.' },
    { cat: 'pizza', name: 'Garden Veggie Pizza', price: 1650, img: 'pizza-veggie', veg: 1, prep: 18, cal: 780,
      short: 'Roasted peppers, olives, tomato and feta.',
      long: 'A colourful medley of roasted peppers, olives, cherry tomatoes, red onion and feta over a light tomato base.' },
    // BBQ
    { cat: 'bbq-grill', name: 'Saffron Mixed Grill', price: 3450, img: 'bbq-platter', prep: 35, cal: 1100, featured: 1, popular: 1, recommended: 1,
      short: 'Seekh kebab, chicken tikka, lamb chop and grilled vegetables.',
      long: 'Our grand charcoal platter: beef seekh kebab, chicken tikka, a lamb chop, malai boti and grilled vegetables, with mint chutney and naan.' },
    { cat: 'bbq-grill', name: 'Charcoal Lamb Chops', price: 3250, img: 'bbq-chops', prep: 30, cal: 860, recommended: 1,
      short: 'Four chops marinated in papaya, yogurt and garam masala.',
      long: 'Four tender lamb chops marinated overnight in raw papaya, yogurt and garam masala, then charred over live coals.' },
    { cat: 'bbq-grill', name: 'Chicken Tikka', price: 1450, img: 'bbq-tikka', prep: 22, cal: 520, popular: 1,
      short: 'Quarter chicken leg, smoky tikka masala and lemon.',
      long: 'Quarter chicken leg marinated in spiced yogurt, scored and grilled over charcoal until juicy with a smoky char.' },
    { cat: 'bbq-grill', name: 'Beef Seekh Kebab', price: 1250, img: 'wings', prep: 20, cal: 480,
      short: 'Four hand-minced beef kebabs with mint chutney.',
      long: 'Hand-minced beef with green chilli, coriander and roasted spices, moulded on skewers and grilled over charcoal.' },
    { cat: 'bbq-grill', name: 'Malai Boti', price: 1350, img: 'chicken-grill', prep: 20, cal: 560, recommended: 1,
      short: 'Creamy chicken boti with cardamom and charred lemon.',
      long: 'Boneless chicken thigh in a cream, cheese and cardamom marinade, grilled gently and finished with charred lemon.' },
    // Pasta
    { cat: 'pasta', name: 'Fettuccine Alfredo', price: 1750, img: 'pasta-alfredo', veg: 1, prep: 18, cal: 820, popular: 1,
      short: 'Fresh fettuccine in parmesan cream with garlic bread.',
      long: 'House-made fettuccine tossed in a rich parmesan cream, finished with cracked pepper and served with garlic bread.' },
    { cat: 'pasta', name: 'Penne Arrabiata', price: 1550, img: 'pasta-arrabiata', veg: 1, prep: 16, cal: 610,
      short: 'Spicy tomato sauce, chilli, basil and parmesan.',
      long: 'Penne in a fiery San Marzano tomato sauce with chilli flakes, garlic, basil and a snow of parmesan.' },
    { cat: 'pasta', name: 'Seafood Linguine', price: 2350, img: 'pasta-seafood', prep: 22, cal: 680, recommended: 1,
      short: 'Prawns, squid, cherry tomato and white wine butter.',
      long: 'Linguine with tiger prawns, squid and mussels in a cherry tomato and white wine butter sauce, finished with parsley and lemon.' },
    // Desserts
    { cat: 'desserts', name: 'Molten Chocolate Lava Cake', price: 850, img: 'dessert-lava', veg: 1, prep: 15, cal: 540, featured: 1, popular: 1,
      short: 'Warm dark chocolate centre with vanilla gelato.',
      long: 'A warm valrhona chocolate cake with a molten centre, served with Madagascan vanilla gelato and berry coulis.' },
    { cat: 'desserts', name: 'New York Cheesecake', price: 750, img: 'dessert-cheesecake', veg: 1, prep: 5, cal: 480, recommended: 1,
      short: 'Baked vanilla cheesecake with berry compote.',
      long: 'Dense, creamy baked cheesecake on a buttery biscuit base, topped with a bright mixed berry compote.' },
    { cat: 'desserts', name: 'Chocolate Fudge Cake', price: 700, img: 'dessert-cake', veg: 1, prep: 5, cal: 520,
      short: 'Three layers of chocolate sponge and ganache.',
      long: 'Three layers of moist chocolate sponge layered with dark chocolate ganache and finished with cocoa nibs.' },
    { cat: 'desserts', name: 'Vanilla Bean Gelato', price: 450, img: 'dessert-icecream', veg: 1, prep: 3, cal: 280,
      short: 'Two scoops of Madagascan vanilla gelato.',
      long: 'Two generous scoops of slow-churned Madagascan vanilla bean gelato with a caramelised hazelnut crumble.' },
    // Beverages
    { cat: 'beverages', name: 'Signature Flat White', price: 550, img: 'coffee-latte', veg: 1, prep: 6, cal: 160, popular: 1,
      short: 'Double ristretto, velvety microfoam.',
      long: 'A double ristretto of our house espresso blend with silky steamed milk, served in a 6oz cup.' },
    { cat: 'beverages', name: 'Cappuccino', price: 520, img: 'coffee-cappuccino', veg: 1, prep: 6, cal: 150,
      short: 'Espresso, steamed milk and cocoa dust.',
      long: 'A classic cappuccino with equal parts espresso, steamed milk and foam, dusted with Dutch cocoa.' },
    { cat: 'beverages', name: 'Double Espresso', price: 420, img: 'coffee-espresso', veg: 1, prep: 4, cal: 5,
      short: 'Two shots of our seasonal house blend.',
      long: 'Two shots of our seasonal house blend — notes of dark chocolate, hazelnut and citrus.' },
    { cat: 'beverages', name: 'Mint Mojito Cooler', price: 490, img: 'drink-mojito', veg: 1, prep: 6, cal: 120, popular: 1,
      short: 'Fresh mint, lime, soda and crushed ice.',
      long: 'Fresh mint leaves muddled with lime and a touch of cane sugar, topped with soda and crushed ice. Zero alcohol.' },
    { cat: 'beverages', name: 'Fresh Lemonade', price: 390, img: 'drink-lemonade', veg: 1, prep: 5, cal: 110,
      short: 'Hand-squeezed lemons with a hint of rose.',
      long: 'Hand-squeezed lemons, a whisper of rose water and sparkling water over ice.' },
    { cat: 'beverages', name: 'Mango Lassi', price: 450, img: 'drink-lassi', veg: 1, prep: 5, cal: 240, feature: 1,
      short: 'Sindhri mango, thick yogurt and cardamom.',
      long: 'Thick set yogurt blended with Sindhri mango pulp, a pinch of cardamom and topped with pistachio.' }
  ];

  const productRows = [];
  const slugCount = {};
  for (const p of products) {
    let slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    slugCount[slug] = (slugCount[slug] || 0) + 1;
    if (slugCount[slug] > 1) slug += '-' + slugCount[slug];
    const r = run(
      `INSERT INTO products (name, slug, category_id, description, long_description, price, image,
        is_veg, is_featured, is_popular, is_recommended, prep_time, calories, rating)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      p.name, slug, catId[p.cat], p.short, p.long, p.price, IMG(p.img),
      p.veg ? 1 : 0, p.featured ? 1 : 0, p.popular ? 1 : 0, p.recommended ? 1 : 0,
      p.prep, p.cal, (4.4 + rand() * 0.5).toFixed(1)
    );
    productRows.push({ id: r.lastInsertRowid, ...p });
  }

  // ─────────────────────────── ADD-ONS ───────────────────────────
  const addons = [
    ['Extra Cheese', 150, 'Extras', 1], ['Extra Beef Patty', 350, 'Extras', 2],
    ['Beef Bacon', 250, 'Extras', 3], ['Fried Egg', 100, 'Extras', 4],
    ['Extra House Sauce', 80, 'Extras', 5], ['Garlic Mayo', 60, 'Extras', 6],
    ['Truffle Oil', 300, 'Extras', 7], ['Grilled Chicken', 350, 'Extras', 8],
    ['Extra Naan', 80, 'Sides', 9], ['Extra Raita', 100, 'Sides', 10],
    ['Sweet Potato Fries', 300, 'Sides', 11], ['Side Salad', 250, 'Sides', 12],
    ['Vanilla Gelato Scoop', 150, 'Desserts', 13], ['Whipped Cream', 80, 'Desserts', 14],
    ['Extra Espresso Shot', 100, 'Drinks', 15], ['Large Size', 150, 'Drinks', 16]
  ];
  const addonIds = addons.map(([name, price, group, sort]) =>
    run('INSERT INTO addons (name, price, group_name, sort_order) VALUES (?,?,?,?)', name, price, group, sort).lastInsertRowid
  );
  const addonIndex = Object.fromEntries(addons.map((a, i) => [a[0], addonIds[i]]));
  const catAddons = {
    burgers: ['Extra Cheese', 'Extra Beef Patty', 'Beef Bacon', 'Fried Egg', 'Extra House Sauce', 'Garlic Mayo', 'Sweet Potato Fries'],
    pizza: ['Extra Cheese', 'Beef Bacon', 'Truffle Oil', 'Grilled Chicken', 'Side Salad'],
    'main-course': ['Extra Naan', 'Extra Raita', 'Side Salad', 'Grilled Chicken'],
    'bbq-grill': ['Extra Naan', 'Extra Raita', 'Side Salad', 'Garlic Mayo'],
    pasta: ['Extra Cheese', 'Grilled Chicken', 'Side Salad', 'Garlic Mayo'],
    starters: ['Extra House Sauce', 'Garlic Mayo', 'Side Salad'],
    desserts: ['Vanilla Gelato Scoop', 'Whipped Cream'],
    beverages: ['Extra Espresso Shot', 'Large Size', 'Whipped Cream']
  };
  for (const p of productRows) {
    for (const a of catAddons[p.cat] || []) {
      run('INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?,?)', p.id, addonIndex[a]);
    }
  }

  // ─────────────────────────── SUPPLIERS ───────────────────────────
  const suppliers = [
    ['Punjab Fresh Foods', 'Imran Butt', '+92 300 8451122', 'orders@punjabfresh.pk', 'Badami Bagh Sabzi Mandi, Lahore', 0],
    ['Lahore Meat Company', 'Shahid Mehmood', '+92 321 7745001', 'sales@lahoremeat.pk', 'Hall Road, Lahore', 0],
    ['Dawn Dairy & Creams', 'Nadia Aslam', '+92 42 3512 8890', 'hello@dawndairy.pk', 'Multan Road, Lahore', 0],
    ['Al-Noor Beverages', 'Faisal Sheikh', '+92 333 9900123', 'faisal@alnoorbeverages.pk', 'Ravi Road, Lahore', 0],
    ['Golden Crust Bakery', 'Rabia Khan', '+92 301 6677889', 'orders@goldencrust.pk', 'Gulberg II, Lahore', 0],
    ['Spice Route Traders', 'Abdul Rehman', '+92 345 1122334', 'spiceroute@gmail.com', 'Akbari Mandi, Lahore', 0]
  ];
  const supplierIds = suppliers.map(([n, c, ph, em, ad, bal]) =>
    run('INSERT INTO suppliers (name, contact_person, phone, email, address, outstanding_balance) VALUES (?,?,?,?,?,?)',
      n, c, ph, em, ad, bal).lastInsertRowid
  );

  // ─────────────────────────── INGREDIENTS ───────────────────────────
  const ingredients = [
    ['Chicken Breast', 'kg', 48, 15, 1150, 1, 'Meat', 120],
    ['Chicken Thigh', 'kg', 32, 12, 950, 1, 'Meat', 90],
    ['Beef Mince', 'kg', 40, 15, 1650, 1, 'Meat', 140],
    ['Beef Steak', 'kg', 22, 8, 3800, 1, 'Meat', 160],
    ['Lamb Chops', 'kg', 14, 6, 4200, 1, 'Meat', 120],
    ['Salmon Fillet', 'kg', 2.5, 8, 5400, 1, 'Seafood', 60],
    ['Burger Buns', 'pcs', 18, 40, 85, 4, 'Bakery', 45],
    ['Pizza Dough', 'pcs', 55, 20, 120, 4, 'Bakery', 75],
    ['Naan Bread', 'pcs', 80, 30, 40, 4, 'Bakery', 60],
    ['Mozzarella Cheese', 'kg', 18, 8, 2200, 2, 'Dairy', 100],
    ['Cheddar Cheese', 'kg', 12, 5, 2500, 2, 'Dairy', 110],
    ['Butter', 'kg', 16, 6, 1850, 2, 'Dairy', 150],
    ['Cream', 'L', 20, 8, 900, 2, 'Dairy', 70],
    ['Milk', 'L', 60, 25, 260, 2, 'Dairy', 35],
    ['Basmati Rice', 'kg', 90, 30, 680, 5, 'Dry Goods', 300],
    ['Pasta', 'kg', 28, 10, 750, 5, 'Dry Goods', 240],
    ['Cooking Oil', 'L', 55, 20, 620, 5, 'Dry Goods', 210],
    ['Tomato Puree', 'kg', 35, 12, 480, 0, 'Pantry', 180],
    ['Tomatoes', 'kg', 42, 15, 180, 0, 'Produce', 14],
    ['Onions', 'kg', 65, 20, 120, 0, 'Produce', 90],
    ['Potatoes', 'kg', 70, 25, 95, 0, 'Produce', 120],
    ['Lettuce', 'kg', 8, 4, 320, 0, 'Produce', 8],
    ['Garlic', 'kg', 9, 3, 480, 0, 'Produce', 60],
    ['Sugar', 'kg', 30, 10, 145, 5, 'Pantry', 365],
    ['Coffee Beans', 'kg', 9, 4, 6800, 5, 'Beverages', 180],
    ['Chocolate', 'kg', 4, 10, 3200, 5, 'Pantry', 240],
    ['Saffron', 'g', 30, 100, 12, 5, 'Spices', 365],
    ['Spice Mix', 'kg', 22, 8, 1400, 5, 'Spices', 210],
    ['Yogurt', 'kg', 24, 10, 450, 2, 'Dairy', 21],
    ['Mango Pulp', 'L', 12, 5, 850, 3, 'Beverages', 90],
    ['Mint', 'kg', 3, 1.5, 300, 0, 'Produce', 4],
    ['Lemons', 'kg', 6, 2, 350, 0, 'Produce', 20],
    ['Eggs', 'pcs', 120, 60, 35, 0, 'Dairy', 25]
  ];
  const ingIds = {};
  for (const [name, unit, stock, min, price, supIdx, cat, expiryDays] of ingredients) {
    const expiry = new Date(); expiry.setDate(expiry.getDate() + expiryDays);
    const r = run(
      'INSERT INTO ingredients (name, unit, stock_qty, min_stock, purchase_price, supplier_id, category, expiry_date) VALUES (?,?,?,?,?,?,?,?)',
      name, unit, stock, min, price, supplierIds[supIdx] || null, cat, dateFmt(expiry)
    );
    ingIds[name] = r.lastInsertRowid;
    run('INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes) VALUES (?,?,?,?,?,?)',
      r.lastInsertRowid, 'opening', stock, price, 'OPENING', 'Opening stock balance');
  }

  // ─────────────────────────── RECIPES ───────────────────────────
  const recipeMap = {
    'Samosa Trio': [['Potatoes', 0.15], ['Onions', 0.05], ['Spice Mix', 0.01], ['Cooking Oil', 0.05]],
    'Loaded Masala Fries': [['Potatoes', 0.25], ['Cheddar Cheese', 0.04], ['Cooking Oil', 0.08], ['Spice Mix', 0.01]],
    'Charcoal Buffalo Wings': [['Chicken Thigh', 0.3], ['Butter', 0.03], ['Spice Mix', 0.02]],
    'Roasted Tomato Soup': [['Tomatoes', 0.3], ['Cream', 0.05], ['Garlic', 0.01], ['Butter', 0.02]],
    'Caesar Salad': [['Lettuce', 0.15], ['Cheddar Cheese', 0.03], ['Eggs', 1]],
    'Hummus & Warm Naan': [['Naan Bread', 2], ['Garlic', 0.02], ['Cooking Oil', 0.03]],
    'Prime Ribeye Steak': [['Beef Steak', 0.28], ['Butter', 0.04], ['Garlic', 0.01], ['Potatoes', 0.15]],
    'Fillet Mignon': [['Beef Steak', 0.22], ['Cream', 0.04], ['Butter', 0.03], ['Potatoes', 0.12]],
    'Grilled Atlantic Salmon': [['Salmon Fillet', 0.2], ['Butter', 0.03], ['Lemons', 0.03], ['Potatoes', 0.12]],
    'Chicken Karahi': [['Chicken Breast', 0.3], ['Tomatoes', 0.2], ['Onions', 0.08], ['Cooking Oil', 0.05], ['Spice Mix', 0.02]],
    'Saffron Chicken Biryani': [['Basmati Rice', 0.2], ['Chicken Thigh', 0.25], ['Yogurt', 0.05], ['Saffron', 0.2], ['Spice Mix', 0.02]],
    'Butter Chicken': [['Chicken Thigh', 0.28], ['Tomato Puree', 0.12], ['Cream', 0.06], ['Butter', 0.04], ['Spice Mix', 0.02]],
    'Slow-Cooked Nihari': [['Beef Steak', 0.3], ['Onions', 0.1], ['Spice Mix', 0.03], ['Cooking Oil', 0.04]],
    'Charcoal Chicken Platter': [['Chicken Breast', 0.35], ['Basmati Rice', 0.15], ['Yogurt', 0.05], ['Spice Mix', 0.02]],
    'Saffron Signature Burger': [['Beef Mince', 0.18], ['Burger Buns', 1], ['Cheddar Cheese', 0.03], ['Lettuce', 0.02], ['Tomatoes', 0.03]],
    'Smoky BBQ Bacon Burger': [['Beef Mince', 0.24], ['Burger Buns', 1], ['Cheddar Cheese', 0.04], ['Beef Mince', 0.02], ['Tomatoes', 0.03]],
    'Crispy Chicken Burger': [['Chicken Thigh', 0.2], ['Burger Buns', 1], ['Lettuce', 0.03], ['Cooking Oil', 0.08]],
    'The Double Stack': [['Beef Mince', 0.36], ['Burger Buns', 1], ['Cheddar Cheese', 0.06], ['Onions', 0.02]],
    'Margherita Classica': [['Pizza Dough', 1], ['Mozzarella Cheese', 0.12], ['Tomato Puree', 0.09]],
    'Pepperoni Piccante': [['Pizza Dough', 1], ['Mozzarella Cheese', 0.12], ['Beef Mince', 0.06], ['Tomato Puree', 0.09]],
    'Truffle Mushroom Pizza': [['Pizza Dough', 1], ['Mozzarella Cheese', 0.13], ['Cream', 0.05], ['Onions', 0.04]],
    'Garden Veggie Pizza': [['Pizza Dough', 1], ['Mozzarella Cheese', 0.11], ['Tomatoes', 0.06], ['Onions', 0.04], ['Lettuce', 0.02]],
    'Saffron Mixed Grill': [['Beef Mince', 0.15], ['Chicken Breast', 0.18], ['Lamb Chops', 0.15], ['Naan Bread', 2], ['Spice Mix', 0.02]],
    'Charcoal Lamb Chops': [['Lamb Chops', 0.4], ['Yogurt', 0.06], ['Spice Mix', 0.02]],
    'Chicken Tikka': [['Chicken Thigh', 0.35], ['Yogurt', 0.05], ['Spice Mix', 0.02]],
    'Beef Seekh Kebab': [['Beef Mince', 0.22], ['Onions', 0.03], ['Spice Mix', 0.02]],
    'Malai Boti': [['Chicken Breast', 0.25], ['Cream', 0.04], ['Cheddar Cheese', 0.02], ['Spice Mix', 0.01]],
    'Fettuccine Alfredo': [['Pasta', 0.15], ['Cream', 0.1], ['Cheddar Cheese', 0.04], ['Butter', 0.02]],
    'Penne Arrabiata': [['Pasta', 0.15], ['Tomato Puree', 0.1], ['Garlic', 0.01], ['Cooking Oil', 0.02]],
    'Seafood Linguine': [['Pasta', 0.15], ['Salmon Fillet', 0.08], ['Cream', 0.04], ['Tomatoes', 0.06]],
    'Molten Chocolate Lava Cake': [['Chocolate', 0.08], ['Butter', 0.04], ['Eggs', 2], ['Sugar', 0.04]],
    'New York Cheesecake': [['Cream', 0.08], ['Cheddar Cheese', 0.03], ['Sugar', 0.05], ['Butter', 0.02]],
    'Chocolate Fudge Cake': [['Chocolate', 0.07], ['Butter', 0.04], ['Sugar', 0.05], ['Eggs', 1]],
    'Vanilla Bean Gelato': [['Milk', 0.12], ['Cream', 0.05], ['Sugar', 0.03]],
    'Signature Flat White': [['Coffee Beans', 0.018], ['Milk', 0.15]],
    'Cappuccino': [['Coffee Beans', 0.016], ['Milk', 0.12]],
    'Double Espresso': [['Coffee Beans', 0.018]],
    'Mint Mojito Cooler': [['Mint', 0.02], ['Lemons', 0.05], ['Sugar', 0.02]],
    'Fresh Lemonade': [['Lemons', 0.08], ['Sugar', 0.03]],
    'Mango Lassi': [['Mango Pulp', 0.15], ['Yogurt', 0.12], ['Milk', 0.05]]
  };
  for (const p of productRows) {
    const recipe = recipeMap[p.name] || [];
    for (const [ing, qty] of recipe) {
      if (ingIds[ing]) {
        run('INSERT OR IGNORE INTO recipes (product_id, ingredient_id, qty) VALUES (?,?,?)', p.id, ingIds[ing], qty);
      }
    }
  }

  // ─────────────────────────── STAFF ───────────────────────────
  const staff = [
    ['Ayesha Khan', 'admin@saffronhouse.pk', 'admin123', 'admin', '+92 300 1112233', 250000, '2024-02-01', '#C9A227'],
    ['Bilal Ahmed', 'manager@saffronhouse.pk', 'manager123', 'manager', '+92 321 4455667', 160000, '2024-03-12', '#3B82F6'],
    ['Hamza Raza', 'cashier@saffronhouse.pk', 'cashier123', 'cashier', '+92 333 7788990', 85000, '2024-06-20', '#8B5CF6'],
    ['Zainab Fatima', 'waiter@saffronhouse.pk', 'waiter123', 'waiter', '+92 345 2233445', 65000, '2024-09-05', '#EC4899'],
    ['Usman Ali', 'kitchen@saffronhouse.pk', 'kitchen123', 'kitchen', '+92 302 5566778', 75000, '2024-07-15', '#EF4444'],
    ['Sana Malik', 'chef@saffronhouse.pk', 'chef123', 'kitchen', '+92 300 9988776', 120000, '2024-04-02', '#F59E0B'],
    ['Ali Hassan', 'cashier2@saffronhouse.pk', 'cashier123', 'cashier', '+92 313 1122334', 80000, '2025-01-10', '#10B981'],
    ['Maria Noor', 'waiter2@saffronhouse.pk', 'waiter123', 'waiter', '+92 336 4455221', 62000, '2025-03-22', '#06B6D4']
  ];
  const staffIds = staff.map(([name, email, pass, role, phone, salary, join, color]) =>
    run('INSERT INTO users (name, email, password_hash, role, phone, salary, join_date, color) VALUES (?,?,?,?,?,?,?,?)',
      name, email, bcrypt.hashSync(pass, 10), role, phone, salary, join, color).lastInsertRowid
  );
  const adminId = staffIds[0];

  // ─────────────────────────── CUSTOMERS ───────────────────────────
  const customerData = [
    ['Fatima Sheikh', 'customer@example.com', '+92 300 1234567', 'House 12, Street 4, DHA Phase 5, Lahore', 'Lahore', 7],
    ['Ahmed Raza', 'ahmed.raza@gmail.com', '+92 321 2345678', 'Flat 8B, Askari Tower, Gulberg III, Lahore', 'Lahore', 3],
    ['Sana Javed', 'sana.javed@outlook.com', '+92 333 3456789', 'House 45, Block C, Johar Town, Lahore', 'Lahore', 5],
    ['Usman Chaudhry', 'usman.c@gmail.com', '+92 345 4567890', 'House 7, Model Town Extension, Lahore', 'Lahore', 8],
    ['Ayesha Malik', 'ayesha.malik@gmail.com', '+92 301 5678901', 'Apartment 3, Bahria Town, Lahore', 'Lahore', 0],
    ['Bilal Qureshi', 'bilal.q@yahoo.com', '+92 313 6789012', 'House 89, Valencia Town, Lahore', 'Lahore', 2],
    ['Hira Aslam', 'hira.aslam@gmail.com', '+92 322 7890123', 'House 23, Cavalry Ground, Lahore', 'Lahore', 4],
    ['Faisal Mehmood', 'faisal.m@gmail.com', '+92 334 8901234', 'Plot 14, Faisal Town, Lahore', 'Lahore', 0],
    ['Mariam Khan', 'mariam.k@gmail.com', '+92 302 9012345', 'House 5, Gulberg II, Lahore', 'Lahore', 6],
    ['Zeeshan Akhtar', 'zeeshan.a@gmail.com', '+92 346 0123456', 'House 33, Wapda Town, Lahore', 'Lahore', 1],
    ['Noor Fatima', 'noor.f@gmail.com', '+92 311 1357924', 'House 56, Phase 6 DHA, Lahore', 'Lahore', 3],
    ['Haris Siddiqui', 'haris.s@gmail.com', '+92 323 2468013', 'Flat 2, Eden Heights, Gulberg, Lahore', 'Lahore', 0],
    ['Rida Bashir', 'rida.b@gmail.com', '+92 335 3691470', 'House 18, Paragon City, Lahore', 'Lahore', 2],
    ['Danish Iqbal', 'danish.i@gmail.com', '+92 300 4815926', 'House 91, State Life Society, Lahore', 'Lahore', 1],
    ['Amna Tariq', 'amna.t@gmail.com', '+92 312 5926374', 'House 4, NFC Society, Lahore', 'Lahore', 0],
    ['Kashif Nadeem', 'kashif.n@gmail.com', '+92 341 6172839', 'House 27, Lake City, Lahore', 'Lahore', 5]
  ];
  const customerPass = bcrypt.hashSync('customer123', 10);
  const customerIds = customerData.map(([name, email, phone, address, city, points], idx) =>
    run('INSERT INTO customers (name, email, phone, password_hash, address, city, loyalty_points, created_at) VALUES (?,?,?,?,?,?,?,?)',
      name, email, phone, customerPass, address, city, points,
      fmt(new Date(Date.now() - randInt(30, 300) * 86400000))).lastInsertRowid
  );
  // Saved addresses
  customerIds.slice(0, 8).forEach((cid) => {
    run('INSERT INTO addresses (customer_id, label, address, city, phone, is_default) VALUES (?,?,?,?,?,1)',
      cid, 'Home', all('SELECT address FROM customers WHERE id = ?', cid)[0].address, 'Lahore', all('SELECT phone FROM customers WHERE id = ?', cid)[0].phone);
  });

  // ─────────────────────────── TABLES ───────────────────────────
  const tableData = [
    ['T01', 2, 'Main Hall', 60, 60, 'available'],
    ['T02', 4, 'Main Hall', 240, 60, 'available'],
    ['T03', 4, 'Main Hall', 420, 60, 'available'],
    ['T04', 6, 'Main Hall', 60, 220, 'available'],
    ['T05', 6, 'Main Hall', 240, 220, 'available'],
    ['T06', 8, 'Main Hall', 420, 220, 'available'],
    ['T07', 2, 'Terrace', 60, 60, 'available'],
    ['T08', 4, 'Terrace', 240, 60, 'available'],
    ['T09', 4, 'Terrace', 420, 60, 'reserved'],
    ['T10', 2, 'Private Dining', 60, 220, 'available'],
    ['T11', 6, 'Private Dining', 240, 220, 'available'],
    ['T12', 10, 'Private Dining', 420, 220, 'available']
  ];
  const tableIds = tableData.map(([number, cap, area, x, y, status]) =>
    run('INSERT INTO dining_tables (number, capacity, area, status, x, y) VALUES (?,?,?,?,?,?)',
      number, cap, area, status, x, y).lastInsertRowid
  );

  // ─────────────────────────── COUPONS ───────────────────────────
  const coupons = [
    ['SAFFRON10', 'percent', 10, 2000, 600, 500, 1],
    ['WELCOME500', 'fixed', 500, 2500, null, 200, 1],
    ['FREEDEL', 'fixed', 250, 1500, null, 300, 1],
    ['WEEKEND15', 'percent', 15, 4000, 1200, 100, 1]
  ];
  for (const [code, type, value, min, maxd, limit, active] of coupons) {
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 1);
    run('INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, active, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      code, type, value, min, maxd, limit, active, dateFmt(exp));
  }

  // ─────────────────────────── HISTORICAL ORDERS ───────────────────────────
  console.log('  → Generating order history…');
  const dayCounters = {};
  const monthCounters = {};
  const insertOrder = (data) => {
    const d = data.created;
    const dayKey = dateFmt(d).replace(/-/g, '');
    dayCounters[dayKey] = (dayCounters[dayKey] || 0) + 1;
    const orderNumber = `SH-${dayKey}-${String(dayCounters[dayKey]).padStart(4, '0')}`;
    const monthKey = `${d.getFullYear()}${p2(d.getMonth() + 1)}`;
    monthCounters[monthKey] = (monthCounters[monthKey] || 0) + 1;
    const invoiceNumber = `INV-${monthKey}-${String(monthCounters[monthKey]).padStart(4, '0')}`;

    const subtotal = round(data.lines.reduce((s, l) => s + l.line_total, 0));
    const discount = data.discount || 0;
    const totals = calculateTotals({ subtotal, discount, deliveryFee: data.delivery_fee || 0 });
    const r = run(
      `INSERT INTO orders (order_number, customer_id, staff_id, type, table_id, status, payment_status, payment_method,
        subtotal, tax, discount, delivery_fee, total, coupon_code, notes, customer_name, phone, address, source,
        inventory_deducted, created_at, updated_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNumber, data.customer_id, data.staff_id, data.type, data.table_id, data.status, data.payment_status,
      data.payment_method, totals.subtotal, totals.tax, totals.discount, totals.delivery_fee, totals.total,
      data.coupon_code || null, data.notes || null, data.customer_name, data.phone, data.address,
      data.source, data.status === 'completed' ? 1 : 0, fmt(d), fmt(d), data.status === 'completed' ? fmt(d) : null
    );
    const orderId = r.lastInsertRowid;
    for (const l of data.lines) {
      run('INSERT INTO order_items (order_id, product_id, name, qty, unit_price, addons_json, notes, line_total) VALUES (?,?,?,?,?,?,?,?)',
        orderId, l.product_id, l.name, l.qty, l.unit_price, l.addons_json || null, l.notes || null, l.line_total);
    }
    run(
      'INSERT INTO invoices (invoice_number, order_id, customer_id, subtotal, tax, discount, delivery_fee, total, payment_method, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      invoiceNumber, orderId, data.customer_id, totals.subtotal, totals.tax, totals.discount, totals.delivery_fee,
      totals.total, data.payment_method,
      data.status === 'cancelled' && data.payment_status === 'paid' ? 'refunded' : (data.payment_status === 'paid' ? 'paid' : 'unpaid'),
      fmt(d)
    );
    return orderId;
  };

  const makeLines = (count) => {
    const chosen = new Set();
    const lines = [];
    for (let i = 0; i < count; i++) {
      let p = pick(productRows);
      let guard = 0;
      while (chosen.has(p.id) && guard++ < 20) p = pick(productRows);
      chosen.add(p.id);
      const qty = randInt(1, 3);
      let unit = p.price;
      let addons_json = null;
      if (chance(0.22)) {
        const a = pick(addons.filter((x) => catAddons[p.cat]?.includes(x[0])));
        if (a) {
          unit += a[1];
          addons_json = JSON.stringify({ names: [a[0]], extra: a[1] });
        }
      }
      lines.push({
        product_id: p.id, name: p.name, qty, unit_price: round(unit),
        addons_json, line_total: round(unit * qty)
      });
    }
    return lines;
  };

  const staffForOrders = [staffIds[0], staffIds[1], staffIds[2], staffIds[6]];
  let totalOrders = 0;
  for (let dayOffset = 119; dayOffset >= 0; dayOffset--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - dayOffset);
    const isToday = dayOffset === 0;
    const weekend = [0, 5, 6].includes(day.getDay());
    const orderCount = isToday ? 11 : randInt(2, weekend ? 6 : 4);
    for (let i = 0; i < orderCount; i++) {
      const created = new Date(day);
      const activeToday = isToday && i < 5;
      let status;
      if (activeToday) {
        status = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'][i];
      } else if (isToday) {
        status = 'completed';
      } else {
        status = chance(0.09) ? 'cancelled' : 'completed';
      }
      created.setHours(randInt(11, 22), randInt(0, 59), randInt(0, 59), 0);
      if (isToday && activeToday) {
        const minutesAgo = [8, 16, 24, 35, 48][i];
        created.setTime(Date.now() - minutesAgo * 60000);
      }
      const type = chance(0.55) ? 'dine-in' : (chance(0.55) ? 'delivery' : 'takeaway');
      const customerIdx = chance(0.72) ? randInt(0, customerIds.length - 1) : null;
      const cust = customerIdx !== null ? customerData[customerIdx] : ['Walk-in Guest', null, null, null, 'Lahore'];
      const table_id = type === 'dine-in' ? pick(tableIds) : null;
      const paid = status === 'completed' || chance(0.45);
      const method = chance(0.45) ? 'cash' : (chance(0.4) ? 'card' : 'demo');
      const useCoupon = chance(0.08);
      const lines = makeLines(randInt(1, 4));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      const coupon = useCoupon && subtotal > 2500 ? 'SAFFRON10' : null;
      const discount = coupon ? round(Math.min(subtotal * 0.1, 600)) : 0;
      const orderId = insertOrder({
        created, lines, customer_id: customerIdx !== null ? customerIds[customerIdx] : null,
        staff_id: pick(staffForOrders), type, table_id, status,
        payment_status: status === 'cancelled' && paid ? 'refunded' : (paid ? 'paid' : 'unpaid'),
        payment_method: method,
        customer_name: cust[0], phone: cust[2],
        address: type === 'delivery' ? cust[3] : null,
        delivery_fee: type === 'delivery' ? 250 : 0,
        coupon_code: coupon, discount,
        source: chance(0.3) ? 'online' : 'pos',
        notes: chance(0.15) ? 'Please keep the spice level medium.' : null
      });
      totalOrders++;
      if (isToday && activeToday && type === 'dine-in' && table_id) {
        run(`UPDATE dining_tables SET status = 'occupied', current_order_id = ? WHERE id = ?`, orderId, table_id);
      }
    }
  }
  console.log(`    ${totalOrders} orders created.`);

  // ─────────────────────────── PURCHASES ───────────────────────────
  const purchaseRows = [];
  const ingList = all('SELECT * FROM ingredients');
  for (let i = 0; i < 12; i++) {
    const supplier = suppliers[i % suppliers.length];
    const supId = supplierIds[i % supplierIds.length];
    const d = new Date(); d.setDate(d.getDate() - (i * 9 + 3));
    const status = i < 9 ? 'received' : 'pending';
    const items = [];
    const used = new Set();
    for (let j = 0; j < randInt(2, 4); j++) {
      let ing = pick(ingList);
      let guard = 0;
      while (used.has(ing.id) && guard++ < 10) ing = pick(ingList);
      used.add(ing.id);
      const qty = ing.unit === 'kg' ? randInt(5, 30) : (ing.unit === 'pcs' ? randInt(20, 100) : randInt(2, 10));
      items.push({ ing, qty, cost: ing.purchase_price, total: round(qty * ing.purchase_price) });
    }
    const subtotal = round(items.reduce((s, x) => s + x.total, 0));
    const tax = round(subtotal * 0.05);
    const total = round(subtotal + tax);
    const paidAmount = status === 'received' ? total : round(total * 0.4);
    const po = nextPurchaseNumber();
    const r = run(
      `INSERT INTO purchases (po_number, supplier_id, status, order_date, received_date, subtotal, tax, total, paid_amount, notes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      po, supId, status, dateFmt(d), status === 'received' ? dateFmt(d) : null, subtotal, tax, total,
      paidAmount, status === 'pending' ? 'Awaiting delivery — confirm on arrival' : 'Delivered and checked', adminId, fmt(d)
    );
    for (const x of items) {
      run('INSERT INTO purchase_items (purchase_id, ingredient_id, qty, unit_cost, total) VALUES (?,?,?,?,?)',
        r.lastInsertRowid, x.ing.id, x.qty, x.cost, round(x.qty * x.cost));
    }
    if (status === 'received') {
      for (const x of items) {
        run('INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
          x.ing.id, 'purchase', x.qty, x.cost, po, `Received from ${supplier[0]}`, adminId, fmt(d));
      }
    }
    purchaseRows.push({ id: r.lastInsertRowid, supId, total, paidAmount });
  }
  // Outstanding supplier balances
  for (const supId of supplierIds) {
    const outstanding = round(purchaseRows.filter((p) => p.supId === supId).reduce((s, p) => s + p.total - p.paidAmount, 0));
    run('UPDATE suppliers SET outstanding_balance = ? WHERE id = ?', outstanding, supId);
  }

  // ─────────────────────────── EXPENSES ───────────────────────────
  // Illustrative operating costs for the demo. They are deliberately scaled to
  // the seeded sales volume so the default 30-day P&L shows a modest profit.
  const expenses = [
    ['Rent', 'Monthly rent — Gulberg premises', 90000, 2, 'bank'],
    ['Electricity', 'LESCO commercial bill', 37000, 4, 'bank'],
    ['Gas', 'SNGPL commercial gas bill', 15000, 6, 'cash'],
    ['Salaries', 'Front-of-house payroll', 77000, 8, 'bank'],
    ['Ingredients', 'Weekly produce purchase', 29000, 9, 'cash'],
    ['Marketing', 'Instagram and food blogger campaign', 17000, 12, 'card'],
    ['Maintenance', 'Kitchen exhaust deep clean', 8400, 16, 'cash'],
    ['Salaries', 'Kitchen brigade payroll', 84000, 18, 'bank'],
    ['Ingredients', 'Meat supplier payment', 54000, 21, 'bank'],
    ['Rent', 'Monthly rent — parking annex', 16000, 32, 'bank'],
    ['Electricity', 'LESCO commercial bill', 35000, 34, 'bank'],
    ['Gas', 'SNGPL commercial gas bill', 14000, 36, 'cash'],
    ['Marketing', 'Ramadan menu photo shoot', 24000, 39, 'card'],
    ['Maintenance', 'Refrigeration service contract', 11000, 43, 'bank'],
    ['Other', 'Licensing and municipal fees', 7000, 52, 'cash'],
    ['Salaries', 'Front-of-house payroll', 74000, 38, 'bank'],
    ['Ingredients', 'Monthly dry goods purchase', 40000, 45, 'bank'],
    ['Rent', 'Monthly rent — Gulberg premises', 90000, 42, 'bank']
  ];
  for (const [category, desc, amount, daysAgo, method] of expenses) {
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    run('INSERT INTO expenses (category, description, amount, date, payment_method, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      category, desc, amount, dateFmt(d), method, adminId, fmt(d));
  }

  // ─────────────────────────── RESERVATIONS ───────────────────────────
  const reservations = [
    ['Ahmed Raza', '+92 321 2345678', 'ahmed.raza@gmail.com', 4, 2, 1, '19:30', 'confirmed', 'Anniversary dinner — window table if possible'],
    ['Noor Fatima', '+92 311 1357924', 'noor.f@gmail.com', 6, 5, 2, '20:00', 'confirmed', 'Birthday celebration, bringing a cake'],
    ['Faisal Mehmood', '+92 334 8901234', 'faisal.m@gmail.com', 2, 0, 0, '13:30', 'pending', 'Business lunch'],
    ['Mariam Khan', '+92 302 9012345', 'mariam.k@gmail.com', 8, 11, 3, '21:00', 'confirmed', 'Family dinner'],
    ['Hira Aslam', '+92 322 7890123', 'hira.aslam@gmail.com', 3, 7, 1, '18:30', 'seated', ''],
    ['Danish Iqbal', '+92 300 4815926', 'danish.i@gmail.com', 5, 4, 1, '20:30', 'pending', 'One high chair needed'],
    ['Rida Bashir', '+92 335 3691470', 'rida.b@gmail.com', 2, 8, 2, '19:00', 'confirmed', ''],
    ['Kashif Nadeem', '+92 341 6172839', 'kashif.n@gmail.com', 10, 11, 4, '21:30', 'pending', 'Corporate dinner — set menu required'],
    ['Amna Tariq', '+92 312 5926374', 'amna.t@gmail.com', 4, 3, -1, '20:00', 'completed', ''],
    ['Zeeshan Akhtar', '+92 346 0123456', 'zeeshan.a@gmail.com', 2, 0, 2, '19:30', 'cancelled', 'Guest had to cancel']
  ];
  reservations.forEach(([name, phone, email, guests, tableIdx, dayOffset, time, status, notes], i) => {
    const d = new Date(); d.setDate(d.getDate() + dayOffset);
    run('INSERT INTO reservations (reservation_code, customer_name, phone, email, guests, table_id, date, time, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      `RSV-${String(i + 1).padStart(4, '0')}`, name, phone, email, guests,
      tableIds[tableIdx], dateFmt(d), time, status, notes, fmt(new Date(Date.now() - randInt(1, 5) * 86400000)));
  });

  // ─────────────────────────── CONTENT ───────────────────────────
  const testimonials = [
    ['Ayesha Siddiqui', 'Food Blogger, Lahore', 5, 'The ribeye was cooked to absolute perfection and the saffron biryani took me straight back to my grandmother\'s kitchen. Saffron House has become my go-to for celebrations.', 'testimonial-1'],
    ['Hassan Raza', 'Regular Guest', 5, 'Easily the best service I have experienced in Lahore. The staff remembered our order from three weeks ago. The mixed grill platter is unreal.', 'testimonial-2'],
    ['Sarah Ahmed', 'Corporate Client', 5, 'We hosted a 20-person client dinner in the private dining room. Flawless coordination, beautiful presentation, and not a single dish was late.', 'testimonial-3'],
    ['Omar Farooq', 'Food Critic', 4, 'A confident modern take on Pakistani classics without losing the soul of the food. The nihari alone is worth the drive across town.', 'testimonial-4'],
    ['Hina Waqar', 'Family Diner', 5, 'Took my parents for their anniversary. The team decorated the table and brought out a complimentary dessert. Beautiful evening.', 'testimonial-5'],
    ['Saad Iqbal', 'Weekend Regular', 5, 'The burgers are genuinely world-class. Fresh brioche, proper char, and the truffle fries are dangerous. My Saturday ritual now.', 'testimonial-6']
  ];
  for (const [name, role, rating, text] of testimonials) {
    run('INSERT INTO testimonials (name, role, rating, text) VALUES (?,?,?,?)', name, role, rating, text);
  }

  const galleryItems = [
    ['Our dining room', 'Interior', 'interior-1'], ['Evening service', 'Interior', 'interior-2'],
    ['The chef\'s table', 'Interior', 'interior-3'], ['Terrace at dusk', 'Interior', 'interior-4'],
    ['Our home on MM Alam Road', 'Exterior', 'exterior'], ['The Saffron bar', 'Interior', 'bar'],
    ['Chef Sana at the pass', 'Kitchen', 'chef-1'], ['Fire and craft', 'Kitchen', 'chef-2'],
    ['Table for two', 'Interior', 'table'], ['Plating the signature', 'Kitchen', 'plating'],
    ['The full spread', 'Food', 'food-spread'], ['Slow mornings', 'Food', 'breakfast']
  ];
  galleryItems.forEach(([title, category, image], i) =>
    run('INSERT INTO gallery (title, category, image, sort_order) VALUES (?,?,?,?)', title, category, IMG(image), i));

  const faqs = [
    ['Do you take reservations?', 'Yes. You can book a table online through our reservations page, or call us at +92 42 3577 8899. Reservations are held for 15 minutes past the booked time.'],
    ['Do you offer home delivery?', 'We deliver across Gulberg, DHA, Johar Town and Model Town. Delivery is free on orders above Rs. 4,000; otherwise a flat Rs. 250 applies.'],
    ['Are there vegetarian options?', 'Absolutely. Our menu includes a range of vegetarian starters, pizzas, pastas and desserts. Use the "Vegetarian" filter on the menu page.'],
    ['Is the meat halal?', 'All our meat is sourced from certified halal suppliers in Lahore and is inspected daily by our kitchen team.'],
    ['Can I host a private event?', 'Yes — our private dining room seats up to 10 guests, and the full terrace can be reserved for larger events. Contact us for a bespoke set menu.'],
    ['What payment methods do you accept?', 'We accept cash, all major debit and credit cards, and digital wallets. Online orders include a demo card option for this demonstration.'],
    ['Do you cater to allergies?', 'Please inform our team of any allergies when ordering. Our kitchen handles nuts, dairy and gluten, so we cannot guarantee a completely allergen-free environment.'],
    ['Where are you located?', 'We are at 42-C, MM Alam Road, Gulberg III, Lahore — valet parking is available every evening.']
  ];
  faqs.forEach(([q, a], i) => run('INSERT INTO faqs (question, answer, sort_order) VALUES (?,?,?)', q, a, i));

  const messages = [
    ['Sara Khan', 'sara.khan@gmail.com', '+92 300 5551234', 'Private event enquiry', 'Hello, I would like to enquire about hosting a 40th birthday dinner for 25 guests on the terrace. Could you share your set menu options?'],
    ['Junaid Ali', 'junaid.ali@gmail.com', '+92 321 8887766', 'Feedback', 'Visited last Friday and had a wonderful experience. The lamb chops were exceptional and your staff were very attentive.'],
    ['Mahnoor Shah', 'mahnoor.shah@gmail.com', '+92 333 1239876', 'Catering', 'Do you provide corporate catering for offices in DHA? We need lunch for 60 people every Friday.']
  ];
  for (const [name, email, phone, subject, message] of messages) {
    run('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)', name, email, phone, subject, message);
  }

  // Sync some inventory transaction noise (wastage / adjustments)
  const wastage = [
    ['Tomatoes', 2.4, 'Expired stock discarded'], ['Lettuce', 0.8, 'Spoiled during delivery'],
    ['Milk', 3, 'Expired — breakfast service'], ['Bread', 10, 'End of day wastage']
  ];
  for (const [ing, qty, note] of wastage) {
    if (!ingIds[ing]) continue;
    const d = new Date(); d.setDate(d.getDate() - randInt(1, 20));
    run('INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ingIds[ing], 'wastage', -qty, 0, 'WASTE', note, adminId, fmt(d));
  }

  // A few settings refinements
  setSetting('currency_symbol', 'Rs.');
  setSetting('tax_rate', '5');
  setSetting('delivery_fee', '250');

  console.log('  ✓ Demo restaurant seeded successfully.');
}

function isSeeded() {
  try {
    return Number(get('SELECT COUNT(*) AS c FROM products').c) > 0;
  } catch (_) { return false; }
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  if (isSeeded() && !force) {
    console.log('Database already seeded. Use npm run seed to force a clean reseed.');
  } else {
    transaction(seed);
    const counts = {
      products: get('SELECT COUNT(*) c FROM products').c,
      categories: get('SELECT COUNT(*) c FROM categories').c,
      customers: get('SELECT COUNT(*) c FROM customers').c,
      orders: get('SELECT COUNT(*) c FROM orders').c,
      invoices: get('SELECT COUNT(*) c FROM invoices').c,
      ingredients: get('SELECT COUNT(*) c FROM ingredients').c,
      employees: get('SELECT COUNT(*) c FROM users').c,
      tables: get('SELECT COUNT(*) c FROM dining_tables').c,
      purchases: get('SELECT COUNT(*) c FROM purchases').c,
      expenses: get('SELECT COUNT(*) c FROM expenses').c,
      reservations: get('SELECT COUNT(*) c FROM reservations').c
    };
    console.log(counts);
  }
}

module.exports = { seed, isSeeded };
