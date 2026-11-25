// Mongoose models. Sports, stadiums and matches use readable string ids
// (e.g. "national-stadium-karachi", "m01") so URLs and seed files stay simple.
import mongoose from 'mongoose';

const { Schema } = mongoose;

const sportSchema = new Schema({
  _id: String,
  name: { type: String, required: true },
  tagline: String,
  order: { type: Number, default: 0 },
}, { timestamps: true });

// The full venue layout lives in `config` (same shape as /stadiums/*.json),
// so the browser can draw it and the server can validate seats from it.
const stadiumSchema = new Schema({
  _id: String,
  name: { type: String, required: true },
  sport: { type: String, required: true, index: true },
  city: String,
  country: String,
  sample: Boolean,
  config: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

const matchSchema = new Schema({
  _id: String,
  sport: { type: String, required: true, index: true },
  stadiumId: { type: String, required: true, ref: 'Stadium', index: true },
  competition: String,
  stage: String,
  title: { type: String, required: true },
  short: String,
  home: String,
  away: String,
  date: { type: Date, required: true, index: true },
  currency: { type: String, default: 'PKR' },
  // { default, stands: { standId: price }, tiers: { "standId.tierKey": price } }
  prices: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
}, { timestamps: true });

// One document per (match, seat) that is not free. The unique index is what
// guarantees a seat can never be held or sold twice.
const bookingSchema = new Schema({
  matchId: { type: String, required: true },
  seatId: { type: String, required: true },
  status: { type: String, enum: ['held', 'sold'], required: true },
  price: Number,
  holdId: { type: String, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  expiresAt: Date, // only for holds
  source: { type: String, enum: ['web', 'seed'], default: 'web' },
}, { timestamps: true });
bookingSchema.index({ matchId: 1, seatId: 1 }, { unique: true });
bookingSchema.index({ matchId: 1, status: 1 });
// MongoDB deletes expired holds by itself (the TTL monitor runs about once a minute;
// queries also ignore expired holds so the gap does not matter).
bookingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'held' } });

const orderSchema = new Schema({
  matchId: { type: String, required: true, index: true },
  seats: [{ _id: false, seatId: String, label: String, price: Number }],
  subtotal: Number,
  fee: Number,
  total: Number,
  currency: String,
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
  },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
}, { timestamps: true });

// Admin panel users. Passwords are stored as scrypt hashes (see server/auth.js).
// `sessionVersion` is bumped to sign the admin out everywhere (e.g. password change).
const adminSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  sessionVersion: { type: Number, default: 1 },
  lastLoginAt: Date,
}, { timestamps: true });

export const Admin = mongoose.model('Admin', adminSchema);
export const Sport = mongoose.model('Sport', sportSchema);
export const Stadium = mongoose.model('Stadium', stadiumSchema);
export const Match = mongoose.model('Match', matchSchema);
export const Booking = mongoose.model('Booking', bookingSchema);
export const Order = mongoose.model('Order', orderSchema);
