node-xml4js
===========

`node-xml4js` is a [Node.js](nodejs.org) package providing an XML to JavaScript parser using XML Schema to guide
conversion. Main motivation is that instead of detecting the structure of an XML document, structure is extracted
automatically from the XML Schema which makes output consistent for all XML documents. For example, arrays are always
arrays even when there is only one element in the particular XML document, and if there is only one element allowed,
then there will be no one-element array wrapped around. Similar for attributes.

Package builds upon [node-xml2js](https://github.com/Leonidas-from-XIV/node-xml2js), detects and parses XML Schema
which is then used to transform JavaScript object into a consistent schema-driven structure. API follows that of
`node-xml2js`.

Installation
------------

You can use [npm](https://npmjs.org/) to install it with:

```
npm install xml4js
```

Examples
--------

```javascript
var util = require('util');
var xml4js = require('xml4js');

// Will automatically download and use any missing schemas
xml4js.parseString(xml, {downloadSchemas: true}, function (err, result) {
    console.log(util.inspect(result, false, null));
});
```

```javascript
var fs = require('fs');
var util = require('util');
var xml4js = require('xml4js');

// Most of xml2js options should still work
var options = {};
var parser = new xml4js.Parser(options);

// Default is to not download schemas automatically, so we should add it manually
var schema = fs.readFileSync('schema.xsd', {encoding: 'utf-8'});
parser.addSchema('http://www.example.com/Schema', schema, function (err, importsAndIncludes) {
    // importsAndIncludes contains schemas to be added as well to satisfy all imports and includes found in schema.xsd
    parser.parseString(xml, function (err, result) {
        console.log(util.inspect(result, false, null));
    });
});
```
