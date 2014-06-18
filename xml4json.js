#!/usr/bin/env node

var util = require('util');
var xml4js = require('./xml4js');

process.stdin.resume();
process.stdin.setEncoding('utf-8');

var input = '';
process.stdin.on('data', function (chunk) {
  input += chunk;
}).on('end', function () {
  xml4js.parseString(input, {
    downloadSchemas: true
  }, function (err, result) {
    if (err) {
      if (err.stack) {
        console.error(err.stack);
      }
      else {
        console.error('' + err);
      }
      process.exit(1);
    }
    else {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
  });
});
