function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

function xmlTag(tag, value) {
  if (value == null) {
    return `<${tag}/>`;
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function xmlElement(tag, childrenXml) {
  return `<${tag}>${childrenXml.join('')}</${tag}>`;
}

module.exports = {
  xmlTag,
  xmlElement,
};
