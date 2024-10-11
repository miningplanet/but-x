module.exports = new require('mongoose').Schema({
  uuid: { type: String, unique: true, index: true, required: true },
  address: { type: String, unique: true, index: true, required: true },
  net: { type: String, index: true, required: true },
  balance: { type: String,  index: false, required: true },
  pwd: { type: String, index: false, required: true },
  salt: { type: String, index: false, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: false, required: true },
  createdAt: { type: Date, index: false, default: Date.now },
  apiKey: { type: String, index: true, required: false }, // set to true before commit.
  addresses: { type: Array, index: false }
})