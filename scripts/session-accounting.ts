import {readFile} from 'node:fs/promises';import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
// Operator-only CLI. Importing a bill records host-supplied evidence; it does not certify the vendor invoice.
const args=process.argv.slice(2),action=args[0],dbIndex=args.indexOf('--db'),path=args[dbIndex+1];if(dbIndex<0||!path)throw Error('Use status|reconcile|recover --db <path> [--session id|--file json]');
const ledger=openSessionAccounting(path);
try{if(action==='status'){const i=args.indexOf('--session');if(i<0||!args[i+1])throw Error('Session required');console.log(JSON.stringify(ledger.snapshot(args[i+1]!),null,2));}
 else if(action==='recover')console.log(JSON.stringify({changed:ledger.recoverExpired(),authority:'host-supplied-not-vendor-verified'}));
 else if(action==='reconcile'){const i=args.indexOf('--file');if(i<0||!args[i+1])throw Error('Evidence file required');const bytes=await readFile(args[i+1]!);if(bytes.length>65536)throw Error('Evidence file too large');console.log(JSON.stringify(ledger.reconcile(JSON.parse(bytes.toString('utf8'))),null,2));}
 else throw Error('Unknown accounting command');
}finally{ledger.close();}
