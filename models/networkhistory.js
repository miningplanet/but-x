var mongoose = require('mongoose'),
   Schema = mongoose.Schema;

var NetworkHistorySchema = new Schema({
  blockindex: {type: Number, default: 0, index: true},
  nethash: { type: Number, default: 0 },
  difficulty_pow: { type: Number, default: 0 },
  difficulty_pos: { type: Number, default: 0 },
  difficulty_ghostrider: { type: Number, default: 0 },
  difficulty_yespower: { type: Number, default: 0 },
  difficulty_lyra2: { type: Number, default: 0 },
  difficulty_sha256d: { type: Number, default: 0 },
  difficulty_scrypt: { type: Number, default: 0 },
  difficulty_butkscrypt: { type: Number, default: 0 }
}, {id: false});

module.exports = mongoose.model('NetworkHistory', NetworkHistorySchema);