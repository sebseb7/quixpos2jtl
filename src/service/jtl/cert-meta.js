const { X509Certificate } = require('crypto');

/** Derive pairing and display metadata from a PEM-encoded TLS certificate. */
function readCertMetadata(certPem) {
  try {
    const x509 = new X509Certificate(certPem);
    const sha1 = x509.fingerprint; // colon-separated uppercase hex
    const cnMatch = (x509.subject || '').match(/CN=([^\n,]+)/);
    const commonName = cnMatch ? cnMatch[1].trim() : '';

    return {
      commonName,
      subjectAltNames: x509.subjectAltName || '',
      validFrom: x509.validFrom || '',
      validTo: x509.validTo || '',
      subject: x509.subject || '',
      issuer: x509.issuer || '',
      certificateFingerprint: (sha1 || '').replace(/:/g, ''),
      certificateSerialNumber: x509.serialNumber || '',
      serverFingerprint: (sha1 || '').replace(/:/g, '-'),
    };
  } catch {
    return {
      commonName: '',
      subjectAltNames: '',
      validFrom: '',
      validTo: '',
      subject: '',
      issuer: '',
      certificateFingerprint: '',
      certificateSerialNumber: '',
      serverFingerprint: '',
    };
  }
}

module.exports = { readCertMetadata };
