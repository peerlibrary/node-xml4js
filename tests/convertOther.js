#!/usr/bin/env node

var xml4json = require('../lib/xml4json');

var SCHEMAS = {
  'http://www.example.org/Other1': './other/test1.xsd',
  'http://www.example.org/Other2': './other/test2.xsd'
};

xml4json({
  downloadSchemas: false,
  trim: true
}, SCHEMAS);
