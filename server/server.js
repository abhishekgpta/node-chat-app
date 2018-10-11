const path = require("path");
const http = require("http");
const express = require("express");
const socketIO = require("socket.io");

var {generateMessage,generateLocationMessage} = require("./utils/message");
const publicPath = path.join(__dirname,"../public");
const port = process.env.PORT || 3000;
var app =express();
var server = http.createServer(app);
var io = socketIO(server);

io.on('connection',(socket)=>{
	console.log("New user connected");

	// socket.emit("newMessage",{
	// 	from:"abhi@emaple.com",
	// 	text:"whatsup newMessage",
	// 	createAt:123
	// });
	socket.emit("newMessage",generateMessage('Admin',"welcome to the chat app"));
	socket.broadcast.emit("newMessage",generateMessage('Admin',"New user joined"));
	socket.on('createMessage',(message,callback)=>{
		console.log("create message",message);
		io.emit("newMessage",generateMessage(message.from,message.text));
		callback();
	});
	socket.on("createLocationMessage",(coords)=>{
		io.emit("newLocationMessage",generateLocationMessage('Admin',coords.latitude,coords.longitude));
	})
	socket.on("disconnect",()=>{
			console.log("user was disconnected");
	});
});

app.use(express.static(publicPath));
server.listen(port,()=>{
	console.log(`Server is up on port ${port}`);
})