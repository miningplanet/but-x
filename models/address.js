const mongoose = require('mongoose')

const addressAsset = new mongoose.Schema({
  name: String,
  since: { type: Number, index: false },
  received: { type: Number, default: 0, index: true },
  sent: { type: Number, default: 0, index: true },
  balance: {type: Number, default: 0, index: true}
})

module.exports = new mongoose.Schema({
  a_id: { type: String, unique: true, index: true},
  name: { type: String, default: '', index: true},
  since: { type: Number, index: false },
  received: { type: Number, default: 0, index: true },
  sent: { type: Number, default: 0, index: true },
  balance: {type: Number, default: 0, index: true},
  assets: [addressAsset]
}, {id: false})