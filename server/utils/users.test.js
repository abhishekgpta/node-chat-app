const expect = require ("expect");

const {Users} = require("./users");

describe("Users",()=>{
	var users;
	beforeEach(()=>{
		users = new Users();
		users.users = [{
			id:'1',
			name:'Abhishek',
			room:'Office'
		},{
			id:'2',
			name:'ajeet',
			room:'bbt'
		},{
			id:'3',
			name:'abhilash',
			room:'Office'
		}]
	})
	it("Should add new Users",()=>{
		var users = new Users();
		var user = {
			id:"123",
			name:"Abhishek",
			room:"The Office"
		};
		var resUser = users.addUser(user.id, user.name,user.room);

		expect(users.users).toEqual([user]);
	});

	it("should return name for office room",()=>{
		var usersList = users.getUserList("Office");
		expect(usersList).toEqual(["Abhishek","abhilash"]);
	});

	it("should return name for bbt room",()=>{
		var usersList = users.getUserList("bbt");
		expect(usersList).toEqual(["ajeet"]);
	});

	it("should remove user",()=>{
		var userId = "1";
		var user = users.removeUser(userId);
		expect(user.id).toEqual(userId);
		expect(users.users.length).toBe(2);
	});

	it("should not remove user",()=>{
		var userId = "99";
		var user = users.removeUser(userId);
		expect(user).toNotExist();
		expect(users.users.length).toBe(3);
	});

	it("should find user",()=>{
		var userId = "2";
		var user = users.getUser(userId);
		expect(user.id).toBe(userId);
	});

	it("should not find user",()=>{
		var userId = "99";
		var user = users.getUser(userId);
		expect(user).toNotExist();
	});
})