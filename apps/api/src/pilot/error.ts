import type {ErrorCode} from '../../../../packages/contracts/src/tools.ts';
export class PilotError extends Error {constructor(readonly code:ErrorCode){super(code);this.name='PilotError';}}
