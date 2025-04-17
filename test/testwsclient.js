const { WebSocket } = require('ws')
const socket = new WebSocket('ws://localhost:3004/peers/subscribe/upstream/yerbas')

// Event listener for WebSocket connection open
socket.addEventListener('open', () => {
  console.log('Connected to WebSocket server.')
  socket.send('iloveyou')
})

// Event listener for incoming messages
socket.addEventListener('message', (event) => {
  console.log("Got event: " + JSON.stringify(event))
  setTimeout(function() {
    socket.send('iloveyou2')
  }, 1000)
})

// Function to send messages
function sendMessage() {
  const messageInput = document.getElementById('messageInput')
  const message = messageInput.value
  socket.send(message)
  messageInput.value = ''
}