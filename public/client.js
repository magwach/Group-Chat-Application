$(document).ready(function () {
  let socket = io();

  // Handle incoming chat messages
  socket.on('chat message', (data) => {
    $('#messages').append($('<li>').text(`${data.username}: ${data.message}`));
  });

  // Handle user connection/disconnection updates
  socket.on('user', (data) => {
    $('#num-users').text(`${data.currentUsers} users online`);
    const message = `${data.username} ${data.connected ? 'has joined the chat.' : 'has left the chat.'}`;
    $('#messages').append($('<li>').html(`<b>${message}</b>`));
  });

  // Submit chat message
  $('form').off('submit').on('submit', function (e) {
    e.preventDefault();
    const messageToSend = $('#m').val();
    socket.emit('chat message', messageToSend);
    $('#m').val('');
  });
});
