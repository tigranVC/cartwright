// Static reference data: store templates, product vocabularies, names.
// Everything here is invented for the simulator.

export const STORE_TEMPLATES = [
  {
    id: 'STO-1', name: 'Fernhollow Apparel', domain: 'fernhollow.example', city: 'Portland', taxRate: 0.0,
    vertical: 'apparel', products: 120, customers: 900, orders: 2000,
    locations: [
      { id: 'LOC-01', name: 'Portland Warehouse', city: 'Portland' },
      { id: 'LOC-02', name: 'Pearl District Store', city: 'Portland' },
    ],
    shipping: { standard: 695, express: 1895 },
  },
  {
    id: 'STO-2', name: 'Saltbox Home Goods', domain: 'saltbox.example', city: 'Providence', taxRate: 0.07,
    vertical: 'home', products: 100, customers: 600, orders: 1300,
    locations: [
      { id: 'LOC-03', name: 'Providence Warehouse', city: 'Providence' },
      { id: 'LOC-04', name: 'Federal Hill Showroom', city: 'Providence' },
    ],
    shipping: { standard: 895, express: 2195 },
  },
  {
    id: 'STO-3', name: 'Ridgeway Trail Supply', domain: 'ridgeway.example', city: 'Denver', taxRate: 0.0825,
    vertical: 'outdoor', products: 80, customers: 450, orders: 900,
    locations: [
      { id: 'LOC-05', name: 'Denver Fulfillment Center', city: 'Denver' },
      { id: 'LOC-06', name: 'Reno Fulfillment Center', city: 'Reno' },
      { id: 'LOC-07', name: 'Boulder Retail', city: 'Boulder' },
    ],
    shipping: { standard: 795, express: 2495 },
  },
];

export const SHIPPING_METHODS = ['standard', 'express', 'pickup'];
export const SHIPPING_LABELS = { standard: 'Standard shipping', express: 'Express shipping', pickup: 'Local pickup' };

// Product generators per vertical: type -> base price range (dollars), option sets.
export const VERTICALS = {
  apparel: {
    vendors: ['Fernhollow', 'Kestrel Knit', 'Driftline', 'Copperleaf Co.'],
    adjectives: ['Harbor', 'Alder', 'Summit', 'Coastal', 'Meadow', 'Granite', 'Willow', 'Cedar', 'Tidal', 'Ember', 'Foxglove', 'Juniper', 'Basalt', 'Marlow', 'Sable'],
    types: [
      { type: 'T-Shirt', nouns: ['Crew Tee', 'Pocket Tee', 'Slub Tee', 'Raglan Tee'], price: [22, 38], options: [['Size', ['XS', 'S', 'M', 'L', 'XL']], ['Color', ['Black', 'White', 'Heather Grey', 'Navy', 'Rust', 'Sage']]] },
      { type: 'Hoodie', nouns: ['Pullover Hoodie', 'Zip Hoodie', 'Fleece Hoodie'], price: [58, 88], options: [['Size', ['S', 'M', 'L', 'XL']], ['Color', ['Charcoal', 'Oatmeal', 'Forest', 'Black']]] },
      { type: 'Pants', nouns: ['Chino', 'Slim Jean', 'Work Pant', 'Jogger'], price: [64, 110], options: [['Waist', ['28', '30', '32', '34', '36']], ['Color', ['Indigo', 'Khaki', 'Black']]] },
      { type: 'Jacket', nouns: ['Chore Coat', 'Rain Shell', 'Quilted Vest', 'Field Jacket'], price: [95, 220], options: [['Size', ['S', 'M', 'L', 'XL']]] },
      { type: 'Accessories', nouns: ['Beanie', 'Wool Scarf', 'Canvas Cap', 'Leather Belt'], price: [18, 48], options: [['Color', ['Black', 'Mustard', 'Navy', 'Moss']]] },
      { type: 'Socks', nouns: ['Crew Socks', 'Hiking Socks', 'Ankle Socks 3-Pack'], price: [12, 26], options: [['Size', ['S/M', 'L/XL']]] },
    ],
    tags: ['new', 'organic-cotton', 'bestseller', 'limited', 'summer', 'winter', 'basics', 'recycled'],
  },
  home: {
    vendors: ['Saltbox', 'Wick & Wane', 'Ollie Ceramics', 'Northfield Linen'],
    adjectives: ['Cove', 'Larkspur', 'Hearth', 'Dune', 'Orchard', 'Pebble', 'Linden', 'Quarry', 'Brindle', 'Mosswood', 'Heron', 'Clover'],
    types: [
      { type: 'Mug', nouns: ['Stoneware Mug', 'Speckled Mug', 'Camp Mug'], price: [16, 32], options: [['Color', ['Cream', 'Slate', 'Terracotta', 'Sea Glass']]] },
      { type: 'Candle', nouns: ['Soy Candle', 'Travel Tin Candle', 'Three-Wick Candle'], price: [18, 46], options: [['Scent', ['Cedar & Smoke', 'Fig Leaf', 'Sea Salt', 'Amber']], ['Size', ['8 oz', '14 oz']]] },
      { type: 'Throw', nouns: ['Waffle Throw', 'Wool Throw', 'Cotton Blanket'], price: [68, 160], options: [['Color', ['Ivory', 'Rust', 'Charcoal']]] },
      { type: 'Planter', nouns: ['Terracotta Planter', 'Hanging Planter', 'Footed Pot'], price: [22, 75], options: [['Size', ['Small', 'Medium', 'Large']]] },
      { type: 'Kitchen', nouns: ['Cutting Board', 'Linen Apron', 'Salad Servers', 'Tea Towel Set'], price: [14, 85], options: [] },
      { type: 'Lighting', nouns: ['Table Lamp', 'Pendant Shade', 'Lantern'], price: [55, 240], options: [['Finish', ['Brass', 'Matte Black']]] },
    ],
    tags: ['new', 'handmade', 'bestseller', 'gift', 'sale', 'holiday', 'eco'],
  },
  outdoor: {
    vendors: ['Ridgeway', 'Talus Works', 'Bluebird Gear', 'Switchback Labs'],
    adjectives: ['Alpine', 'Canyon', 'Timberline', 'Scree', 'Basecamp', 'Couloir', 'Highline', 'Arroyo', 'Cirque', 'Mesa'],
    types: [
      { type: 'Backpack', nouns: ['Daypack', 'Trail Pack', 'Summit Pack'], price: [69, 249], options: [['Capacity', ['18L', '28L', '40L']], ['Color', ['Black', 'Orange', 'Teal']]] },
      { type: 'Hydration', nouns: ['Insulated Bottle', 'Soft Flask', 'Water Filter'], price: [19, 59], options: [['Size', ['500 ml', '750 ml', '1 L']]] },
      { type: 'Lighting', nouns: ['Headlamp', 'Camp Lantern'], price: [29, 89], options: [['Color', ['Black', 'Yellow']]] },
      { type: 'Shelter', nouns: ['Ultralight Tent', 'Tarp Shelter', 'Bivy'], price: [149, 499], options: [['Capacity', ['1P', '2P', '3P']]] },
      { type: 'Poles', nouns: ['Trekking Poles', 'Carbon Poles'], price: [59, 169], options: [] },
      { type: 'Sleep', nouns: ['Down Quilt', 'Sleeping Pad', 'Camp Pillow'], price: [35, 329], options: [['Size', ['Regular', 'Long']]] },
    ],
    tags: ['new', 'ultralight', 'bestseller', 'clearance', 'waterproof', 'summer', 'expedition'],
  },
};

export const FIRST_NAMES = ['Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Isla', 'Mason', 'Lena', 'Owen', 'Nora', 'Caleb', 'Ruby', 'Felix', 'Hazel', 'Jonah', 'Iris', 'Miles', 'Clara', 'Theo', 'June', 'Silas', 'Wren', 'Arlo', 'Mila', 'Ezra', 'Leah', 'Hugo', 'Esme', 'Rafael', 'Priya', 'Kenji', 'Amara', 'Diego', 'Sana', 'Tomas', 'Freya', 'Omar', 'Yuki', 'Nadia', 'Andre', 'Talia', 'Malik', 'Greta', 'Bodhi', 'Camila', 'Idris', 'Elena', 'Ravi', 'Sofia'];
export const LAST_NAMES = ['Abernathy', 'Bianchi', 'Castillo', 'Dalton', 'Eriksen', 'Fairbanks', 'Gallagher', 'Hollis', 'Ibarra', 'Jansen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Pellegrino', 'Quinlan', 'Rasmussen', 'Sorensen', 'Takahashi', 'Underwood', 'Varga', 'Whitaker', 'Xiong', 'Yilmaz', 'Zielinski', 'Achebe', 'Brennan', 'Chowdhury', 'Delgado', 'Esposito', 'Fischer', 'Greer', 'Haddad', 'Iverson', 'Jovanovic', 'Kaur', 'Lachance', 'Mbeki', 'Novak'];
export const STREETS = ['Maple', 'Oak', 'Cedar', 'Birch', 'Willow', 'Aspen', 'Hawthorn', 'Juniper', 'Sycamore', 'Magnolia', 'Laurel', 'Chestnut', 'Elm', 'Spruce', 'Poplar', 'Linden'];
export const STREET_SUFFIXES = ['St', 'Ave', 'Rd', 'Ln', 'Way', 'Ct', 'Blvd', 'Dr'];
export const CITIES = [
  ['Portland', 'OR', '97205'], ['Seattle', 'WA', '98101'], ['Boise', 'ID', '83702'], ['Sacramento', 'CA', '95814'],
  ['Denver', 'CO', '80202'], ['Austin', 'TX', '78701'], ['Chicago', 'IL', '60601'], ['Madison', 'WI', '53703'],
  ['Providence', 'RI', '02903'], ['Burlington', 'VT', '05401'], ['Asheville', 'NC', '28801'], ['Savannah', 'GA', '31401'],
  ['Minneapolis', 'MN', '55401'], ['Tucson', 'AZ', '85701'], ['Albany', 'NY', '12207'], ['Richmond', 'VA', '23219'],
];

export const CARRIERS = ['UPS', 'USPS', 'FedEx', 'DHL'];
export const TRACKING_URL = {
  UPS: 'https://tracking.example/ups/',
  USPS: 'https://tracking.example/usps/',
  FedEx: 'https://tracking.example/fedex/',
  DHL: 'https://tracking.example/dhl/',
};

export const CANCEL_REASONS = ['customer', 'inventory', 'fraud', 'declined', 'other'];
export const REFUND_REASONS = ['customer_request', 'damaged', 'not_as_described', 'late_delivery', 'wrong_item', 'other'];
export const RETURN_REASONS = ['size_too_small', 'size_too_large', 'unwanted', 'defective', 'not_as_described', 'wrong_item', 'other'];
export const ADJUST_REASONS = ['correction', 'received', 'damaged', 'shrinkage', 'cycle_count', 'restock', 'sold', 'returned', 'transfer', 'other'];

export const PRODUCT_STATUSES = ['active', 'draft', 'archived'];
export const ORDER_STATUSES = ['open', 'closed', 'cancelled'];
export const FINANCIAL_STATUSES = ['pending', 'authorized', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'voided'];
export const FULFILLMENT_STATUSES = ['unfulfilled', 'partial', 'fulfilled'];
export const RETURN_STATUSES = ['requested', 'open', 'closed', 'declined', 'cancelled'];
export const DISCOUNT_TYPES = ['percentage', 'fixed_amount', 'free_shipping'];
export const DISCOUNT_SCOPES = ['all', 'collections', 'products'];
export const MIN_REQUIREMENTS = ['none', 'subtotal', 'quantity'];

export const SMART_COLUMNS = ['title', 'type', 'vendor', 'tag', 'variant_price', 'variant_compare_at_price', 'variant_inventory', 'variant_title'];
export const SMART_RELATIONS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'greater_than', 'less_than'];

// Discount codes seeded into every store (dates relative to TODAY).
export const DISCOUNT_TEMPLATES = [
  { code: 'WELCOME10', title: 'Welcome 10% off', type: 'percentage', value: 10, scope: 'all', minType: 'none', minValue: 0, usageLimit: null, oncePerCustomer: true, startOffset: -400, endOffset: null },
  { code: 'SPRING15', title: 'Spring sale 15% off', type: 'percentage', value: 15, scope: 'all', minType: 'subtotal', minValue: 5000, usageLimit: null, oncePerCustomer: false, startOffset: -100, endOffset: -40 },
  { code: 'TAKE20', title: '$20 off orders over $120', type: 'fixed_amount', value: 2000, scope: 'all', minType: 'subtotal', minValue: 12000, usageLimit: 400, oncePerCustomer: false, startOffset: -150, endOffset: null },
  { code: 'SHIPFREE', title: 'Free shipping on 3+ items', type: 'free_shipping', value: 0, scope: 'all', minType: 'quantity', minValue: 3, usageLimit: null, oncePerCustomer: false, startOffset: -200, endOffset: null },
  { code: 'VIP25', title: 'VIP 25% off', type: 'percentage', value: 25, scope: 'all', minType: 'none', minValue: 0, usageLimit: 60, oncePerCustomer: true, startOffset: -90, endOffset: null },
  { code: 'FLASH30', title: 'Flash sale (upcoming)', type: 'percentage', value: 30, scope: 'all', minType: 'none', minValue: 0, usageLimit: 200, oncePerCustomer: false, startOffset: 7, endOffset: 9 },
];
