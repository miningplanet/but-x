const debug = require('debug')('externalapi')
const request = require('postman-request')
const base_url = 'https://api.coingecko.com/api/v3/'
const get_coin_list_url = base_url + 'coins/list?include_platform=false'

function get_coin_list(cb) {
  request({ uri: get_coin_list_url, json: true}, function (error, response, body) {
    if (error) {
      console.error('Failed to get coin list from coingecko: %s', error)
      return cb(error, [])
    }
    else {
      debug('Got coin list from coingecko: %o.', body)
      return cb(null, body)
    }
  })
}

function get_usd_value(id, cb) {
  const get_usd_value_url = base_url + 'simple/price?ids=' + id + '&vs_currencies=usd'
  request({ uri: get_usd_value_url, json: true}, function (error, response, body) {
    if (error) {
      console.error('Failed to get USD value for %s from coingecko: %s', id, error)
      return cb(error, 0)
    } else {
      debug('Got USD value for %s from coingecko: %o.', id, body)
      if (!body[id] || isNaN(body[id].usd)) {
        console.error('USD value for %s got from coingeck is not a number.', id);
        return cb(null, 0)
      }
      return cb(null, body[id].usd)
    }
  })
}

module.exports = {
  get_coin_data: function (cb) {
    var error = null

    get_coin_list(function (err, coin_list) {
      if (err)
        error = err

      return cb(error, coin_list)
    })
  },
  get_data: function (id, cb) {
    var error = null

    get_usd_value(id, function (err, last_usd) {
      if (err)
        error = err

      return cb(error, last_usd)
    })
  }
}