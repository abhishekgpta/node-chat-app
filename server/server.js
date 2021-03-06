const path = require("path");
const http = require("http");
const express = require("express");
const socketIO = require("socket.io");

const {isRealString} = require("./utils/validation")
var {generateMessage,generateLocationMessage} = require("./utils/message");
const {Users} = require("./utils/users");

const publicPath = path.join(__dirname,"../public");
const port = process.env.PORT || 3000;
var app =express();
var server = http.createServer(app);
var io = socketIO(server);
var users = new Users();

io.on('connection',(socket)=>{
	console.log("New user connected");

	// socket.emit("newMessage",{
	// 	from:"abhi@emaple.com",
	// 	text:"whatsup newMessage",
	// 	createAt:123
	// });

	socket.on("join",(params,callback)=>{
		if(!isRealString(params.name) || !isRealString(params.room)){
			return callback("Name and room name are required.");
		}
		socket.join(params.room);
		users.removeUser(socket.id);
		users.addUser(socket.id,params.name,params.room);
		socket.emit("newMessage",generateMessage('Admin',"welcome to the chat app"));
		io.to(params.room).emit("updateUserList",users.getUserList(params.room));
		socket.broadcast.to(params.room).emit("newMessage",generateMessage('Admin',`${params.name} has joined.`));
		callback();
	});

	socket.on('createMessage',(message,callback)=>{
		var user = users.getUser(socket.id);
		if(user && isRealString(message.text)){
			io.to(user.room).emit("newMessage",generateMessage(user.name,message.text));
		}
		callback();
	});
	socket.on("createLocationMessage",(coords)=>{
		var user = users.getUser(socket.id);
		if(user){
			io.to(user.room).emit("newLocationMessage",generateLocationMessage(user.name,coords.latitude,coords.longitude));
		}
	});
	socket.on("disconnect",()=>{
		var user = users.removeUser(socket.id);
		if(user){
			io.to(user.room).emit("updateUserList",users.getUserList(user.room));
			io.to(user.room).emit("newMessage",generateMessage('Admin',`${user.name} has left.`));
		}
		console.log("user was disconnected");
	});
});

app.use(express.static(publicPath));
server.listen(port,()=>{
	console.log(`Server is up on port ${port}`);
})