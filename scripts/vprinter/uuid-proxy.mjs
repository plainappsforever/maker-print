// Android path to the virtual printer (P4). The emulator's Default Print Service (BIPS) also sees the printer's own
// Bonjour advert, whose LAN address the macOS firewall blocks (until the owner clicks "Allow"); BIPS merges printers by
// printer-uuid and then uses the blocked LAN path ("This printer isn't available"). This loopback TCP proxy
// (10.0.2.2:8633 in the emulator → 127.0.0.1:8631) rewrites the printer-uuid in the printer's replies to a fixed
// UUID of the same length, so the printer added by IP stays a separate, reachable printer. Job bytes are not touched.
// Usage: node scripts/vprinter/uuid-proxy.mjs [listenPort=8633] [targetPort=8631]   (scripts/vprinter.sh starts it)
import net from 'node:net';

const listen = Number(process.argv[2] ?? 8633);
const target = Number(process.argv[3] ?? 8631);
const UUID = /urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// a FIXED uuid of the same length (IPP/HTTP lengths stay valid): the emulator keeps one identity across printer restarts
export const ANDROID_UUID = 'a0a0a0a0-0000-4000-8000-000000008633';
const swap = () => `urn:uuid:${ANDROID_UUID}`;

net
  .createServer((client) => {
    const server = net.connect(target, '127.0.0.1');
    client.pipe(server);
    server.on('data', (buf) => {
      const s = buf.toString('latin1');
      client.write(UUID.test(s) ? Buffer.from(s.replace(UUID, swap), 'latin1') : buf);
      UUID.lastIndex = 0;
    });
    server.on('end', () => client.end());
    server.on('error', () => client.destroy());
    client.on('error', () => server.destroy());
  })
  .listen(listen, process.argv[4] ?? '127.0.0.1', () => console.log(`uuid-proxy ${process.argv[4] ?? '127.0.0.1'}:${listen} → 127.0.0.1:${target}`));
