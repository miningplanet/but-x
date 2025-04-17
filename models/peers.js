module.exports = new require('mongoose').Schema({
  createdAt: { type: Date, expires: 86400, default: Date.now() },
  address: { type: String, default: "", index: true },
  port: { type: String, default: "" },
  protocol: { type: String, default: "" },
  version: { type: String, default: "" },
  lastsend: { type: Number, default: -1, index: false },
  lastreceived: { type: Number, default: -1, index: false },
  bytessend: { type: Number, default: -1, index: false },
  bytesreceived: { type: Number, default: -1, index: false },
  conntime: { type: Number, default: -1, index: false },
  ping: { type: Number, default: -1, index: false },
  startingheight: { type: Number, default: -1, index: false },
  banscore: { type: Number, default: -1, index: false },
  country: { type: String, default: "" },
  country_code: { type: String, default: "" }
})