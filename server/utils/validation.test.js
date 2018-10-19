const expect = require("expect");

const {isRealString} = require("./validation")

describe('isRealString',()=>{
	it("Should reject non string value",()=>{
		var res = isRealString(98);

		expect(res).toBe(false);
	});

	it("Should reject string with spaces",()=>{
		var res = isRealString("    ");

		expect(res).toBe(false);
	});

	it("Should reject string with non-spaces characters",()=>{
		var res = isRealString("  Abhishek  ");

		expect(res).toBe(true);
	});
});