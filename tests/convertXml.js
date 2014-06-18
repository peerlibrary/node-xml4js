#!/usr/bin/env node

var async = require('async');
var fs = require('fs');
var util = require('util');
var xml4js = require('../xml4js');
var _ = require('underscore');

var SCHEMAS = {
  'http://www.example.com/PO': './xml/po.xsd',
  'http://www.example.com/IPO': ['./xml/ipo.xsd', './xml/address.xsd'],
  'http://www.example.com/Report': './xml/report.xsd'
};

var parser = new xml4js.Parser({
  downloadSchemas: false
});

async.each(_.keys(SCHEMAS), function (namespace, cb) {
  var files = SCHEMAS[namespace];
  if (!_.isArray(files)) {
    files = [files];
  }
  async.each(files, function (file, cb) {
    var content = fs.readFileSync(file, {encoding: 'utf-8'});
    parser.addSchema(namespace, content, cb);
  }, cb)
}, function (err) {
  if (err) {
    console.error('' + err);
    process.exit(2);
    return;
  }

  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  var input = '';
  process.stdin.on('data', function (chunk) {
    input += chunk;
  }).on('end', function () {
    parser.parseString(input, function (err, result) {
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
});
