var util = require('util');
var xml2js = require('xml2js');
var _ = require('underscore');

var assert = require('./assert');

function isPlainObject(obj) {
  if (!_.isObject(obj) || _.isArray(obj) || _.isFunction(obj)) {
    return false;
  }
  else if (obj.constructor !== Object) {
    return false;
  }
  return true;
}

function deepExtend() {
  var obj = arguments[0];
  var args = Array.prototype.slice.call(arguments, 1);
  _.each(args, function(source) {
    _.each(source, function(value, key) {
      if (obj[key] && value && isPlainObject(obj[key]) && isPlainObject(value)) {
        obj[key] = deepExtend(obj[key], value);
      }
      else {
        obj[key] = value;
      }
    });
  });
  return obj;
}

var ValidatorMixin = {
  resolveType: function (xpath, typeName) {
    var self = this;

    if (!self.types[typeName]) {
      throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(self.types, false, null));
    }
    else if (self.types[typeName].base) {
      var bases = self.types[typeName].base;
      var other = _.omit(self.types[typeName], 'base');
      if (!_.isArray(bases)) {
        bases = [bases];
      }
      var resolved = [];
      _.each(bases, function (base) {
        resolved = resolved.concat(_.map(self.resolveType(xpath, base), function (res) {
          // Make sure we do not override some other type by accident
          var r = deepExtend({}, res, other);
          // If it is a restriction we limit children to those from other
          if (self.types[typeName].restriction) {
            r.children = _.pick(r.children, _.keys(other.children));
          }
          // Attributes can be restricted only in content, which we do not care about
          r.attributes = _.pick(r.attributes, _.keys(other.attributes));
          return r;
        }));
      });
      return resolved;
    }
    else {
      return [self.types[typeName]];
    }
  },

  resolveAttributeType: function (xpath, typeName) {
    var self = this;

    while (_.isObject(typeName)) {
      assert(typeName.ref, typeName);
      if (!self.attributes[typeName.ref]) {
        throw new xml2js.ValidationError("Referenced attribute " + typeName.ref + " not found, xpath: " + xpath + ", known attributes: " + util.inspect(self.attributes, false, null));
      }
      typeName = self.attributes[typeName.ref];
    }
    return typeName;
  },

  resolveElement: function (xpath, element) {
    var self = this;

    var isArrayDefault = null;
    while (element.ref) {
      if (!self.elements[element.ref]) {
        throw new xml2js.ValidationError("Referenced element " + element.ref + " not found, xpath: " + xpath + ", known attributes: " + util.inspect(self.elements, false, null));
      }
      if (_.has(element, 'isArrayDefault')) {
        isArrayDefault = element.isArrayDefault;
      }
      element = self.elements[element.ref];
    }
    if (_.has(element, 'isArray')) {
      assert(_.isBoolean(element.isArray), element);
    }
    else if (_.isBoolean(isArrayDefault)) {
      element = _.clone(element);
      element.isArray = isArrayDefault;
    }
    return element;
  },

  resolveToParse: function (xpath, typeName) {
    var self = this;

    if (!self.types[typeName]) {
      throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(self.types, false, null));
    }
    else if (self.types[typeName].parse) {
      return [self.types[typeName].parse];
    }
    else if (self.types[typeName].base) {
      if (_.isArray(self.types[typeName].base)) {
        var res = [];
        _.each(self.types[typeName].base, function (base) {
          res = res.concat(self.resolveToParse(xpath, base));
        });
        return res;
      }
      else {
        return self.resolveToParse(xpath, self.types[typeName].base);
      }
    }
    else {
      return [];
    }
  },

  tryParse: function (parse, value) {
    var self = this;

    var exception = null;
    for (var i = 0; i < parse.length; i++) {
      try {
        return parse[0](value);
      }
      catch (e) {
        exception = e;
      }
    }
    assert(exception);
    throw exception;
  },

  tryChildren: function (xpath, type) {
    var self = this;

    for (var i = 0; i < type.length; i++) {
      if (type[i].anyChildren) {
        return self.elements;
      }
      else if (type[i].children) {
        return type[i].children;
      }
    }
    throw new xml2js.ValidationError("Type does not expect children, xpath: " + xpath + ", type: " + util.inspect(type, false, null));
  },

  resolveToAttributes: function (xpath, typeName) {
    var self = this;

    if (!self.types[typeName]) {
      throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(self.types, false, null));
    }
    else if (self.types[typeName].attributes) {
      return self.types[typeName].attributes;
    }
    else {
      return {};
    }
  },

  tryRemoveArrays: function (xpath, type, newValue) {
    var self = this;

    var exception = null;
    for (var i = 0; i < type.length; i++) {
      var value = _.clone(newValue);
      try {
        if (type[i].anyChildren) {
          // TODO: Currently we support only one "any" element at the time (it can have multiple entries, but they have to be same "any" tag). Can there be multiple "any" elements defined?
          assert(_.size(value) === 1, value);
          _.each(value, function (child, name) {
            if (name === self.attrkey || name === self.charkey || name === self.xmlnskey) {
              // Attribute, character content, and namespace keys are not part of the schema
              return;
            }
            if (!type[i].isArray) {
              assert(child.length === 1, child);
              value[name] = child[0];
            }
          });
        }
        else if (type[i].children) {
          // Children namespace might be different than current namespace, so we remove namespace both
          // from children and in the type and keys in the value and then we can match based on local name
          var namespacelessChildren = {};
          _.each(type[i].children, function (child, name) {
            namespacelessChildren[self.namespacedOrNotName({}, null, name, false)] = child;
          });
          _.each(value, function (child, name) {
            if (name === self.attrkey || name === self.charkey || name === self.xmlnskey) {
              // Attribute, character content, and namespace keys are not part of the schema
              return;
            }
            // We remove namespace from current key name as well
            var childName = self.namespacedOrNotName({}, null, name, false);
            // We checked this before, so here it should always match
            assert(namespacelessChildren[childName], type[i].children);
            if (!self.resolveElement(xpath, namespacelessChildren[childName]).isArray) {
              assert(child.length === 1, child);
              value[name] = child[0];
            }
          });
        }
        else if (!_.isEmpty(_.omit(newValue, self.attrkey, self.charkey, self.xmlnskey))) {
          throw new xml2js.ValidationError("Type does not expect children, xpath: " + xpath + ", type: " + util.inspect(type[i], false, null));
        }
        return value;
      }
      catch (e) {
        exception = e;
      }
    }
    assert(exception);
    throw exception;
  },

  resolveElementTypeName: function (xpath, namespaces, defaultNamespace, nodeAttributes, element) {
    var self = this;

    // TODO: xsi prefix should probably not be hard-coded
    if (nodeAttributes && nodeAttributes['xsi:type']) {
      if (_.isString(nodeAttributes['xsi:type'])) {
        return self.namespacedName(namespaces, defaultNamespace, nodeAttributes['xsi:type']);
      }
      else if (nodeAttributes['xsi:type'].value) {
        return self.namespacedName(namespaces, defaultNamespace, nodeAttributes['xsi:type'].value);
      }
      else {
        throw new xml2js.ValidationError("Invalid attribute xsi:type value, xpath: " + xpath + ": " + util.inspect(nodeAttributes['xsi:type'], false, null));
      }
    }
    return self.resolveElement(xpath, element).type;
  },

  nodeNamespace: function (node) {
    var self = this;

    if (!node[self.xmlnskey].uri) {
      throw new xml2js.ValidationError("Namespace information missing, element: " + util.inspect(node, false, null));
    }
    return node[self.xmlnskey].uri;
  },

  nodeNamespaces: function (node) {
    var self = this;

    if (!node[self.xmlnskey].ns) {
      throw new xml2js.ValidationError("Namespaces information missing, element: " + util.inspect(node, false, null));
    }
    return node[self.xmlnskey].ns;
  },

  // Similar to XsdSchema.namespacedName, just using arguments
  namespacedName: function (namespaces, defaultNamespace, name) {
    var self = this;

    assert(namespaces);
    assert(name);
    if (/^\{.+\}/.test(name)) {
      return name;
    }
    else if (/:/.test(name)) {
      var parts = name.split(':');
      assert(parts.length === 2, parts);
      if (!namespaces[parts[0]]) {
        throw new xml2js.ValidationError("Unknown namespace " + parts[0] + ", name: " + name + ", known namespaces: " + util.inspect(namespaces, false, null));
      }
      return '{' + namespaces[parts[0]] + '}' + parts[1];
    }
    else if (defaultNamespace) {
      return '{' + defaultNamespace + '}' + name;
    }
    else {
      throw new xml2js.ValidationError("Unqualified name and no default namespace: " + name);
    }
  },

  namespacedOrNotName: function (namespaces, defaultNamespace, name, namespaced) {
    var self = this;

    if (namespaced) {
      return self.namespacedName(namespaces, defaultNamespace, name);
    }
    else {
      return name.replace(/^\{.+\}/, '').replace(/^[^:]+:/, '');
    }
  },

  createNamespacedPath: function (stack, xpath, newValue) {
    var self = this;

    var path = [];
    _.each(stack, function (node) {
      var namespaces = self.nodeNamespaces(node);
      var defaultNamespace = self.nodeNamespace(node);
      path.push(self.namespacedName(namespaces, defaultNamespace, node['#name']));
    });
    // We get the name of the last node from the last element of the xpath
    var splitXpath = xpath.split('/');
    path.push(self.namespacedName(self.nodeNamespaces(newValue), self.nodeNamespace(newValue), splitXpath[splitXpath.length - 1]));
    return path;
  },

  normalizeNamespaces: function (namespaces, defaultNamespace, value, namespaced) {
    var self = this;

    _.each(value, function (val, key) {
      if (key === self.attrkey || key === self.charkey || key === self.xmlnskey) {
        // Ignoring attribute, character content, and namespace keys
        return;
      }
      delete value[key];
      value[self.namespacedOrNotName(namespaces, defaultNamespace, key, namespaced)] = val;
    });
  }
};

function validator(xpath, currentValue, newValue, stack) {
  var options = this;
  var parser = options.parser;

  parser.attrkey = options.attrkey;
  parser.charkey = options.charkey;
  parser.xmlnskey = options.xmlnskey;

  var path = parser.createNamespacedPath(stack, xpath, newValue);
  // We override given xpath with namespaced xpath
  xpath = '/' + path.join('/');

  var namespaces = parser.nodeNamespaces(newValue);
  var defaultNamespace = parser.nodeNamespace(newValue);

  var currentElementSet = parser.elements;

  _.each(path.slice(0, path.length - 1), function (segment, i) {
    if (!currentElementSet[segment]) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
    }
    else if (!parser.resolveElementTypeName(xpath, namespaces, defaultNamespace, stack[i][parser.attrkey], currentElementSet[segment])) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, type not specified, xpath: " + xpath + ", element: " + util.inspect(currentElementSet[segment], false, null));
    }
    else {
      var type = parser.resolveType(xpath, parser.resolveElementTypeName(xpath, namespaces, defaultNamespace, stack[i][parser.attrkey], currentElementSet[segment]));
      currentElementSet = parser.tryChildren(xpath, type);
    }
  });

  var lastSegment = path[path.length - 1];

  if (!currentElementSet[lastSegment]) {
    throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
  }

  var lastSegmentTypeName = parser.resolveElementTypeName(xpath, namespaces, defaultNamespace, newValue[parser.attrkey], currentElementSet[lastSegment]);

  var attributes = parser.resolveToAttributes(xpath, lastSegmentTypeName);
  _.each(newValue[parser.attrkey] || {}, function (value, attribute) {
    var attributeName = parser.namespacedName(namespaces, defaultNamespace, attribute);
    if (attribute.slice(0, 5) === 'xmlns') {
      delete newValue[parser.attrkey][attribute];
    }
    // TODO: xsi prefix should probably not be hard-coded
    else if (attribute.slice(0, 4) === 'xsi:') {
      delete newValue[parser.attrkey][attribute];
    }
    else if (!attributes[attributeName]) {
      throw new xml2js.ValidationError("Unexpected attribute " + attributeName + ", xpath: " + xpath + ", allowed attributes: " + util.inspect(attributes, false, null))
    }
    else {
      var parse = parser.resolveToParse(xpath, parser.resolveAttributeType(xpath, attributes[attributeName]));
      if (_.isString(value)) {
        delete newValue[parser.attrkey][attribute];
        newValue[parser.attrkey][parser.namespacedOrNotName(namespaces, defaultNamespace, attribute, options.outputWithNamespace)] = parser.tryParse(parse, value);
      }
      else if (value.value) {
        // TODO: What if user wants namespace information, we should not replace with only the value in that case
        delete newValue[parser.attrkey][attribute];
        newValue[parser.attrkey][parser.namespacedOrNotName(namespaces, defaultNamespace, attribute, options.outputWithNamespace)] = parser.tryParse(parse, value.value);
      }
      else {
        throw new xml2js.ValidationError("Invalid attribute " + attributeName + " value, xpath: " + xpath + ": " + util.inspect(value, false, null))
      }
    }
  });
  if (_.isEmpty(attributes)) {
    // This should be caught already above
    assert(_.isEmpty(newValue[parser.attrkey]), newValue[parser.attrkey]);
    delete newValue[parser.attrkey];
  }

  // Delete namespace key
  // TODO: What if user wants it? We should make this optional
  delete newValue[parser.xmlnskey];

  var parse = parser.resolveToParse(xpath, lastSegmentTypeName);
  if (parse.length !== 0) {
    // If it is string, we can try to parse it
    if (_.isString(newValue)) {
      if (_.isEmpty(attributes)) {
        newValue = parser.tryParse(parse, newValue);
      }
      else {
        var v = newValue;
        newValue = {};
        newValue[parser.charkey] = parser.tryParse(parse, v);
      }
    }
    // Only attributes and character value keys should be here
    else if (!_.isEmpty(_.without(_.keys(newValue), parser.charkey, parser.attrkey))) {
      throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", expected value, got : " + util.inspect(newValue, false, null));
    }
    else if (_.isEmpty(attributes)) {
      assert(_.isEmpty(_.without(_.keys(newValue), parser.charkey)), newValue);
      newValue = parser.tryParse(parse, newValue[parser.charkey] || '');
    }
    else {
      newValue[parser.charkey] = parser.tryParse(parse, newValue[parser.charkey] || '');
      _.each(newValue, function (child, name) {
        if (name === parser.attrkey || name === parser.charkey || name === parser.xmlnskey) {
          // Attribute, character content, and namespace keys are not part of the schema
          return;
        }
        var childName = parser.namespacedName(namespaces, defaultNamespace, name);
        if (!type[i].children[childName]) {
          throw new xml2js.ValidationError("Element (" + childName + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(type[i].children, false, null));
        }
      });
    }
  }
  else {
    var type = parser.resolveType(xpath, lastSegmentTypeName);
    newValue = parser.tryRemoveArrays(xpath, type, newValue);
    parser.normalizeNamespaces(namespaces, defaultNamespace, newValue, options.outputWithNamespace);
  }

  return newValue;
}

exports.ValidatorMixin = ValidatorMixin;
exports.validator = validator;

