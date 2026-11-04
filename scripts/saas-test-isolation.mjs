// Loaded only by the isolated acceptance runner. This is an accidental-egress
// guard for trusted test code, not a sandbox for malicious JavaScript.
import net from 'node:net';

if (process.env.NODE_ENV !== 'test') throw new Error('SAAS_TEST_ONLY');

const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host).toLowerCase());
const denied = () => new Error('SAAS_TEST_NETWORK_BLOCKED');
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, options) {
  let url;
  try { url = new URL(input instanceof Request ? input.url : input); }
  catch { throw denied(); }
  if (!['http:', 'https:'].includes(url.protocol) || !local(url.hostname)) throw denied();
  return originalFetch.call(this, input, options);
};

// Cover HTTP/HTTPS/SSH clients as well as fetch. Tests may replace the provider
// function, but an accidental real connection still reaches this boundary.
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' && values[0] !== null
    ? values[0]
    : { port: values[0], host: typeof values[1] === 'string' ? values[1] : 'localhost' };
  const port = Number(options.port);
  if (typeof options.path === 'string' || !Number.isInteger(port) || port < 1 || port > 65535 || !local(options.host ?? 'localhost')) throw denied();
  return originalConnect.apply(this, args);
};
