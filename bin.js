#!/usr/bin/env node

var util = require('util');
var xmlxsd2js = require('./xmlxsd2js');

process.stdin.resume();
process.stdin.setEncoding('utf-8');

var input = '';
process.stdin.on('data', function (chunk) {
  input += chunk;
}).on('end', function () {
  xmlxsd2js.parseString(input, {
    downloadSchemas: true
  }, function (err, result) {
    if (err) {
      console.error('' + err);
      process.exit(1);
    }
    else {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
  });
});
