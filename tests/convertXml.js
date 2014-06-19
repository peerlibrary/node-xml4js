#!/usr/bin/env node

var xml4json = require('../lib/xml4json');

var SCHEMAS = {
  'http://www.example.com/PO': './xml/po.xsd',
  'http://www.example.com/IPO': ['./xml/ipo.xsd', './xml/address.xsd'],
  'http://www.example.com/Report': './xml/report.xsd'
};

xml4json({
  downloadSchemas: false
}, SCHEMAS);
