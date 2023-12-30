const debug = require('debug')('debug')
const package_metadata = require('../package.json')
const minNodeVersionMajor = '19'
const minNodeVersionMinor = '9'
const minNodeVersionRevision = '0'

// get the nodejs version
var nodeVersion = process.version
var nodeVersionMajor = '0'
var nodeVersionMinor = '0'
var nodeVersionRevision = '0'

// check node.js version.
if (nodeVersion != null && nodeVersion != '' && nodeVersion.length < 16) {
  if (nodeVersion.indexOf('v') == 0)
    nodeVersion = nodeVersion.slice(1)
  
  const tokens = nodeVersion.split('.')
  
  if (tokens.length > 0)
    nodeVersionMajor = tokens[0]

  if (tokens.length > 1)
    nodeVersionMinor = tokens[1]

  if (tokens.length > 2)
    nodeVersionRevision = tokens[2]

  debug("Got node.js version '%s': %d.%d.%d.", nodeVersion, nodeVersionMajor, nodeVersionMinor, nodeVersionRevision)
} else {
  console.error('Failed to get node.js version. Install node.js min. version %s.%s.%s.\nExiting now.', minNodeVersionMajor, minNodeVersionMinor, minNodeVersionRevision)
  exit(1)
}

// check if nodejs is older than min. version
if (!(nodeVersionMajor > minNodeVersionMajor || (nodeVersionMajor == minNodeVersionMajor
    && (nodeVersionMinor > minNodeVersionMinor || (nodeVersionMinor == minNodeVersionMinor 
    && nodeVersionRevision >= minNodeVersionRevision)))))
{
  console.log('Please install an updated version of nodejs.\n\nInstalled: %s\nRequired:  %s.%s.%s', nodeVersion, minNodeVersionMajor, minNodeVersionMinor, minNodeVersionRevision)
  process.exit(0)
}

// verify CLI arguments
function check_argument_passed(cb) {
  const arg2 = process.argv[2]
  const pidName = (arg2 != null && arg2 != '' && (arg2 == 'pm2') ? arg2 : 'node')

  // check 1st argument
  if (arg2 != null) {
    const { exec } = require('child_process')

    // determine which argument was passed
    switch (arg2) {
      case 'pm2':
        // windows pm2 has problem loading locally, but other os's should work fine
        const isWinOS = process.platform == 'win32'
        
        // run a cmd to check if pm2 is installed
        exec(`npm list${(isWinOS ? ' -g' : '')} pm2`, (err, stdout, stderr) => {
          // split stdout string by new line
          var splitResponse = (stdout == null ? '' : stdout).split('\n').filter(element => element)

          // check if the cmd result contains an @ symbol
          if (splitResponse[splitResponse.length - 1].indexOf('@') == -1) {
            console.log('Installing pm2 module.. Please wait..')

            // install pm2
            exec(`npm install pm2@latest${(isWinOS ? ' -g' : '')}`, (err, stdout, stderr) => {
              // always return the pidName for now without checking results
              return cb(pidName)
            })
          } else
            return cb(pidName)
        })
        break
      default:
        // argument not passed or unknown argument
        return cb(pidName)
    }
  } else
    return cb(pidName)
}

console.log('\x1B[34m')
console.log('Launch but-x %s multicoin Xplorer', package_metadata.version)
console.log('...')
console.log('\x1B[0m')

// check if an argument was passed into this script ???
check_argument_passed(function(pidName) {
  const execSync = require('child_process').execSync
  execSync('node ./scripts/compile_css.js', {stdio : 'inherit'})

  // finished pre-loading
  process.exit(0)
})