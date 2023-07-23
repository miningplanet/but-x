const debug = require('debug')('market')
const trace = require('debug')('trace')

function low(coin, exchange, trades, start) {
    var low = Number(Number.MAX_SAFE_INTEGER)
    if (trades && Array.isArray(trades)) {
        trace("Aggregate 24h low for %s/%s.", coin, exchange)
        for (var i = 0; i < trades.length; i++) {
            if (!isNaN(trades[i].timestamp)) {
                if (Number(trades[i].timestamp) * 1000 >= start) {
                    if (!isNaN(trades[i].price)) {
                        const price = Number(trades[i].price)
                        if (price < low) {
                            low = price
                            trace("Set new low %d.", low)
                        }
                    } else {
                        trace("WARN: Skip. price isNaN '%s'", price)
                        continue
                    }
                } else
                    break
            } else {
                trace("WARN: Skip. timestamp isNaN '%s'", timestamp)
                continue
            }
        }
    } else 
        trace("WARN: No trade history found. Cannot calculate low.")
    return low
}

function high(coin, exchange, trades, start) {
    var high = Number(0)
    if (trades && Array.isArray(trades)) {
        trace("Aggregate 24h high for %s/%s.", coin, exchange)
        for (var i = 0; i < trades.length; i++) {
            if (!isNaN(trades[i].timestamp)) {
                if (Number(trades[i].timestamp) * 1000 >= start) {
                    if (!isNaN(trades[i].price)) {
                        const price = Number(trades[i].price)
                        if (price > high) {
                            high = price
                            trace("Set new low %d.", high)
                        }
                    } else {
                        trace("WARN: Skip. price isNaN '%s'", price)
                        continue
                    }
                } else
                    break
            } else {
                trace("WARN: Skip. timestamp isNaN '%s'", timestamp)
                continue
            }
        }
    } else 
        trace("WARN: No trade history found. Cannot calculate high.")
    return high
}

function pair(coin, exchange, trades, start) {
    var n = Number(0)
    if (trades && Array.isArray(trades)) {
        trace("Aggregate 24h pair volume for %s/%s.", coin, exchange)
        for (var i = 0; i < trades.length; i++) {
            if (!isNaN(trades[i].timestamp)) {
                if (Number(trades[i].timestamp) * 1000 >= start) {
                    if (!isNaN(trades[i].price) && !isNaN(trades[i].quantity)) {
                        const price = Number(trades[i]['price'])
                        const quantity = Number(trades[i]['quantity'])
                        n += (price * quantity)
                        trace("Added quantity %d with price %d -> %d, added %d.", quantity, price, n, (price * quantity))
                    } else {
                        trace("WARN: Skip. price or quantity isNaN '%s' '%s'", price, quantity)
                        continue
                    }
                } else
                    break
            } else {
                trace("WARN: Skip. timestamp isNaN '%s'", timestamp)
                continue
            }
        }
    } else 
        trace("WARN: No trade history found. Cannot pair volume.")
    return n
}

function initial(coin, exchange, trades, start) {
    var n
    if (trades && Array.isArray(trades)) {
        trace("Aggregate 24h initial price for %s/%s.", coin, exchange)
        for (var i = 0; i < trades.length; i++) {
            if (!isNaN(trades[i].timestamp)) {
                if (Number(trades[i].timestamp) * 1000 >= start) {
                    if (!isNaN(trades[i].price)) {
                        const price = Number(trades[i]['price'])
                        n = price
                        trace("Set new initial price %d.", price)
                    } else {
                        trace("WARN: Skip. price isNaN '%s'", price)
                        continue
                    }
                } else
                    break
            } else {
                trace("WARN: Skip. timestamp isNaN '%s'", timestamp)
                continue
            }
        }
    } else 
        trace("WARN: No trade history found. Cannot get initial price.")
    return n
}

function last(coin, exchange, trades, start) {
    var n
    if (trades && Array.isArray(trades)) {
        trace("Get last 24h price for %s/%s.", coin, exchange)
        for (var i = 0; i < trades.length; i++) {
            if (!isNaN(trades[i].timestamp)) {
                if (Number(trades[i].timestamp) * 1000 >= start) {
                    if (!isNaN(trades[i].price)) {
                        const price = Number(trades[i]['price'])
                        n = price
                        trace("Set last price %d.", price)
                        break
                    } else {
                        trace("WARN: Skip. price isNaN '%s'", price)
                        continue
                    }
                } else
                    break
            } else {
                trace("WARN: Skip. timestamp isNaN '%s'", timestamp)
                continue
            }
        }
    } else 
        trace("WARN: No trade history found. Cannot get last price.")
    return n
}

module.exports = {
    low: low,
    high: high,
    pair: pair,
    initial: initial,
    last: last
}