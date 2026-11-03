import{describeError,type ErrorCode}from'@interview/contracts';
export type ClientErrorCode='CLIENT_VALIDATION'|'PROTOCOL_ERROR'|'NETWORK_ERROR'|'TIMEOUT'|'ABORTED';
const messages:Record<ClientErrorCode,string>={CLIENT_VALIDATION:'Agent客户端输入不符合约束。',PROTOCOL_ERROR:'Agent响应不符合协议。',
 NETWORK_ERROR:'Agent连接中断或无法建立。',TIMEOUT:'Agent客户端等待超时。',ABORTED:'本地Agent请求已中止。'};
export class AgentClientError extends Error{
 readonly name='AgentClientError';
 constructor(readonly code:ErrorCode|ClientErrorCode,readonly status?:number,readonly retryable=false,readonly requestId?:string){
  super(code in messages?messages[code as ClientErrorCode]:describeError(code as ErrorCode).message);
 }
}
export const clientError=(code:ClientErrorCode)=>new AgentClientError(code,undefined,code==='NETWORK_ERROR'||code==='TIMEOUT');
export const normalize=(error:unknown)=>error instanceof AgentClientError?error:clientError('NETWORK_ERROR');
