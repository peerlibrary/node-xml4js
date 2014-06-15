#!/usr/bin/env node

var util = require('util');
var xmlxsd2js = require('./xmlxsd2js');

process.stdin.resume();
process.stdin.setEncoding('utf-8');

var input = '';
process.stdin.on('data', function (chunk) {
  input += chunk;
}).on('end', function () {
  xmlxsd2js.parseString(input, function (err, result) {
    if (err) {
      console.error(err);
    }
    else {
      console.log(util.inspect(result, false, null));
    }
  });
});
