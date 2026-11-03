import ssh2 from 'ssh2';
const { Server, utils } = ssh2;
import { createHash, generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });

// Actual SSH + SFTP v3 protocol fixture, with only read operations accepted.
export async function startSftp(options = {}) {
  const hostKeySha256 = createHash('sha256').update(utils.parseKey(privateKey).getPublicSSH()).digest('hex');
  const files = new Map(Object.entries(options.files ?? { 'report.csv': 'reference,amount\n0599,100\n' }).map(([name, value]) => [name,
    typeof value === 'string' ? { bytes: Buffer.from(value), mtime: 1700000000, mode: 0o100400 } : value]));
  const clients = new Set();
  const operations = [];
  const server = new Server({ hostKeys: [privateKey] }, client => {
    client.setNoDelay(true);
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => {
      if (options.anonymousOnly) { if (ctx.method === 'none') ctx.accept(); else ctx.reject(); return; }
      if (ctx.method === 'publickey' && ctx.username === 'reader' && options.authorizedKey && ctx.key.data.equals(options.authorizedKey.getPublicSSH()) && (!ctx.signature || options.authorizedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)) { ctx.accept(); return; }
      if (ctx.method === 'password' && ctx.username === 'reader' && ctx.password === 'fixture-password') ctx.accept();
      else ctx.reject();
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('sftp', acceptSftp => {
        const sftp = acceptSftp();
        let handleSeq = 0;
        const handles = new Map();
        const status = (id, code = 4) => sftp.status(id, code);
        const attrs = file => ({ size: file.bytes.length, uid: 1, gid: 1, mode: file.mode, atime: 1700000000, mtime: file.mtime });
        function fileFor(path) { return files.get(path.replace(/^\/reports\//, '')); }
        sftp.on('error', () => {});
        sftp.on('REALPATH', (id, path) => {
          operations.push(['REALPATH', path]);
          sftp.name(id, [{ filename: options.realpath?.(path) ?? path, longname: '', attrs: {} }]);
        });
        sftp.on('LSTAT', (id, path) => {
          operations.push(['LSTAT', path]);
          options.onLstat?.(path, files);
          if (path === '/' || path === '/reports') sftp.attrs(id, { size: 0, uid: 1, gid: 1, mode: 0o40700, atime: 1700000000, mtime: 1700000000 });
          else {
            const file = fileFor(path);
            if (file) sftp.attrs(id, attrs(file)); else status(id, 2);
          }
        });
        sftp.on('OPENDIR', (id, path) => {
          operations.push(['OPENDIR', path]);
          const handle = Buffer.from(String(++handleSeq));
          handles.set(handle.toString(), { type: 'dir', reads: 0 });
          sftp.handle(id, handle);
        });
        sftp.on('READDIR', (id, handle) => {
          operations.push(['READDIR']);
          const state = handles.get(handle.toString());
          if (!state) return status(id, 2);
          const page = state.reads++;
          if (options.repeatEmptyListing) { sftp.name(id, []); return; }
          if (options.repeatDotOnlyListing || (options.dotOnlyFirstPage && page === 0)) {
            sftp.name(id, ['.', '..'].map(filename => ({ filename, longname: '', attrs: { size: 0, uid: 1, gid: 1, mode: 0o40700, atime: 1700000000, mtime: 1700000000 } }))); return;
          }
          if (options.repeatListing || page === (options.dotOnlyFirstPage ? 1 : 0)) sftp.name(id, [...files].map(([filename, file]) => ({ filename, longname: '', attrs: attrs(file) })));
          else status(id, 1);
        });
        sftp.on('OPEN', (id, path, flags) => {
          operations.push(['OPEN', path, flags]);
          if (flags !== 1) return status(id, 3);
          options.onOpen?.(path, files);
          const file = fileFor(path);
          if (!file) return status(id, 2);
          const handle = Buffer.from(String(++handleSeq));
          handles.set(handle.toString(), { type: 'file', file });
          sftp.handle(id, handle);
        });
        sftp.on('FSTAT', (id, handle) => {
          operations.push(['FSTAT']);
          const file = handles.get(handle.toString())?.file;
          if (file) sftp.attrs(id, attrs(file)); else status(id, 2);
        });
        sftp.on('READ', (id, handle, offset, length) => {
          operations.push(['READ', offset, length]);
          const file = handles.get(handle.toString())?.file;
          if (!file) return status(id, 2);
          options.onRequestRead?.();
          if (options.disconnectAt != null && offset >= options.disconnectAt) { client.end(); return; }
          if (options.stallRead) return;
          options.onRead?.(offset, file, files);
          if (offset >= file.bytes.length || (options.partialAt != null && offset >= options.partialAt)) status(id, 1);
          else sftp.data(id, file.bytes.subarray(offset, Math.min(offset + length, options.partialAt ?? Infinity)));
        });
        sftp.on('CLOSE', (id, handle) => {
          operations.push(['CLOSE']);
          handles.delete(handle.toString());
          status(id, 0);
        });
        for (const method of ['WRITE', 'REMOVE', 'RENAME', 'SETSTAT', 'FSETSTAT', 'MKDIR', 'RMDIR', 'SYMLINK']) {
          sftp.on(method, id => { operations.push([method]); status(id, 3); });
        }
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { files, operations, hostKeySha256, port: server.address().port,
    async close() { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
