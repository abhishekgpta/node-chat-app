const moment = require("moment");

var someTimestamp = moment().valueOf();
console.log(someTimestamp);
var date = moment();
date.add(1,'Y');
console.log(date.format('MMM Do, YYYY h:mm a'));