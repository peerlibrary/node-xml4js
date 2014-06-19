#!/usr/bin/env node

var xml4json = require('../lib/xml4json');

var SCHEMAS = {
  'http://www.example.org/Other': './other/test.xsd'
};

xml4json({
  downloadSchemas: false,
  trim: true
}, SCHEMAS);
