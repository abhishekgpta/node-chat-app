var socket = io();

	socket.on("connect",function(){
		console.log("connected to server")

		// socket.emit('createMessage',{
		// 	from:'abhishek@emapl.com',
		// 	text:"whatsup man"
		// });
	});
	socket.on("disconnect",function(){
		console.log("disconnected from server")
	});

	socket.on("newMessage",function(message){
		console.log("new message",message);
		var li = jQuery('<li></ki>')
		li.text(`${message.from}:${message.text}`);

		jQuery("#messages").append(li);
	});
	socket.on("newLocationMessage",function(message){
		console.log(message);
		var li = jQuery('<li></ki>');
		var a = jQuery("<a target='_blank'>My current Location</a>");
		li.text(`${message.from}:`);
		a.attr('href',message.url);
		li.append(a);
		jQuery("#messages").append(li);
	});
	// socket.emit('createMessage',{
	// 	from:'abhishek',
	// 	text:"hi"
	// },function(data){
	// 	console.log("got it",data);
	// });
jQuery("#message-form").on("submit",function(e){
	e.preventDefault();
	socket.emit("createMessage",{
		from:"User",
		text:jQuery('[name=message]').val()
	},function(){

	});
});

var locationButton = jQuery("#send-location");
locationButton.on('click',function(){
	if(!navigator.geolocation){
	return alert('Geo location not supported by your browser');
	}
	navigator.geolocation.getCurrentPosition(function(position){
		console.log(position);
		socket.emit('createLocationMessage',{
			latitude:position.coords.latitude,
			longitude: position.coords.longitude
		})
	},function(){
		alert("unable to fetch location");
	});
})