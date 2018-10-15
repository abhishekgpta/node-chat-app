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
		// console.log("new message",message);
		var formattedTime = moment(message.createdAt).format('h:mm a')
		var template = jQuery("#message-template").html();
		var html = Mustache.render(template,{
			text:message.text,
			from:message.from,
			createdAt:formattedTime
		});
		jQuery("#messages").append(html)
	});
	socket.on("newLocationMessage",function(message){
		var formattedTime = moment(message.createdAt).format('h:mm a');
		var template = jQuery("#location-message-template").html();
		var html = Mustache.render(template,{
			from:message.from,
			createdAt:formattedTime,
			url:message.url,
		});
		jQuery("#messages").append(html);
	});
	// socket.emit('createMessage',{
	// 	from:'abhishek',
	// 	text:"hi"
	// },function(data){
	// 	console.log("got it",data);
	// });
jQuery("#message-form").on("submit",function(e){
	e.preventDefault();

	var messageTextBox = jQuery('[name=message]');
	socket.emit("createMessage",{
		from:"User",
		text:messageTextBox.val()
	},function(){
		messageTextBox.val("");
	});
});

var locationButton = jQuery("#send-location");
locationButton.on('click',function(){
	if(!navigator.geolocation){
		return alert('Geo location not supported by your browser');
	}
	locationButton.attr("disabled","disabled").text("Sending location...");
	navigator.geolocation.getCurrentPosition(function(position){
		console.log(position);
		locationButton.removeAttr("disabled").text("Sending location");
		socket.emit('createLocationMessage',{
			latitude:position.coords.latitude,
			longitude: position.coords.longitude
		})
	},function(){
		locationButton.removeAttr("disabled").text("Sending location");
		alert("unable to fetch location");
	});
})