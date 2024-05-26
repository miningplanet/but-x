module.exports = new require('mongoose').Schema({
  createdAt: { type: Date, expires: 86400, default: Date.now() },
  address: { type: String, default: "", index: true },
  port: { type: String, default: "" },
  protocol: { type: String, default: "" },
  version: { type: String, default: "" },
  type: { type: String, default: "upstream" }
})