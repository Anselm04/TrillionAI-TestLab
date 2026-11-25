import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {loadServiceKey} from '../src/service-keys.js';
import {inspectDeviceFarm} from '../src/device-farm-status.js';
test('service keys reject unsafe permissions, wrong type and symlinks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'testlab-keys-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const p=join(dir,'private.pem'),q=join(dir,'public.pem'),link=join(dir,'link.pem');
 await writeFile(p,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 await writeFile(q,publicKey.export({type:'spki',format:'pem'}),{mode:0o644});
 assert.equal((await loadServiceKey(p,{privateKey:true})).type,'private');
 assert.equal((await loadServiceKey(q)).type,'public');
 await assert.rejects(loadServiceKey(p));
 await symlink(p,link);await assert.rejects(loadServiceKey(link,{privateKey:true}));
 await chmod(p,0o644);await assert.rejects(loadServiceKey(p,{privateKey:true}));
});
test('inventory hides unknown hardware and distinguishes unavailable leases',async()=>{
 const report=await inspectDeviceFarm({approvedDevices:['device-1','device-2'],leases:{status:id=>id==='device-1'?'QUARANTINED':'IDLE'},runner:async()=>({exitCode:0,output:'List of devices attached\ndevice-1 device model:Pixel\nunknown device model:Other\n'})});
 assert.equal(report.devices.length,2);
 assert.equal(report.devices[0].available,false);
 assert.equal(report.devices[1].connection,'NOT_OBSERVED');
 assert.equal(report.productionReady,false);
});
