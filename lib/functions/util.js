/**
  Helper class.
*/
// const trace = require('debug')('trace')

function memoryUsage(process) {
    const r = process.memoryUsage()
    if (!isNaN(r.rss))
        r.rss = Number(r.rss / 1024 / 1024).toFixed(2)
    if (!isNaN(r.heapTotal))
        r.heapTotal = Number(r.heapTotal / 1024 / 1024).toFixed(2)
    if (!isNaN(r.heapUsed))
        r.heapUsed = Number(r.heapUsed / 1024 / 1024).toFixed(2)
    if (!isNaN(r.external))
        r.external = Number(r.external / 1024 / 1024).toFixed(2)
    if (!isNaN(r.arrayBuffers))
        r.arrayBuffers = Number(r.arrayBuffers / 1024 / 1024).toFixed(2)
    return r
}

module.exports = {
    memoryUsage: memoryUsage
}