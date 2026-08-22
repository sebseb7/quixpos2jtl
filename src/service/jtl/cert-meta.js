const { X509Certificate } = require('crypto');

/** Derive pairing metadata from a PEM-encoded TLS certificate. */
function readCertMetadata(certPem) {
  try {
    const x509 = new X509Certificate(certPem);
    const sha1 = x509.fingerprint; // colon-separated uppercase hex
    return {
      certificateFingerprint: (sha1 || '').replace(/:/g, ''),
      certificateSerialNumber: x509.serialNumber || '',
      serverFingerprint: (sha1 || '').replace(/:/g, '-'),
    };
  } catch {
    return {
      certificateFingerprint: '',
      certificateSerialNumber: '',
      serverFingerprint: '',
    };
  }
}

module.exports = { readCertMetadata };
