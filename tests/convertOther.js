#!/usr/bin/env node

var xml4json = require('../lib/xml4json');

var SCHEMAS = {
  'http://www.example.org/Other1': './other/test1.xsd'
};

xml4json({
  downloadSchemas: false,
  trim: true
}, SCHEMAS);
