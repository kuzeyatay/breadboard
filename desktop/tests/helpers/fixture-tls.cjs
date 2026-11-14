const { X509Certificate } = require("node:crypto");
const { generate } = require("selfsigned");

// Keep real HTTPS/HSTS behavior in DNS-mapped browser fixtures. Trust only this
// run's ephemeral certificate, and only in the isolated test sessions.
exports.createFixtureTls = async () => {
  const certificate = await generate([{ name: "commonName", value: "Breadboard test fixture" }], {
    keySize: 2048,
    notBeforeDate: new Date(Date.now() - 60_000),
    notAfterDate: new Date(Date.now() + 86_400_000),
  });
  const fingerprint = new X509Certificate(certificate.cert).fingerprint256;
  return {
    options: { key: certificate.private, cert: certificate.cert },
    trust(profile) {
      profile.setCertificateVerifyProc((request, callback) => {
        let matches = false;
        try { matches = new X509Certificate(request.certificate.data).fingerprint256 === fingerprint; } catch {}
        callback(matches ? 0 : -3);
      });
    },
  };
};
