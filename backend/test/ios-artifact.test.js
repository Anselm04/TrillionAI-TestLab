import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digestIosBundle,verifyIosArtifact} from '../src/ios-artifact.js';
test('bundle digest and native signing identity must match',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'testlab-ios-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const app=join(await realpath(dir),'Test.app');await mkdir(app);await writeFile(join(app,'Info.plist'),'fixture');
 const input={artifactPath:app,artifactSha256:await digestIosBundle(app),bundleId:'com.test.app',teamId:'ABCDEFGHIJ',hostPlatform:'darwin',runner:async(cmd,args)=>{assert.equal(cmd,'codesign');return {exitCode:0,output:args[0]==='-d'?'Identifier=com.test.app\nTeamIdentifier=ABCDEFGHIJ\n':''};}};
 assert.equal(await verifyIosArtifact(input),true);
 assert.equal(await verifyIosArtifact({...input,teamId:'ZZZZZZZZZZ'}),false);
 await writeFile(join(app,'Info.plist'),'modified');assert.equal(await verifyIosArtifact(input),false);
 await symlink('/etc/passwd',join(app,'link'));await assert.rejects(digestIosBundle(app));
});
