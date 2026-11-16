import {test,expect,spyOn} from 'bun:test';
import {runtimeRequest} from './helpers/runtime-request.ts';
test('runtime fixtures create deadlines from request creation rather than module import time',()=>{
 const clock=spyOn(Date,'now').mockReturnValue(1000000);
 try{
  const first=runtimeRequest('first');expect(first.job.input.state.startedAt).toBe(1000000);
  clock.mockReturnValue(1100000);const later=runtimeRequest('later');
  expect(later.job.input.state.startedAt).toBe(1100000);expect(later.context.deadlineAt).toBe(1160000);
  expect(first.context.deadlineAt).toBe(1060000);
 }finally{clock.mockRestore();}
});
