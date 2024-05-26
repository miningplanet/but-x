/*
* Generate minified CSS (.min.css).
* 
* Execute this script:
*
*   node ./scripts/compile_css.js
*
*     Generates
*       - ./public/css/_theme-selector.scss'
*       - ./public/css/style.min.css
*
*   node ./scripts/compile_css.js ${net}
*
*     Generates
*       - ./public/css/${net}.min.css
*/

const fs = require('fs')
const settings = require('../lib/settings')
const sass = require('sass')
const net = process.argv[2]

if (process.argv.length < 3) {
  console.log('Compiling base CSS file. To compile CSS for a chain. Use %s.', settings.getAllNet())
  const shared_pages = settings.get(net, 'shared_pages')
  var file = './public/css/_theme-selector.scss'
  fs.writeFile(file, `$theme-name: "${shared_pages.theme}";`, function (err) {
    console.log("Stored CSS theme selector to '%s'.", file)
    const minified = sass.compile('./public/css/style.scss', { style: 'compressed' })
    file = './public/css/style.min.css'
    fs.writeFile(file, minified.css, function (err) {
      console.log("Stored minified base CSS to '%s'.", file)
      process.exit(0)
    })
  })
} else {
  if (settings.getNetOrNull(net)) {
    console.log('Compiling CSS for net %s. Please wait..', net)  
    const custom_minified = sass.compile('./public/css/' + net + '.scss', { style: 'compressed' })
    const file = './public/css/' + net + '.min.css'
    fs.writeFile(file, custom_minified.css, function (err) {
      if (err) {
        console.log("Failed to store minified CSS for net '%s' to '%s'.", net, file)
        process.exit(1)
      } else {
        console.log("Stored minified CSS for net '%s' to '%s'.", net, file)
        process.exit(0)
      }
    })
  } else {
    console.log("Net '%s' not found.", net)
    process.exit(1)
  }
}
