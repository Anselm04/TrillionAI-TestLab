import {discoverAndroid} from './device-farm.js';
export async function inspectDeviceFarm({approvedDevices,leases,runner}){
 if(!Array.isArray(approvedDevices)||approvedDevices.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))||typeof leases?.status!=='function')throw new Error('Invalid farm configuration');
 const found=await discoverAndroid({runner});
 const approved=new Set(approvedDevices);
 const detected=new Map(found.devices.filter(d=>approved.has(d.id)).map(d=>[d.id,d]));
 return {status:found.status,devices:[...approved].map(id=>{
  const device=detected.get(id);
  const leaseState=leases.status(id);
  return {id,model:device?.model??null,hardwareKind:'unverified',connection:device?.state??'NOT_OBSERVED',leaseState,available:found.status==='DISCOVERED'&&device?.available===true&&leaseState==='IDLE'};
 }),productionReady:false};
}
