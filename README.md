node-xml4js
===========

`node-xml4js` is a [Node.js](nodejs.org) package providing an XML to JavaScript parser using XML Schema to guide
conversion. Main motivation is that instead of guessing the structure of an XML document from the document itself,
structure is created automatically from the XML Schema which makes output consistent for all XML documents, not just
one at hand. For example, arrays are always arrays even when there is only one element in the particular XML document,
and if there is only one element allowed, then there will be no one-element array wrapped around. This makes
programmatically traversing the structure much easier, because structure is consistent and predictable.

Package builds upon [node-xml2js](https://github.com/Leonidas-from-XIV/node-xml2js), detects and parses XML Schema
which is then used to transform JavaScript object into a consistent schema-driven structure. API follows that of
`node-xml2js`. By default it maps attributes to `$` field and values to `_` field. Values are converted from strings
to corresponding reasonable JavaScript type.

Examples
--------

XML taken from [XML Primer](http://www.w3.org/TR/xmlschema-0/#po.xml):

```xml
<?xml version="1.0"?>
<purchaseOrder orderDate="1999-10-20" xmlns="http://www.example.com/PO">
   <shipTo country="US">
      <name>Alice Smith</name>
      <street>123 Maple Street</street>
      <city>Mill Valley</city>
      <state>CA</state>
      <zip>90952</zip>
   </shipTo>
   <billTo country="US">
      <name>Robert Smith</name>
      <street>8 Oak Avenue</street>
      <city>Old Town</city>
      <state>PA</state>
      <zip>95819</zip>
   </billTo>
   <comment>Hurry, my lawn is going wild!</comment>
   <items>
      <item partNum="872-AA">
         <productName>Lawnmower</productName>
         <quantity>1</quantity>
         <USPrice>148.95</USPrice>
         <comment>Confirm this is electric</comment>
      </item>
      <item partNum="926-AA">
         <productName>Baby Monitor</productName>
         <quantity>1</quantity>
         <USPrice>39.98</USPrice>
         <shipDate>1999-05-21</shipDate>
      </item>
   </items>
</purchaseOrder>
```

Without using a XML Schema to guide a conversion process, with explicit arrays turned on, you would get:

```json
{
  "purchaseOrder": {
    "$": {
      "orderDate": "1999-10-20",
      "xmlns": "http://www.example.com/PO"
    },
    "shipTo": [
      {
        "$": {
          "country": "US"
        },
        "name": [
          "Alice Smith"
        ],
        "street": [
          "123 Maple Street"
        ],
        "city": [
          "Mill Valley"
        ],
        "state": [
          "CA"
        ],
        "zip": [
          "90952"
        ]
      }
    ],
    "billTo": [
      {
        "$": {
          "country": "US"
        },
        "name": [
          "Robert Smith"
        ],
        "street": [
          "8 Oak Avenue"
        ],
        "city": [
          "Old Town"
        ],
        "state": [
          "PA"
        ],
        "zip": [
          "95819"
        ]
      }
    ],
    "comment": [
      "Hurry, my lawn is going wild!"
    ],
    "items": [
      {
        "item": [
          {
            "$": {
              "partNum": "872-AA"
            },
            "productName": [
              "Lawnmower"
            ],
            "quantity": [
              "1"
            ],
            "USPrice": [
              "148.95"
            ],
            "comment": [
              "Confirm this is electric"
            ]
          },
          {
            "$": {
              "partNum": "926-AA"
            },
            "productName": [
              "Baby Monitor"
            ],
            "quantity": [
              "1"
            ],
            "USPrice": [
              "39.98"
            ],
            "shipDate": [
              "1999-05-21"
            ]
          }
        ]
      }
    ]
  }
}
```

But this package gives you this:

```json
{
  "purchaseOrder": {
    "$": {
      "orderDate": "1999-10-20T00:00:00.000Z"
    },
    "shipTo": {
      "$": {
        "country": "US"
      },
      "name": "Alice Smith",
      "street": "123 Maple Street",
      "city": "Mill Valley",
      "state": "CA",
      "zip": 90952
    },
    "billTo": {
      "$": {
        "country": "US"
      },
      "name": "Robert Smith",
      "street": "8 Oak Avenue",
      "city": "Old Town",
      "state": "PA",
      "zip": 95819
    },
    "comment": "Hurry, my lawn is going wild!",
    "items": {
      "item": [
        {
          "$": {
            "partNum": "872-AA"
          },
          "productName": "Lawnmower",
          "quantity": 1,
          "USPrice": 148.95,
          "comment": "Confirm this is electric"
        },
        {
          "$": {
            "partNum": "926-AA"
          },
          "productName": "Baby Monitor",
          "quantity": 1,
          "USPrice": 39.98,
          "shipDate": "1999-05-21T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Installation
------------

You can use [npm](https://npmjs.org/) to install it with:

```
npm install xml4js
```

Usage
-----

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
